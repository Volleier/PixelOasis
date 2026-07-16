/* job-controller.js — v2 job lifecycle orchestrator
 *
 * The single entry point for job creation and management.
 * Handles: asset upload → job creation → progress tracking → result display.
 *
 * In P2: uses mock job simulation when gateway is unavailable.
 * Does NOT auto-place results into Photoshop (that's P3).
 *
 * Provides:
 *   createAndSubmit({capability, capture, values, preflight})
 *   cancel(jobId)
 *   recoverActiveJobs()
 */

window.PO = window.PO || {};

window.PO.JobController = (function () {
  "use strict";

  var _submitting = {}; /* idempotencyKey → true — prevents double-submit */

  /* ═══════════════════════════════════════════════════════════════════
   * createAndSubmit({ capability, capture, values, preflight })
   * ═══════════════════════════════════════════════════════════════════ */

  async function createAndSubmit(opts) {
    opts = opts || {};
    var capability = opts.capability;
    var capture = opts.capture;
    var values = opts.values || {};
    var preflight = opts.preflight;

    if (!capability || !capture) {
      throw new Error("缺少能力或采集数据");
    }

    /* Generate IDs */
    var correlationId = "po-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 10000).toString(36);
    var docInfo = capture.documentInfo || window.PO.CaptureUtils.getDocumentInfo();
    var documentId = docInfo ? docInfo.id : "0";
    var historyStateId = "0"; /* P2: simplified; real history state ID from Photoshop API */
    var nonce = Math.floor(Math.random() * 100000).toString(36);
    var idempotencyKey = documentId + ":" + historyStateId + ":" + capability.id + ":" + nonce;

    /* Prevent double-submit */
    if (_submitting[idempotencyKey]) {
      window.PO.Logger && window.PO.Logger.warn("job.duplicate_submit_blocked", {
        component: "job-controller",
        correlationId: correlationId,
        data: { capabilityId: capability.id, idempotencyKey: idempotencyKey },
      });
      throw new Error("任务正在提交中，请勿重复操作");
    }
    _submitting[idempotencyKey] = true;

    try {
      window.PO.Logger && window.PO.Logger.info("job.submit_started", {
        component: "job-controller",
        correlationId: correlationId,
        data: { capabilityId: capability.id, idempotencyKey: idempotencyKey },
      });

      /* ── Upload assets ── */
      var sourceAssetId = null;
      var editMaskAssetId = null;
      var subjectMaskAssetId = null;

      /* Source image (always required) */
      var sourceB64 = capture.imagePngBase64 || capture.contextImagePngBase64;
      if (sourceB64) {
        try {
          var sourceResult = await window.PO.AssetUploader.uploadAsset(
            "source", sourceB64, correlationId, documentId
          );
          sourceAssetId = sourceResult.assetId;
        } catch (e) {
          throw new Error("源图上传失败：" + (e.userMessage || e.message));
        }
      }

      /* Edit mask (for selection-based capabilities) */
      if (capture.editMaskPngBase64) {
        try {
          var maskResult = await window.PO.AssetUploader.uploadAsset(
            "editMask", capture.editMaskPngBase64, correlationId, documentId
          );
          editMaskAssetId = maskResult.assetId;
        } catch (e) {
          /* Mask upload failure is non-fatal for some capabilities */
          window.PO.Logger && window.PO.Logger.warn("job.mask_upload_failed", {
            component: "job-controller",
            correlationId: correlationId,
            error: e,
          });
        }
      }

      /* Subject mask */
      if (capture.subjectMaskPngBase64) {
        try {
          var subjResult = await window.PO.AssetUploader.uploadAsset(
            "subjectMask", capture.subjectMaskPngBase64, correlationId, documentId
          );
          subjectMaskAssetId = subjResult.assetId;
        } catch (e) {
          window.PO.Logger && window.PO.Logger.warn("job.subject_mask_upload_failed", {
            component: "job-controller",
            correlationId: correlationId,
            error: e,
          });
        }
      }

      /* ── Build job payload ── */
      var bounds = capture.editBounds || capture.subjectBounds || capture.bounds;
      var payload = {
        schemaVersion: "2.0",
        capabilityId: capability.id,
        correlationId: correlationId,
        idempotencyKey: idempotencyKey,
        source: {
          assetId: sourceAssetId,
          scope: capture.scope || "document",
          document: {
            id: documentId,
            width: docInfo ? docInfo.width : 0,
            height: docInfo ? docInfo.height : 0,
            colorMode: docInfo ? docInfo.mode : "RGB",
            bitDepth: docInfo ? docInfo.bitDepth : 8,
          },
          bounds: bounds || { left: 0, top: 0, width: 0, height: 0 },
        },
        inputs: {
          editMaskAssetId: editMaskAssetId || null,
          subjectMaskAssetId: subjectMaskAssetId || null,
          referenceAssetIds: [],
          points: [],
        },
        parameters: values,
        options: {
          profile: values.profile || "quality_16gb",
        },
        clientCapabilities: {
          multiArtifact: true,
          smartObject: true,
          layerMask: true,
        },
      };

      /* ── Create job (try gateway, fall back to mock) ── */
      var jobResult;
      var useMock = false;

      try {
        var resp = await window.PO.GatewayV2Client.createJob(payload);
        if (resp.ok && resp.status === 202) {
          jobResult = resp.data;
        } else {
          throw new Error("Unexpected response: " + resp.status);
        }
      } catch (e) {
        window.PO.Logger && window.PO.Logger.warn("job.gateway_create_failed_using_mock", {
          component: "job-controller",
          correlationId: correlationId,
          error: e,
        });
        useMock = true;
        jobResult = _createMockJob(correlationId, capability.id);
      }

      var jobId = jobResult.jobId;
      if (!jobId) throw new Error("No jobId returned");

      /* ── Store job ── */
      window.PO.JobStore.upsert({
        jobId: jobId,
        capabilityId: capability.id,
        capabilityTitle: capability.title,
        documentId: documentId,
        historyStateId: historyStateId,
        state: "queued",
        correlationId: correlationId,
        progress: 0,
        createdAt: Date.now(),
      });

      /* ── Start tracking ── */
      if (useMock) {
        _mockJobSimulation(jobId, capability.title);
      } else {
        window.PO.JobEvents.watch(jobId, {
          onStateChange: function (jid, state) {
            _updateProgressUI(jid, state);
          },
          onProgress: function (jid, progress) {
            _updateProgressUI(jid, null, progress);
          },
          onComplete: function (jid, result) {
            _onJobComplete(jid, result);
          },
          onError: function (jid, error) {
            _onJobError(jid, error);
          },
        });
      }

      window.PO.Logger && window.PO.Logger.info("job.created", {
        component: "job-controller",
        correlationId: correlationId,
        data: { jobId: jobId, capabilityId: capability.id, mock: useMock },
      });

      return { jobId: jobId, correlationId: correlationId, mock: useMock };

    } catch (e) {
      window.PO.Logger && window.PO.Logger.error("job.submit_failed", {
        component: "job-controller",
        correlationId: correlationId,
        error: e,
        data: { capabilityId: capability.id },
      });
      throw e;
    } finally {
      delete _submitting[idempotencyKey];
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
   * cancel(jobId)
   * ═══════════════════════════════════════════════════════════════════ */

  async function cancel(jobId) {
    window.PO.JobStore.upsert({ jobId: jobId, state: "canceled" });
    window.PO.JobEvents.unwatch(jobId);

    try {
      await window.PO.GatewayV2Client.cancelJob(jobId);
    } catch (e) {
      /* Mark as canceled locally even if server cancel fails */
      window.PO.Logger && window.PO.Logger.warn("job.cancel_server_failed", {
        component: "job-controller",
        error: e,
        data: { jobId: jobId },
      });
    }

    window.PO.Logger && window.PO.Logger.info("job.canceled", {
      component: "job-controller",
      data: { jobId: jobId },
    });

    if (window.PO.ProgressPanel) window.PO.ProgressPanel.hide();
  }

  /* ═══════════════════════════════════════════════════════════════════
   * recoverActiveJobs()
   * ═══════════════════════════════════════════════════════════════════ */

  async function recoverActiveJobs() {
    var active = window.PO.JobStore.listActive();
    if (active.length === 0) return;

    window.PO.Logger && window.PO.Logger.info("job.recovering", {
      component: "job-controller",
      data: { count: active.length },
    });

    for (var i = 0; i < active.length; i++) {
      var job = active[i];

      /* Try to get current status from server */
      try {
        var resp = await window.PO.GatewayV2Client.getJob(job.jobId);
        if (resp.ok && resp.data) {
          var state = resp.data.state;
          window.PO.JobStore.upsert({
            jobId: job.jobId,
            state: state,
            progress: resp.data.progress,
          });

          if (state === "succeeded" || state === "failed" || state === "canceled") {
            /* Terminal state reached while away */
            continue;
          }
        }
      } catch (e) {
        /* Server unreachable — use local state */
      }

      /* Re-watch active jobs */
      window.PO.JobEvents.watch(job.jobId, {
        onStateChange: function (jid, state) { _updateProgressUI(jid, state); },
        onProgress: function (jid, progress) { _updateProgressUI(jid, null, progress); },
        onComplete: function (jid, result) { _onJobComplete(jid, result); },
        onError: function (jid, error) { _onJobError(jid, error); },
      });
    }

    /* Show progress panel if active jobs exist */
    var stillActive = window.PO.JobStore.listActive();
    if (stillActive.length > 0 && window.PO.ProgressPanel) {
      window.PO.ProgressPanel.show();
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
   * Mock job simulation (P2 — no ComfyUI dependency)
   * ═══════════════════════════════════════════════════════════════════ */

  function _createMockJob(correlationId, capabilityId) {
    return {
      jobId: "job_mock_" + correlationId.replace(/[^a-zA-Z0-9_-]/g, "").substring(0, 20),
      correlationId: correlationId,
      state: "queued",
      statusUrl: "/v2/jobs/mock",
      eventsUrl: "/v2/jobs/mock/events",
      cancelUrl: "/v2/jobs/mock",
    };
  }

  function _mockJobSimulation(jobId, capabilityTitle) {
    var stages = [
      { delay: 1000,  state: "preparing",      progress: 10 },
      { delay: 2500,  state: "running",         progress: 25 },
      { delay: 4500,  state: "running",         progress: 50 },
      { delay: 6500,  state: "running",         progress: 70 },
      { delay: 8500,  state: "postprocessing",  progress: 90 },
      { delay: 10000, state: "succeeded",       progress: 100 },
    ];

    for (var i = 0; i < stages.length; i++) {
      (function (stage) {
        setTimeout(function () {
          if (!window.PO.JobStore.get(jobId)) return; /* Job removed */

          window.PO.JobStore.upsert({
            jobId: jobId,
            state: stage.state,
            progress: stage.progress,
          });

          /* Update progress UI */
          _updateProgressUI(jobId, stage.state, stage.progress);

          /* Terminal */
          if (stage.state === "succeeded") {
            _onJobComplete(jobId, _mockArtifacts(jobId, capabilityTitle));
          }
        }, stage.delay);
      })(stages[i]);
    }
  }

  function _mockArtifacts(jobId, capabilityTitle) {
    return {
      state: "succeeded",
      progress: 100,
      artifacts: [
        {
          id: "art_mock_" + jobId + "_0",
          role: "result",
          mimeType: "image/png",
          downloadUrl: "/v2/artifacts/mock_" + jobId + "_0",
          width: 1920,
          height: 1080,
          sha256: "mock-sha256-" + jobId + "-0",
          placement: {
            bounds: { left: 0, top: 0, width: 1920, height: 1080 },
            layerName: "PixelOasis / " + (capabilityTitle || "Result") + " / 结果",
            groupName: "PixelOasis / " + (capabilityTitle || "Result"),
            blendMode: "normal",
            opacity: 100,
            maskArtifactId: null,
            createSmartObject: true,
            order: 10,
          },
        },
      ],
      metrics: {
        durationMs: 8520,
        profile: "quality_16gb",
        seed: Math.floor(Math.random() * 2147483647),
      },
      warnings: [],
      _mock: true,
    };
  }

  /* ═══════════════════════════════════════════════════════════════════
   * Internal: update progress UI
   * ═══════════════════════════════════════════════════════════════════ */

  function _updateProgressUI(jobId, state, progress) {
    if (window.PO.ProgressPanel) {
      if (state) window.PO.ProgressPanel.update(jobId, state, progress);
    }
    var activeCount = window.PO.JobStore.listActive().length;
    if (window.PO.CapabilitySections && window.PO.CapabilitySections.updateTaskLink) {
      window.PO.CapabilitySections.updateTaskLink(activeCount);
    }
  }

  /* ── Job completed successfully ── */
  function _onJobComplete(jobId, result) {
    window.PO.Logger && window.PO.Logger.info("job.completed", {
      component: "job-controller",
      data: {
        jobId: jobId,
        artifactCount: (result.artifacts && result.artifacts.length) || 0,
        mock: result._mock || false,
      },
    });

    /* Show result panel — does NOT auto-place (that's P3) */
    if (window.PO.ResultPanel) {
      window.PO.ResultPanel.show(jobId, result);
    }
  }

  /* ── Job failed ── */
  function _onJobError(jobId, error) {
    window.PO.Logger && window.PO.Logger.error("job.failed", {
      component: "job-controller",
      data: { jobId: jobId, error: error },
    });

    if (window.PO.ResultPanel) {
      window.PO.ResultPanel.showError(jobId, error);
    }
  }

  return {
    createAndSubmit:   createAndSubmit,
    cancel:            cancel,
    recoverActiveJobs: recoverActiveJobs,
  };
})();
