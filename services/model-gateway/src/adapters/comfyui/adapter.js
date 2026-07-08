/* adapters/comfyui/adapter.js — ComfyUI adapter with policy-driven pipeline
 *
 * ImplList §5.3 + §6.2 — Size and mask processing delegated to policy modules.
 *
 * Full execution flow:
 *  1. Resolve public workflowId → best variant
 *  2. Validate required models
 *  3. Apply size-policy → compute dimensions
 *  4. Apply mask-policy → process mask
 *  5. Scale + upload images to ComfyUI
 *  6. Patch workflow with uploaded filenames + parameters
 *  7. Submit prompt
 *  8. Poll until completion
 *  9. Download output, finalize dimensions via size-policy
 * 10. Return normalized PixelOasis response with placement info
 */

import config from "../../config.js";
import { getRegistry } from "../registry-instance.js";
import { validateModels } from "./workflow-loader.js";
import { patchWorkflow, validateBindings, WorkflowBindingError } from "./workflow-bindings.js";
import { createComfyUIClient, ComfyUIError, ComfyUIOfflineError, ComfyUIValidationError, ComfyUITimeoutError, ComfyUINoOutputError } from "./client.js";
import { readOutputImages, detectImageDimensions } from "./result-reader.js";
import { scaleImageDown, resizeToExact, padImage, cropToBounds, getPngDimensions } from "../../utils/images.js";
import { applySizePolicy } from "./size-policy.js";
import { applyMaskPolicy } from "./mask-policy.js";
import logger from "../../utils/logger.js";
import { createAudit } from "../../utils/audit.js";

function resolveMaskPaddingBackground(maskPolicyResult) {
  var polarity = maskPolicyResult &&
    maskPolicyResult.metadata &&
    maskPolicyResult.metadata.polarity;

  if (polarity === "black-editable") {
    return { r: 255, g: 255, b: 255, alpha: 1 };
  }

  return { r: 0, g: 0, b: 0, alpha: 1 };
}

