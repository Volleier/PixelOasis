/* capability-controller.js — v2 capability entry point
 *
 * The single business-logic entry for capability card clicks.
 * Orchestrates: lookup → preflight → capture → parameter panel.
 *
 * Does NOT import or call jobController.submit().
 * Only one capture at a time.
 *
 * Provides:
 *   openCapability(capabilityId)  → full pipeline
 */

window.PO = window.PO || {};

window.PO.CapabilityController = (function () {
  "use strict";

  /* ── Guard: prevent concurrent capture ── */
  var _busy = false;

  /* ═══════════════════════════════════════════════════════════════════
   * openCapability(capabilityId)
   * ═══════════════════════════════════════════════════════════════════ */

  async function openCapability(capabilityId) {
    if (_busy) {
      window.PO.Logger && window.PO.Logger.warn("controller.busy", {
        component: "capability-controller",
        data: { capabilityId: capabilityId },
      });
      return;
    }

    _busy = true;
    var capture = null;
    var preflightResult = null;

    try {
      /* ── Step 1: Lookup capability ── */
      var capability = window.PO.CapabilityStore.getById(capabilityId);
      if (!capability) {
        window.PO.showTransientStatus &&
          window.PO.showTransientStatus("能力不存在或已停用");
        return;
      }

      window.PO.Logger && window.PO.Logger.info("controller.open_capability", {
        component: "capability-controller",
        data: {
          capabilityId: capabilityId,
          title: capability.title,
          source: capability.input ? capability.input.source : "unknown",
        },
      });

      /* Update state */
      if (window.PO.state && window.PO.state.capture) {
        window.PO.state.capture.status = "preflighting";
      }

      /* ── Step 2: Preflight ── */
      preflightResult = await window.PO.Preflight.prepare(capability);

      if (!preflightResult.passed) {
        var err = preflightResult.error;
        window.PO.showTransientStatus &&
          window.PO.showTransientStatus(err.userMessage || "预检失败");
        window.PO.Logger && window.PO.Logger.warn("controller.preflight_failed", {
          component: "capability-controller",
          data: {
            capabilityId: capabilityId,
            errorCode: err.code,
            errorMessage: err.userMessage,
          },
        });

        /* Handle specific errors */
        if (err.action === "open-environment") {
          /* In P5, this opens the environment status panel */
        }

        _resetCaptureState();
        return;
      }

      /* ── Step 2.5: Sensitive action confirmation ── */
      if (preflightResult.requireAdultConfirm) {
        /* Adult confirm happens inside the parameter panel, not here.
           The parameter panel will show the confirmation checkbox.
           We proceed to capture — the submit button stays disabled
           until the user checks the confirmation. */
      }

      /* ── Step 3: Capture ── */
      if (window.PO.state && window.PO.state.capture) {
        window.PO.state.capture.status = "capturing";
      }

      window.PO.setStatus && window.PO.setStatus("正在采集图像…");

      try {
        capture = await _captureForContract(capability, preflightResult);
      } catch (captureErr) {
        window.PO.CaptureUtils.releaseCapture(capture);
        window.PO.showTransientStatus &&
          window.PO.showTransientStatus(
            captureErr instanceof Error ? captureErr.message : "图像采集失败"
          );
        window.PO.Logger && window.PO.Logger.error("controller.capture_failed", {
          component: "capability-controller",
          error: captureErr,
          data: { capabilityId: capabilityId },
        });
        _resetCaptureState();
        return;
      }

      if (!capture) {
        window.PO.showTransientStatus &&
          window.PO.showTransientStatus("图像采集失败，请重试");
        _resetCaptureState();
        return;
      }

      /* ── Step 4: Open parameter panel ── */
      window.PO.ParameterPanel.open({
        capability: capability,
        capture: capture,
        preflight: preflightResult,
      });

      _busy = false;
      /* capture stays in state; released by parameter panel on close */

    } catch (error) {
      window.PO.CaptureUtils.releaseCapture(capture);
      _resetCaptureState();
      _busy = false;

      window.PO.Logger && window.PO.Logger.error("controller.open_failed", {
        component: "capability-controller",
        error: error,
        data: { capabilityId: capabilityId },
      });

      window.PO.showTransientStatus &&
        window.PO.showTransientStatus(
          error instanceof Error ? error.message : "操作失败，请重试"
        );
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
   * _captureForContract(capability, preflight)
   * ═══════════════════════════════════════════════════════════════════ */

  async function _captureForContract(capability, preflight) {
    var input = capability.input || {};
    var source = input.source || "document";

    var policy = window.PO.CaptureUtils.getDefaultPolicy();
    /* Adjust policy based on capability hints */
    if (input.maxPixels) policy.maxPixels = input.maxPixels;

    switch (source) {
      case "selection":
        /* Selection-required capabilities */
        return await window.PO.SelectionCapture.captureSelectionContext(policy);

      case "document":
        /* Full-document capabilities that also need subject */
        if (preflight.requireSubjectChoice) {
          /* Use subject capture with auto mode (user can switch in panel) */
          return await window.PO.SubjectCapture.captureSubjectContext(policy, {
            mode: "auto",
          });
        }
        /* Plain document capture */
        return await window.PO.DocumentCapture.captureDocumentComposite(policy);

      default:
        /* Fallback: document capture */
        window.PO.Logger && window.PO.Logger.warn("controller.unknown_source", {
          component: "capability-controller",
          data: { source: source, capabilityId: capability.id },
        });
        return await window.PO.DocumentCapture.captureDocumentComposite(policy);
    }
  }

  /* ── Reset capture state on failure ── */
  function _resetCaptureState() {
    if (window.PO.state && window.PO.state.capture) {
      window.PO.state.capture.status = "idle";
      window.PO.state.capture.active = null;
    }
  }

  return {
    openCapability: openCapability,
  };
})();
