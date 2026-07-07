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
import { scaleImageDown, resizeToExact, getPngDimensions } from "../../utils/images.js";
import { applySizePolicy } from "./size-policy.js";
import { applyMaskPolicy } from "./mask-policy.js";
import logger from "../../utils/logger.js";

export default {
  id: "comfyui",

  async execute(request) {
    var registry = getRegistry();
    var client = createComfyUIClient(config.comfyui.baseUrl, {
      generateTimeout: 600000,   /* 10 minutes */
      pollInterval: 1500,
    });

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
        logger.info("workflow.variant_fallback", {
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

    /* Scale mask (if present) to match source dimensions */
    var maskScaled = null;
    if (maskPolicyResult && maskPolicyResult.maskForWorkflow) {
      var maskDims = getPngDimensions(maskPolicyResult.maskForWorkflow);
      if (sizeResult.scaled) {
        var maskDown = await scaleImageDown(maskPolicyResult.maskForWorkflow, sizeResult.policy.maxSourceDimension);
        maskScaled = maskDown;
      } else {
        maskScaled = {
          base64: maskPolicyResult.maskForWorkflow,
          width: maskDims.width,
          height: maskDims.height,
          scaled: false,
          scale: 1.0,
        };
      }
    }

    /* ═══════════════════════════════════════════════════════════════
     * Step 5: Upload images to ComfyUI
     * ═══════════════════════════════════════════════════════════════ */

    var uniqueId = request.correlationId || ("po-" + Date.now());

    /* Upload source */
    var sourceUpload = await client.uploadImage({
      bytes: Buffer.from(sourceScaled.base64, "base64"),
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

    /* Upload mask */
    var maskUpload = null;
    if (maskScaled) {
      maskUpload = await client.uploadImage({
        bytes: Buffer.from(maskScaled.base64, "base64"),
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

    /* ═══════════════════════════════════════════════════════════════
     * Step 10: Finalize dimensions via size-policy
     * ═══════════════════════════════════════════════════════════════ */

    var finalBase64;
    var finalWidth = sizeResult.finalWidth;
    var finalHeight = sizeResult.finalHeight;

    /* If ComfyUI output dimensions differ from policy target, resize */
    if (outputDims.width !== finalWidth || outputDims.height !== finalHeight) {
      var resizedBuffer = await resizeToExact(outputPng, finalWidth, finalHeight, {
        fit: "fill",
        kernel: "lanczos3",
      });
      finalBase64 = resizedBuffer.toString("base64");
      console.log("[comfyui] Resized output: " + outputDims.width + "x" + outputDims.height +
        " → " + finalWidth + "x" + finalHeight);
    } else {
      finalBase64 = outputPng.toString("base64");
    }

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
        placement: maskPolicyResult ? {
          type: variant.placementPolicy ? variant.placementPolicy.type : "smartObjectMaskedExact",
          targetBounds: selection.bounds,
          maskPngBase64: maskPolicyResult.finalPlacementMask || null,
          featherPixels: variant.placementPolicy ? (variant.placementPolicy.featherPixels || 0) : 0,
          createLayerGroup: variant.placementPolicy ? variant.placementPolicy.createLayerGroup !== false : true,
        } : null,
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