export default {
  id: "comfyui",

  async execute(request) {
    var registry = getRegistry();
    var client = createComfyUIClient(config.comfyui.baseUrl, {
      generateTimeout: 600000,   /* 10 minutes */
      pollInterval: 1500,
    });

    /* ── Audit tracker: records full generation trace ── */
    var audit = createAudit(request);

    /* ═══════════════════════════════════════════════════════════════
     * Step 1: Resolve workflow variant
     * ═══════════════════════════════════════════════════════════════ */

    var variant;
    try {
      variant = registry.resolveVariant(request.workflowId);
    } catch (err) {
      /* Fallback: try any enabled variant in the same category.
       * This lets fallback-list workflows (e.g. composition.outpaint.basic)
       * reuse the same API workflow as their siblings (e.g. sdxl-inpaint-basic). */
      var parts = request.workflowId.split(".");
      var categoryPrefix = parts[0];
      var allIds = registry.getAllWorkflowIds();
      var fallbackVariant = null;

      for (var f = 0; f < allIds.length; f++) {
        if (allIds[f].startsWith(categoryPrefix + ".")) {
          try {
            fallbackVariant = registry.resolveVariant(allIds[f]);
            break;
          } catch (_) { /* try next */ }
        }
      }

      if (fallbackVariant) {
        console.warn("[comfyui] WARNING: category fallback used — " +
          request.workflowId + " → " + fallbackVariant.workflowId +
          ". This is a dev-only safety net; production should request the correct workflowId.");
        logger.warn("workflow.variant_fallback", {
          component: "adapter",
          correlationId: request.correlationId,
          workflowId: request.workflowId,
          data: {
            originalError: err.message,
            fallbackWorkflowId: fallbackVariant.workflowId,
            fallbackVariantId: fallbackVariant.variantId,
          },
        });
        variant = fallbackVariant;
      } else {
        throw new ComfyUIError(
          "Workflow resolution failed: " + err.message,
          { workflowId: request.workflowId },
        );
      }
    }

    console.log("[comfyui] Resolved workflow " + request.workflowId +
      " → variant " + variant.variantId + " (priority " + variant.priority + ")");

    logger.info("workflow.resolved", {
      component: "adapter",
      correlationId: request.correlationId,
      workflowId: request.workflowId,
      data: { variantId: variant.variantId, priority: variant.priority },
    });

    audit.recordVariant(variant.variantId, variant.priority);

    /* ═══════════════════════════════════════════════════════════════
     * Step 2: Validate models
     * ═══════════════════════════════════════════════════════════════ */

    if (variant.requiredModels && variant.requiredModels.length > 0) {
      var modelCheck = await validateModels(client, variant.requiredModels);
      if (!modelCheck.valid) {
        var missingNames = modelCheck.missing.map(function (m) { return m.name; }).join(", ");
        throw new ComfyUIError(
          "MISSING_MODEL: Required models not available: " + missingNames,
          { missing: modelCheck.missing },
        );
      }
    }

    /* ═══════════════════════════════════════════════════════════════
     * Step 3: Apply size-policy
     * ═══════════════════════════════════════════════════════════════ */

    var selection = request.selection;
    var sourceB64 = selection.imagePngBase64 || selection.imageBase64;
    var maskB64 = selection.maskPngBase64 || selection.maskBase64;

    if (!sourceB64) {
      throw new ComfyUIError("Missing source image (imagePngBase64).");
    }

    var origDims = getPngDimensions(sourceB64);

    logger.info("image.source.decoded", {
      component: "adapter",
      correlationId: request.correlationId,
      workflowId: request.workflowId,
      data: { width: origDims.width, height: origDims.height, hasMask: !!maskB64 },
    });

    audit.recordSource(origDims, sourceB64);

    if (maskB64) {
      var maskOrigDims = getPngDimensions(maskB64);
      logger.info("image.mask.decoded", {
        component: "adapter",
        correlationId: request.correlationId,
        workflowId: request.workflowId,
        data: { width: maskOrigDims.width, height: maskOrigDims.height },
      });
      audit.recordMask(maskOrigDims, maskB64);
    } else {
      audit.recordMask(null, null);
    }

    var sizeResult = applySizePolicy(selection.bounds, origDims, variant);

    console.log("[comfyui] Size policy: mode=" + sizeResult.policy.mode +
      ", maxDim=" + sizeResult.policy.maxSourceDimension +
      ", internal=" + sizeResult.internalWidth + "x" + sizeResult.internalHeight +
      (sizeResult.scaled ? " (scale: " + sizeResult.scale.toFixed(3) + ")" : ""));

    logger.info("image.size_policy.applied", {
      component: "adapter",
      correlationId: request.correlationId,
      workflowId: request.workflowId,
      data: sizeResult.metadata,
    });

    audit.recordSizePolicy(sizeResult);

    /* ═══════════════════════════════════════════════════════════════
     * Step 4: Apply mask-policy + scale images
     * ═══════════════════════════════════════════════════════════════ */

    /* Process mask through mask-policy */
    var maskPolicyResult = null;
    if (maskB64) {
      maskPolicyResult = await applyMaskPolicy(maskB64, variant);
      logger.info("image.mask_policy.applied", {
        component: "adapter",
        correlationId: request.correlationId,
        workflowId: request.workflowId,
        data: maskPolicyResult.metadata,
      });
      audit.recordMaskPolicy(maskPolicyResult);
    }

    /* Scale source to internal dimensions */
    var sourceScaled;
    if (sizeResult.scaled) {
      sourceScaled = await scaleImageDown(sourceB64, sizeResult.policy.maxSourceDimension);
    } else {
      sourceScaled = {
        base64: sourceB64.replace(/^data:image\/\w+;base64,/, ""),
        width: origDims.width,
        height: origDims.height,
        scaled: false,
        scale: 1.0,
      };
    }

    console.log("[comfyui] Source: " + origDims.width + "x" + origDims.height +
      (sourceScaled.scaled ? " → " + sourceScaled.width + "x" + sourceScaled.height : " (no scaling)"));

    /* P1-1: expandThenCrop — pad source image for context */
    var sourceForUpload = sourceScaled.base64;
    var maskForUpload = null;
    var sourceUploadWidth = sourceScaled.width;
    var sourceUploadHeight = sourceScaled.height;
    var sourcePaddingMode = null;
    var maskPaddingMode = null;

    if (sizeResult.contextPaddingPx > 0 && sizeResult.policy.mode === "expandThenCrop") {
      var padPx = sizeResult.contextPaddingPx;
      /* Pad source image — use reflect mode to extend edges naturally */
      var sourceBuf = Buffer.from(sourceScaled.base64, "base64");
      var paddedSourceBuf = await padImage(sourceBuf, padPx, { mode: "reflect" });
      sourceForUpload = paddedSourceBuf.toString("base64");
      sourcePaddingMode = "reflect";
      /* Dimensions after padding */
      sourceUploadWidth = sourceScaled.width + padPx * 2;
      sourceUploadHeight = sourceScaled.height + padPx * 2;

      console.log("[comfyui] Padded source: " + sourceUploadWidth + "x" + sourceUploadHeight +
        " (+" + padPx + "px per side)");
    }

    /* Scale mask (if present) to match source dimensions */
    var maskScaled = null;
    if (maskPolicyResult && maskPolicyResult.maskForWorkflow) {
      var maskDims = getPngDimensions(maskPolicyResult.maskForWorkflow);
      if (sizeResult.scaled) {
        var maskDown = await scaleImageDown(maskPolicyResult.maskForWorkflow, sizeResult.policy.maxSourceDimension);
        maskScaled = maskDown;
      } else {
        maskScaled = {
          base64: maskPolicyResult.maskForWorkflow.replace(/^data:image\/\w+;base64,/, ""),
          width: maskDims.width,
          height: maskDims.height,
          scaled: false,
          scale: 1.0,
        };
      }
    }

    maskForUpload = maskScaled ? maskScaled.base64 : null;
    if (maskForUpload && sizeResult.contextPaddingPx > 0 && sizeResult.policy.mode === "expandThenCrop") {
      var scaledMaskBuf = Buffer.from(maskForUpload, "base64");
      var maskPaddingBackground = resolveMaskPaddingBackground(maskPolicyResult);
      var paddedScaledMaskBuf = await padImage(scaledMaskBuf, sizeResult.contextPaddingPx, {
        background: maskPaddingBackground,
      });
      maskForUpload = paddedScaledMaskBuf.toString("base64");
      maskPaddingMode = "background";
    }

    if (variant.inputPolicy && variant.inputPolicy.mask === "required" && !maskForUpload) {
      throw new ComfyUIError(
        "Missing required mask for workflow " + request.workflowId + ".",
        { workflowId: request.workflowId, inputPolicy: variant.inputPolicy },
      );
    }

    if (sourcePaddingMode || maskPaddingMode) {
      logger.info("image.padding.applied", {
        component: "adapter",
        correlationId: request.correlationId,
        workflowId: request.workflowId,
        data: {
          contextPaddingPx: sizeResult.contextPaddingPx,
          sourcePaddingMode: sourcePaddingMode,
          maskPaddingMode: maskPaddingMode,
          maskPolarity: maskPolicyResult && maskPolicyResult.metadata
            ? maskPolicyResult.metadata.polarity
            : null,
        },
      });
    }

    /* ═══════════════════════════════════════════════════════════════
     * Step 5: Upload images to ComfyUI
     * ═══════════════════════════════════════════════════════════════ */

    var uniqueId = request.correlationId || ("po-" + Date.now());

    /* Upload source (may be padded for expandThenCrop) */
    var sourceUpload = await client.uploadImage({
      bytes: Buffer.from(sourceForUpload, "base64"),
      filename: "po-src-" + uniqueId + ".png",
      overwrite: true,
    });
    console.log("[comfyui] Uploaded source: " + sourceUpload.name);
    logger.info("comfyui.upload.source.completed", {
      component: "adapter",
      correlationId: request.correlationId,
      workflowId: request.workflowId,
      data: { filename: sourceUpload.name },
    });

    audit.recordSourceUpload(
      sourceUpload,
      Buffer.from(sourceForUpload, "base64"),
      sourceUploadWidth,
      sourceUploadHeight,
    );

    /* Upload mask (may be padded for expandThenCrop) */
    var maskUpload = null;
    if (maskForUpload) {
      maskUpload = await client.uploadImage({
        bytes: Buffer.from(maskForUpload, "base64"),
        filename: "po-msk-" + uniqueId + ".png",
        overwrite: true,
      });
      console.log("[comfyui] Uploaded mask: " + maskUpload.name);
      logger.info("comfyui.upload.mask.completed", {
        component: "adapter",
        correlationId: request.correlationId,
        workflowId: request.workflowId,
        data: { filename: maskUpload.name },
      });

      audit.recordMaskUpload(maskUpload, Buffer.from(maskForUpload, "base64"));
    }

    /* Post-upload verification: fetch uploaded images back from ComfyUI */
    await audit.verifySourceUpload(client);
    if (maskUpload) {
      await audit.verifyMaskUpload(client);
    }

    /* ═══════════════════════════════════════════════════════════════
     * Step 6: Patch workflow
     * ═══════════════════════════════════════════════════════════════ */

    var bindResult = validateBindings(variant);
    if (!bindResult.valid) {
      throw new WorkflowBindingError(
        "WORKFLOW_BINDING_ERROR: " + bindResult.errors.join("; "),
        { errors: bindResult.errors },
      );
    }

    var patchedWorkflow = patchWorkflow(variant, request, {
      sourceImageFilename: sourceUpload.name,
      maskImageFilename: maskUpload ? maskUpload.name : null,
    });

    /* Log workflow patch summary */
    var nodeIds = Object.keys(patchedWorkflow);
    var nodeTypes = [];
    for (var ni = 0; ni < nodeIds.length; ni++) {
      var node = patchedWorkflow[nodeIds[ni]];
      if (node && node.class_type) nodeTypes.push(node.class_type);
    }

    logger.info("comfyui.workflow.patched", {
      component: "adapter",
      correlationId: request.correlationId,
      workflowId: request.workflowId,
      data: {
        variantId: variant.variantId,
        nodeCount: nodeIds.length,
        nodeTypes: nodeTypes,
        sourceFilename: sourceUpload.name,
        maskFilename: maskUpload ? maskUpload.name : null,
      },
    });

    /* Save workflow patch to audit trail (handles summary + debug file internally) */
    audit.recordWorkflowPatch(
      variant.variantId,
      nodeTypes,
      sourceUpload.name,
      maskUpload ? maskUpload.name : null,
      patchedWorkflow,
    );

    /* ═══════════════════════════════════════════════════════════════
     * Step 7: Submit to ComfyUI
     * ═══════════════════════════════════════════════════════════════ */

    console.log("[comfyui] Submitting workflow...");
    logger.info("comfyui.prompt.submitted", {
      component: "adapter",
      correlationId: request.correlationId,
      workflowId: request.workflowId,
    });
    var submitResult;
    try {
      submitResult = await client.submitPrompt({
        workflow: patchedWorkflow,
        clientId: uniqueId,
      });
    } catch (err) {
      if (err instanceof ComfyUIValidationError) {
        throw new ComfyUIError(
          "COMFYUI_VALIDATION_ERROR: " + err.message,
          { nodeErrors: err.nodeErrors },
        );
      }
      throw err;
    }

    var promptId = submitResult.promptId;
    console.log("[comfyui] Submitted: promptId=" + promptId);

    audit.recordSubmit(promptId, config.comfyui.baseUrl);

    /* ═══════════════════════════════════════════════════════════════
     * Step 8: Wait for completion
     * ═══════════════════════════════════════════════════════════════ */

    var historyEntry;
    try {
      historyEntry = await client.waitForPrompt(promptId, {
        timeoutMs: 600000,
        pollInterval: 1500,
        onProgress: function (entry) {
          var status = entry.status ? entry.status.status_str : "...";
          console.log("[comfyui] Prompt " + promptId + " status: " + status);
        },
      });
    } catch (err) {
      if (err instanceof ComfyUITimeoutError) {
        throw new ComfyUIError(
          "COMFYUI_TIMEOUT: Generation timed out for prompt " + promptId,
          { promptId: promptId },
        );
      }
      throw err;
    }
    console.log("[comfyui] Generation completed: " + promptId);
    logger.info("comfyui.generation.completed", {
      component: "adapter",
      correlationId: request.correlationId,
      workflowId: request.workflowId,
      data: { promptId: promptId },
    });

    audit.recordHistory(historyEntry);

    /* ═══════════════════════════════════════════════════════════════
     * Step 9: Download output
     * ═══════════════════════════════════════════════════════════════ */

    var outputNodeId = variant.outputs.images.nodeId;
    var outputs;
    try {
      outputs = await readOutputImages(client, historyEntry, outputNodeId);
    } catch (err) {
      if (err instanceof ComfyUINoOutputError) {
        throw new ComfyUIError(
          "NO_OUTPUT_IMAGE: No output image found for prompt " + promptId,
          { promptId: promptId },
        );
      }
      throw err;
    }

    if (outputs.length === 0) {
      throw new ComfyUIError(
        "NO_OUTPUT_IMAGE: No output images in prompt " + promptId,
        { promptId: promptId },
      );
    }

    var outputPng = outputs[0].buffer;
    var outputDims = detectImageDimensions(outputPng);
    console.log("[comfyui] Output: " + outputDims.width + "x" + outputDims.height +
      " (" + outputPng.length + " bytes)");
    logger.info("comfyui.output.downloaded", {
      component: "adapter",
      correlationId: request.correlationId,
      workflowId: request.workflowId,
      data: { width: outputDims.width, height: outputDims.height, bytes: outputPng.length },
    });

    audit.recordOutput(outputDims, outputPng);

    /* ═══════════════════════════════════════════════════════════════
     * Step 10: Finalize dimensions via size-policy (P1-1: crop-then-resize)
     * ═══════════════════════════════════════════════════════════════ */

    var finalBase64;
    var finalWidth = sizeResult.finalWidth;
    var finalHeight = sizeResult.finalHeight;
    var processedPng = outputPng;

    /* P1-1: expandThenCrop — crop back to original selection area */
    if (sizeResult.cropToBounds && sizeResult.contextPaddingPx > 0) {
      var cropPad = sizeResult.contextPaddingPx;
      var cropLeft = cropPad;
      var cropTop = cropPad;
      var cropW = outputDims.width - cropLeft * 2;
      var cropH = outputDims.height - cropTop * 2;

      if (cropW > 0 && cropH > 0) {
        processedPng = await cropToBounds(processedPng, {
          left: cropLeft, top: cropTop, width: cropW, height: cropH,
        });
        console.log("[comfyui] Cropped output: " + outputDims.width + "x" + outputDims.height +
          " → " + cropW + "x" + cropH + " (removed " + cropPad + "px padding)");
      } else {
        console.warn("[comfyui] expandThenCrop: skipping crop — output too small (" +
          outputDims.width + "x" + outputDims.height + ")");
      }
    }

    /* Resize to exact final dimensions if needed */
    var cropDims = detectImageDimensions(processedPng);
    if (cropDims.width !== finalWidth || cropDims.height !== finalHeight) {
      if (sizeResult.policy.mode === "expandThenCrop") {
        /* For expandThenCrop, warn on mismatch instead of blindly resizing */
        console.warn("[comfyui] Warning: output " + cropDims.width + "x" + cropDims.height +
          " ≠ target " + finalWidth + "x" + finalHeight + " (expandThenCrop)");
      }
      processedPng = await resizeToExact(processedPng, finalWidth, finalHeight, {
        fit: "fill",
        kernel: "lanczos3",
      });
      console.log("[comfyui] Resized output to final: " + finalWidth + "x" + finalHeight);
    }

    finalBase64 = processedPng.toString("base64");

    /* Log dimension chain */
    logger.info("result.finalized", {
      component: "adapter",
      correlationId: request.correlationId,
      workflowId: request.workflowId,
      data: {
        sourceWidth: sizeResult.metadata.originalWidth,
        sourceHeight: sizeResult.metadata.originalHeight,
        internalWidth: sizeResult.internalWidth,
        internalHeight: sizeResult.internalHeight,
        comfyuiOutputWidth: outputDims.width,
        comfyuiOutputHeight: outputDims.height,
        finalWidth: finalWidth,
        finalHeight: finalHeight,
        promptId: promptId,
        variantId: variant.variantId,
        sizePolicyMode: sizeResult.policy.mode,
      },
    });

    audit.recordFinal(finalWidth, finalHeight, processedPng.length);

    /* ── Write audit trail to disk ── */
    audit.finalize();

    /* ═══════════════════════════════════════════════════════════════
     * Step 11: Return normalized PixelOasis response
     * ═══════════════════════════════════════════════════════════════ */

    return {
      correlationId: request.correlationId,
      status: "succeeded",
      result: {
        imagePngBase64: finalBase64,
        mimeType: "image/png",
        width: finalWidth,
        height: finalHeight,
        seed: request.parameters ? request.parameters.seed : -1,
        placement: {
          type: variant.placementPolicy ? variant.placementPolicy.type : "smartObjectMaskedExact",
          targetBounds: selection.bounds,
          maskPngBase64: maskPolicyResult ? (maskPolicyResult.finalPlacementMask || null) : null,
          featherPixels: variant.placementPolicy ? (variant.placementPolicy.featherPixels || 0) : 0,
          createLayerGroup: variant.placementPolicy ? variant.placementPolicy.createLayerGroup !== false : true,
        },
        metadata: {
          provider: "comfyui",
          workflowId: request.workflowId,
          variantId: variant.variantId,
          promptId: promptId,
          sourceWidth: sizeResult.metadata.originalWidth,
          sourceHeight: sizeResult.metadata.originalHeight,
          internalWidth: sizeResult.internalWidth,
          internalHeight: sizeResult.internalHeight,
          outputWidth: finalWidth,
          outputHeight: finalHeight,
          contextPadding: sizeResult.contextPaddingPx || 0,
        },
      },
    };
  },
};
