/* utils/audit.js — ComfyUI audit logger
 *
 * Records per-request ComfyUI audit trails:
 *   logs/comfyui-audit/<correlationId>.json      — full audit record
 *   logs/comfyui-audit/<correlationId>.workflow.json — patched workflow (debug)
 *   logs/debug-images/<correlationId>-source-upload.png
 *   logs/debug-images/<correlationId>-mask-upload.png
 *   logs/debug-images/<correlationId>-output.png
 *
 * All key events also written to the unified pixeloasis-logs-*.jsonl.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import config from "../config.js";
import logger from "./logger.js";

/* ── SHA-256 helper ── */
function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/* ── Ensure a directory exists ── */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/* ── Create an audit tracker for a single generation request ── */
export function createAudit(request) {
  var corrId = request.correlationId || ("po-" + Date.now());
  var workflowId = request.workflowId;

  var logDir = config.logging.dir;
  var auditDir = path.join(logDir, "comfyui-audit");
  var imagesDir = path.join(logDir, "debug-images");
  var saveImages = config.pixelOasis && config.pixelOasis.keepIntermediateImages;
  var saveWorkflow = config.pixelOasis && config.pixelOasis.debugWorkflows;

  /* ── The audit record (accumulated during generation) ── */
  var record = {
    correlationId: corrId,
    workflowId: workflowId,
    startedAt: new Date().toISOString(),
    source: {},
    mask: {},
    comfyui: {
      uploadResponses: [],
      historyStatus: null,
      outputRefs: [],
    },
    result: {},
  };

  /* ── Save a debug image to disk ── */
  function saveDebugImage(filename, buffer) {
    if (!saveImages) return;
    try {
      ensureDir(imagesDir);
      fs.writeFileSync(path.join(imagesDir, filename), buffer);
    } catch (e) {
      logger.warn("audit.debug_image_failed", {
        component: "audit",
        correlationId: corrId,
        data: { filename: filename, error: e.message },
      });
    }
  }

  /* ── Extract raw bytes from a base64 data-URI ── */
  function rawFromB64(b64) {
    return Buffer.from(b64.replace(/^data:image\/\w+;base64,/, ""), "base64");
  }

  /* ═══════════════════════════════════════════════════════════════
   * Public audit API
   * ═══════════════════════════════════════════════════════════════ */

  return {
    /* ── Step 1: variant resolution ── */
    recordVariant: function (variantId, priority) {
      record.variantId = variantId;
      record.priority = priority;
    },

    /* ── Step 2: source image decoded ── */
    recordSource: function (origDims, sourceB64) {
      var rawBytes = rawFromB64(sourceB64);
      record.source.original = {
        width: origDims.width,
        height: origDims.height,
        bytes: rawBytes.length,
        sha256: sha256(rawBytes),
      };
    },

    /* ── Step 2b: mask decoded ── */
    recordMask: function (maskOrigDims, maskB64) {
      if (!maskB64) {
        record.mask = { present: false };
        return;
      }
      var rawBytes = rawFromB64(maskB64);
      record.mask = {
        present: true,
        original: { width: maskOrigDims.width, height: maskOrigDims.height },
        originalBytes: rawBytes.length,
        originalSha256: sha256(rawBytes),
      };
    },

    /* ── Step 3: size policy applied ── */
    recordSizePolicy: function (sizeResult) {
      record.source.afterScale = {
        width: sizeResult.internalWidth,
        height: sizeResult.internalHeight,
      };
      record.source.scale = sizeResult.scaled ? sizeResult.scale : 1.0;
      record.source.afterPadding = sizeResult.contextPaddingPx > 0
        ? { padPixels: sizeResult.contextPaddingPx, mode: sizeResult.policy.mode }
        : null;
    },

    /* ── Step 4: mask policy applied ── */
    recordMaskPolicy: function (maskPolicyResult) {
      if (!record.mask || !record.mask.present) return;
      record.mask.afterPolicy = {
        growPixels: maskPolicyResult.metadata ? (maskPolicyResult.metadata.growPixels || 0) : 0,
        blurPixels: maskPolicyResult.metadata ? (maskPolicyResult.metadata.blurPixels || 0) : 0,
        polarity: maskPolicyResult.metadata ? (maskPolicyResult.metadata.polarity || "white-mask") : "white-mask",
      };
    },

    /* ── Step 4b: workflow-level grow_mask_by (from VAEEncodeForInpaint) ── */
    recordWorkflowGrowMaskBy: function (growMaskBy) {
      if (!record.mask || !record.mask.present) return;
      record.mask.afterPolicy.workflowGrowMaskBy = growMaskBy;
      record.mask.afterPolicy.note =
        "Mask is processed at two layers: pixel-level growPixels (mask-policy) + " +
        "latent-level grow_mask_by (VAEEncodeForInpaint). Combined effect may exceed either alone.";
    },

    /* ── Step 5: source image uploaded ── */
    recordSourceUpload: function (uploadResult, rawBytes, uploadWidth, uploadHeight) {
      record.source.uploadedFilename = uploadResult.name;
      record.source.uploadedBytes = rawBytes.length;
      record.source.uploadWidth = uploadWidth;
      record.source.uploadHeight = uploadHeight;
      record.comfyui.uploadResponses.push({
        type: "source",
        name: uploadResult.name,
        subfolder: uploadResult.subfolder || "",
      });

      saveDebugImage(corrId + "-source-upload.png", rawBytes);

      logger.info("audit.source.recorded", {
        component: "audit",
        correlationId: corrId,
        workflowId: workflowId,
        data: {
          filename: uploadResult.name,
          bytes: rawBytes.length,
          width: uploadWidth,
          height: uploadHeight,
        },
      });
    },

    /* ── Step 5b: mask image uploaded ── */
    recordMaskUpload: function (uploadResult, rawBytes, uploadWidth, uploadHeight) {
      record.mask.uploadedFilename = uploadResult.name;
      record.mask.uploadedBytes = rawBytes.length;
      if (uploadWidth !== undefined) record.mask.uploadWidth = uploadWidth;
      if (uploadHeight !== undefined) record.mask.uploadHeight = uploadHeight;
      record.comfyui.uploadResponses.push({
        type: "mask",
        name: uploadResult.name,
        subfolder: uploadResult.subfolder || "",
      });

      saveDebugImage(corrId + "-mask-upload.png", rawBytes);

      logger.info("audit.mask.recorded", {
        component: "audit",
        correlationId: corrId,
        workflowId: workflowId,
        data: {
          filename: uploadResult.name,
          bytes: rawBytes.length,
          width: uploadWidth,
          height: uploadHeight,
        },
      });
    },

    /* ── Step 5c: mask padding applied (expandThenCrop) ── */
    recordMaskPadding: function (padPixels, paddingMode, polarity) {
      if (!record.mask || !record.mask.present) return;
      record.mask.afterPadding = {
        padPixels: padPixels,
        mode: paddingMode || "background",
        polarity: polarity || "white-editable",
      };

      logger.info("audit.mask_padding.recorded", {
        component: "audit",
        correlationId: corrId,
        workflowId: workflowId,
        data: {
          padPixels: padPixels,
          mode: paddingMode,
          polarity: polarity,
        },
      });
    },

    /* ── Post-upload verify: fetch uploaded source back from ComfyUI ── */
    verifySourceUpload: async function (client) {
      if (!record.source.uploadedFilename) return;
      try {
        var backBuf = await client.downloadView({
          filename: record.source.uploadedFilename,
          type: "input",
        });
        record.source.verifiedOnServer = {
          bytes: backBuf.length,
          sha256: sha256(backBuf),
          matchesUpload: backBuf.length === record.source.uploadedBytes,
        };

        logger.info("audit.source.verified", {
          component: "audit",
          correlationId: corrId,
          workflowId: workflowId,
          data: {
            uploadedBytes: record.source.uploadedBytes,
            serverBytes: backBuf.length,
            match: backBuf.length === record.source.uploadedBytes,
          },
        });
      } catch (e) {
        record.source.verifiedOnServer = { error: e.message };
        logger.warn("audit.source.verify_failed", {
          component: "audit",
          correlationId: corrId,
          data: { error: e.message },
        });
      }
    },

    /* ── Post-upload verify: fetch uploaded mask back from ComfyUI ── */
    verifyMaskUpload: async function (client) {
      if (!record.mask || !record.mask.uploadedFilename) return;
      try {
        var backBuf = await client.downloadView({
          filename: record.mask.uploadedFilename,
          type: "input",
        });
        record.mask.verifiedOnServer = {
          bytes: backBuf.length,
          sha256: sha256(backBuf),
          matchesUpload: backBuf.length === record.mask.uploadedBytes,
        };

        logger.info("audit.mask.verified", {
          component: "audit",
          correlationId: corrId,
          workflowId: workflowId,
          data: {
            uploadedBytes: record.mask.uploadedBytes,
            serverBytes: backBuf.length,
            match: backBuf.length === record.mask.uploadedBytes,
          },
        });
      } catch (e) {
        record.mask.verifiedOnServer = { error: e.message };
        logger.warn("audit.mask.verify_failed", {
          component: "audit",
          correlationId: corrId,
          data: { error: e.message },
        });
      }
    },

    /* ── Step 6: workflow patch + debug save ── */
    recordWorkflowPatch: function (variantId, nodeTypes, sourceFilename, maskFilename, patchedWorkflow) {
      record.comfyui.workflowPatch = {
        variantId: variantId,
        nodeCount: nodeTypes.length,
        nodeTypes: nodeTypes,
        sourceFilename: sourceFilename,
        maskFilename: maskFilename || null,
      };

      /* Save full patched workflow to audit dir (debug) */
      if (saveWorkflow) {
        try {
          ensureDir(auditDir);
          var nodeIds = Object.keys(patchedWorkflow);
          /* Sanitise: strip base64 image data */
          var sanitized = JSON.parse(JSON.stringify(patchedWorkflow));
          for (var dk = 0; dk < nodeIds.length; dk++) {
            var dn = sanitized[nodeIds[dk]];
            if (dn && dn.widgets_values && Array.isArray(dn.widgets_values)) {
              for (var dw = 0; dw < dn.widgets_values.length; dw++) {
                if (typeof dn.widgets_values[dw] === "string" && dn.widgets_values[dw].length > 200) {
                  dn.widgets_values[dw] = "[redacted, length=" + dn.widgets_values[dw].length + "]";
                }
              }
            }
          }
          fs.writeFileSync(
            path.join(auditDir, corrId + ".workflow.json"),
            JSON.stringify(sanitized, null, 2),
            "utf-8",
          );
        } catch (e) {
          logger.warn("audit.workflow_save_failed", {
            component: "audit",
            correlationId: corrId,
            data: { error: e.message },
          });
        }
      }
    },

    /* ── Step 7: prompt submitted ── */
    recordSubmit: function (promptId, baseUrl) {
      record.comfyui.baseUrl = baseUrl;
      record.comfyui.promptId = promptId;
    },

    /* ── Step 8: history / completion ── */
    recordHistory: function (historyEntry) {
      record.comfyui.historyStatus = {
        completed: historyEntry.status ? historyEntry.status.completed : null,
        statusStr: historyEntry.status ? historyEntry.status.status_str : null,
      };

      if (historyEntry.outputs) {
        var outputKeys = Object.keys(historyEntry.outputs);
        for (var i = 0; i < outputKeys.length; i++) {
          var nodeOutputs = historyEntry.outputs[outputKeys[i]];
          if (nodeOutputs && nodeOutputs.images) {
            for (var j = 0; j < nodeOutputs.images.length; j++) {
              record.comfyui.outputRefs.push({
                nodeId: outputKeys[i],
                filename: nodeOutputs.images[j].filename,
                subfolder: nodeOutputs.images[j].subfolder || "",
                type: nodeOutputs.images[j].type || "output",
              });
            }
          }
        }
      }
    },

    /* ── Step 9: output downloaded ── */
    recordOutput: function (outputDims, outputBuf) {
      record.result.comfyuiOutput = {
        width: outputDims.width,
        height: outputDims.height,
        bytes: outputBuf.length,
        sha256: sha256(outputBuf),
      };

      saveDebugImage(corrId + "-output.png", outputBuf);

      logger.info("audit.output.recorded", {
        component: "audit",
        correlationId: corrId,
        workflowId: workflowId,
        data: {
          width: outputDims.width,
          height: outputDims.height,
          bytes: outputBuf.length,
        },
      });
    },

    /* ── Step 10: final result dimensions ── */
    recordFinal: function (finalWidth, finalHeight, finalBytes) {
      record.result.finalReturned = {
        width: finalWidth,
        height: finalHeight,
        bytes: finalBytes,
      };
      record.completedAt = new Date().toISOString();
    },

    /* ── Write the audit JSON to disk ── */
    finalize: function () {
      try {
        ensureDir(auditDir);
        var filePath = path.join(auditDir, corrId + ".json");
        fs.writeFileSync(filePath, JSON.stringify(record, null, 2), "utf-8");

        logger.info("audit.saved", {
          component: "audit",
          correlationId: corrId,
          workflowId: workflowId,
          data: {
            path: filePath,
            promptId: record.comfyui.promptId,
            finalWidth: record.result.finalReturned ? record.result.finalReturned.width : null,
            finalHeight: record.result.finalReturned ? record.result.finalReturned.height : null,
          },
        });
      } catch (e) {
        logger.error("audit.save_failed", {
          component: "audit",
          correlationId: corrId,
          data: { error: e.message },
        });
      }
    },
  };
}
