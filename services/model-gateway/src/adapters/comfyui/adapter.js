/* adapters/comfyui/adapter.js — ComfyUI adapter with auto-scaling pipeline
 *
 * DevList §9 — Phase G5 + §6 auto-scaling.
 *
 * Full execution flow:
 *  1. Resolve public workflowId → best variant from file-backed registry
 *  2. Validate required models are available
 *  3. Auto-scale source + mask images to fit the workflow's max dimension
 *  4. Upload scaled images to ComfyUI
 *  5. Patch workflow with uploaded filenames + parameters
 *  6. Submit prompt
 *  7. Poll until completion
 *  8. Download output image
 *  9. Upscale result back to original selection dimensions
 * 10. Return normalized PixelOasis response
 */

import config from "../../config.js";
import { getRegistry } from "../registry-instance.js";
import { validateModels } from "./workflow-loader.js";
import { patchWorkflow, validateBindings, WorkflowBindingError } from "./workflow-bindings.js";
import { createComfyUIClient, ComfyUIError, ComfyUIOfflineError, ComfyUIValidationError, ComfyUITimeoutError, ComfyUINoOutputError } from "./client.js";
import { readOutputImages, detectImageDimensions } from "./result-reader.js";
import { scaleImageDown, scaleImageUp, getPngDimensions } from "../../utils/images.js";
import logger from "../../utils/logger.js";

/* Default max source dimension per workflow type (overridden by variant metadata) */
var DEFAULT_MAX_SOURCE_DIMENSION = 1024;

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
     * Step 3: Get max source dimension from variant metadata
     * ═══════════════════════════════════════════════════════════════ */

    var maxDim = DEFAULT_MAX_SOURCE_DIMENSION;
    if (variant.sizePolicy && typeof variant.sizePolicy.maxSourceDimension === "number") {
      maxDim = variant.sizePolicy.maxSourceDimension;
    }
    console.log("[comfyui] Max source dimension: " + maxDim + "px");

    /* ═══════════════════════════════════════════════════════════════
     * Step 4: Auto-scale source + mask images
     * ═══════════════════════════════════════════════════════════════ */

    var selection = request.selection;
    var sourceB64 = selection.imagePngBase64 || selection.imageBase64;
    var maskB64 = selection.maskPngBase64 || selection.maskBase64;

    if (!sourceB64) {
      throw new ComfyUIError("Missing source image (imagePngBase64).");
    }

    /* Get original dimensions */
    var origDims = getPngDimensions(sourceB64);

    /* Scale source */
    var sourceScaled = await scaleImageDown(sourceB64, maxDim);
    console.log("[comfyui] Source: " + sourceScaled.originalWidth + "x" + sourceScaled.originalHeight +
      (sourceScaled.scaled ? " → " + sourceScaled.width + "x" + sourceScaled.height +
        " (scale: " + sourceScaled.scale.toFixed(3) + ")" : " (no scaling needed)"));

    /* Scale mask with the same factor (if present) */
    var maskScaled = null;
    if (maskB64) {
      /* For mask, use the same scale factor as the source image to keep alignment */
      if (sourceScaled.scaled) {
        var maskDown = await scaleImageDown(maskB64, maxDim);
        maskScaled = maskDown;
      } else {
        maskScaled = await scaleImageDown(maskB64, maxDim);
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
     * Step 10: Upscale result back to original dimensions
     * ═══════════════════════════════════════════════════════════════ */

    var finalBase64;
    var finalWidth = outputDims.width;
    var finalHeight = outputDims.height;

    if (sourceScaled.scaled) {
      var targetW = sourceScaled.originalWidth;
      var targetH = sourceScaled.originalHeight;
      finalBase64 = await scaleImageUp(outputPng, targetW, targetH);
      finalWidth = targetW;
      finalHeight = targetH;
      console.log("[comfyui] Upscaled result to original: " + targetW + "x" + targetH);
    } else {
      finalBase64 = outputPng.toString("base64");
    }

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
        metadata: {
          provider: "comfyui",
          workflowId: request.workflowId,
          variantId: variant.variantId,
          promptId: promptId,
          scaled: sourceScaled.scaled,
          originalWidth: sourceScaled.originalWidth,
          originalHeight: sourceScaled.originalHeight,
        },
      },
    };
  },
};
