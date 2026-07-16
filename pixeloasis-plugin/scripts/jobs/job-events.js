/* job-events.js — v2 SSE + polling fallback for job progress
 *
 * Watches a job's progress, preferring SSE with polling fallback.
 * Lifecycle is managed here — UI components do not own EventSource.
 *
 * State machine: queued → preparing → running → postprocessing → (succeeded|failed|canceled)
 *
 * Provides:
 *   watch(jobId, callbacks) → start tracking
 *   unwatch(jobId)           → stop tracking, clean up
 *   unwatchAll()             → clean up all watchers
 */

window.PO = window.PO || {};

window.PO.JobEvents = (function () {
  "use strict";

  /* ── Watcher state ── */
  var _watchers = {}; /* { jobId: { eventSource, timer, callbacks, lastSequence, backoffMs, lastState } } */

  var TERMINAL_STATES = { succeeded: true, failed: true, canceled: true };
  var POLL_BACKOFF = [1500, 3000, 6000, 10000];
  var MAX_POLL_BACKOFF = 15000;
  /* Valid state transitions: each state → allowed next states */
  var VALID_TRANSITIONS = {
    queued:         { preparing: true, failed: true, canceled: true },
    preparing:      { running: true, failed: true, canceled: true },
    running:        { postprocessing: true, failed: true, canceled: true },
    postprocessing: { succeeded: true, failed: true, canceled: true },
    succeeded:      {},
    failed:         {},
    canceled:       {},
  };

  /* ═══════════════════════════════════════════════════════════════════
   * watch(jobId, callbacks)
   * ═══════════════════════════════════════════════════════════════════ */

  function watch(jobId, callbacks) {
    if (!jobId) return;
    callbacks = callbacks || {};

    /* Already watching */
    if (_watchers[jobId]) return;

    var watcher = {
      eventSource: null,
      timer: null,
      callbacks: callbacks,
      lastSequence: 0,
      lastState: null,
      backoffMs: POLL_BACKOFF[0],
      backoffIdx: 0,
      pendingTerminal: null,
      polling: false,
    };

    _watchers[jobId] = watcher;

    window.PO.Logger && window.PO.Logger.info("job_events.watch_started", {
      component: "job-events",
      data: { jobId: jobId },
    });

    /* Try SSE first */
    _trySSE(jobId, watcher);
  }

  /* ── Try SSE connection ── */
  function _trySSE(jobId, watcher) {
    var es = window.PO.GatewayV2Client.subscribeJobEvents(jobId);

    if (!es) {
      /* SSE not available, fall back to polling */
      _fallbackToPolling(jobId, watcher);
      return;
    }

    watcher.eventSource = es;

    es.onopen = function () {
      window.PO.Logger && window.PO.Logger.info("job_events.sse_connected", {
        component: "job-events",
        data: { jobId: jobId },
      });
      /* Reset backoff on successful connection */
      watcher.backoffIdx = 0;
      watcher.backoffMs = POLL_BACKOFF[0];
    };

    function handleSseEvent(event) {
      try {
        var data = JSON.parse(event.data);
        _processEvent(jobId, watcher, data, event.type || "message");
        if (event.lastEventId) {
          watcher.lastSequence = parseInt(event.lastEventId, 10) || watcher.lastSequence;
        }
      } catch (e) {
        window.PO.Logger && window.PO.Logger.warn("job_events.sse_parse_error", {
          component: "job-events",
          error: e,
          data: { jobId: jobId },
        });
      }
    }

    es.onmessage = handleSseEvent;
    if (typeof es.addEventListener === "function") {
      es.addEventListener("state", handleSseEvent);
      es.addEventListener("state_change", handleSseEvent);
      es.addEventListener("complete", handleSseEvent);
    }

    es.onerror = function () {
      window.PO.Logger && window.PO.Logger.warn("job_events.sse_error", {
        component: "job-events",
        data: { jobId: jobId },
      });
      /* Close SSE, fall back to polling */
      _closeSSE(jobId, watcher);
      if (!watcher.polling) {
        _fallbackToPolling(jobId, watcher);
      }
    };
  }

  /* ── Close SSE connection ── */
  function _closeSSE(jobId, watcher) {
    if (watcher.eventSource) {
      try { watcher.eventSource.close(); } catch (e) { /* ignore */ }
      watcher.eventSource = null;
    }
  }

  /* ── Fall back to polling ── */
  function _fallbackToPolling(jobId, watcher) {
    if (!_watchers[jobId]) return; /* Already unwatched */
    if (watcher.polling) return;    /* Already polling */

    watcher.polling = true;
    window.PO.Logger && window.PO.Logger.info("job_events.polling_started", {
      component: "job-events",
      data: { jobId: jobId, backoffMs: watcher.backoffMs },
    });

    _pollJob(jobId, watcher);
  }

  /* ── Poll job status ── */
  async function _pollJob(jobId, watcher) {
    /* Attempt SSE recovery: if the EventSource reconnected, stop polling */
    if (watcher.eventSource && watcher.eventSource.readyState === 1 /* OPEN */) {
      watcher.polling = false;
      if (watcher.timer) { clearTimeout(watcher.timer); watcher.timer = null; }
      window.PO.Logger && window.PO.Logger.info("job_events.sse_recovered", {
        component: "job-events",
        data: { jobId: jobId },
      });
      return;
    }

    try {
      var result = await window.PO.GatewayV2Client.getJob(jobId);
      var data = result.data;

      if (data) {
        _processEvent(jobId, watcher, data, "poll");

        /* If terminal, stop */
        if (TERMINAL_STATES[data.state]) {
          _cleanupWatcher(jobId);
          return;
        }
      }
    } catch (e) {
      window.PO.Logger && window.PO.Logger.warn("job_events.poll_error", {
        component: "job-events",
        error: e,
        data: { jobId: jobId },
      });
    }

    /* Schedule next poll */
    if (!_watchers[jobId]) return; /* Unwatched during poll */

    watcher.timer = setTimeout(function () {
      _pollJob(jobId, watcher);
    }, watcher.backoffMs);

    /* Increase backoff (exponential, capped) */
    watcher.backoffIdx = Math.min(watcher.backoffIdx + 1, POLL_BACKOFF.length - 1);
    watcher.backoffMs = Math.min(POLL_BACKOFF[watcher.backoffIdx] || watcher.backoffMs * 1.5, MAX_POLL_BACKOFF);
  }

  /* ── Process an event / poll result ── */
  function _processEvent(jobId, watcher, data, eventType) {
    /* Dedup by sequence */
    if (data.sequence && data.sequence <= watcher.lastSequence) {
      return;
    }
    if (data.sequence) {
      watcher.lastSequence = data.sequence;
    }

    /* Validate state transition — reject terminal→back */
    var state = data.state || data.newState;
    var prevState = data.prevState || watcher.lastState;
    if (!state) return;
    data.state = state;

    /* Reject invalid transitions (e.g. terminal → back, skipped stages) */
    if (watcher.lastState && TERMINAL_STATES[watcher.lastState]) {
      window.PO.Logger && window.PO.Logger.warn("job_events.transition_rejected", {
        component: "job-events",
        data: { jobId: jobId, from: watcher.lastState, to: state, reason: "terminal" },
      });
      return;
    }
    if (watcher.lastState && VALID_TRANSITIONS[watcher.lastState] &&
        !VALID_TRANSITIONS[watcher.lastState][state]) {
      window.PO.Logger && window.PO.Logger.warn("job_events.transition_rejected", {
        component: "job-events",
        data: { jobId: jobId, from: watcher.lastState, to: state, reason: "invalid" },
      });
      return;
    }
    watcher.lastState = state;

    window.PO.Logger && window.PO.Logger.info("job_events.state_change", {
      component: "job-events",
      data: {
        jobId: jobId,
        state: state,
        prevState: prevState,
        progress: data.progress,
      },
    });

    /* Update job store */
    if (window.PO.JobStore) {
      window.PO.JobStore.upsert({
        jobId: jobId,
        state: state,
        progress: data.progress,
        result: data.artifacts ? { artifacts: data.artifacts, metrics: data.metrics, warnings: data.warnings } : null,
      });
    }

    /* Fire callbacks */
    if (watcher.callbacks.onStateChange) {
      watcher.callbacks.onStateChange(jobId, state, data);
    }
    if (typeof data.progress === "number" && watcher.callbacks.onProgress) {
      watcher.callbacks.onProgress(jobId, data.progress, data);
    }

    /* Terminal state */
    if (TERMINAL_STATES[state]) {
      if (eventType !== "complete" && eventType !== "poll") {
        watcher.pendingTerminal = data;
        return;
      }
      if (watcher.pendingTerminal) {
        data.message = data.message || watcher.pendingTerminal.message;
        data.error = data.error || watcher.pendingTerminal.error;
      }
      if (state === "succeeded" && watcher.callbacks.onComplete) {
        watcher.callbacks.onComplete(jobId, data);
      } else if (state === "failed" && watcher.callbacks.onError) {
        watcher.callbacks.onError(jobId, data.error || { message: data.message || "任务失败" });
      } else if (state === "canceled" && watcher.callbacks.onError) {
        watcher.callbacks.onError(jobId, { code: "CANCELED", message: "任务已取消" });
      }
      _cleanupWatcher(jobId);
    }
  }

  /* ── Clean up watcher ── */
  function _cleanupWatcher(jobId) {
    var watcher = _watchers[jobId];
    if (!watcher) return;

    _closeSSE(jobId, watcher);
    if (watcher.timer) {
      clearTimeout(watcher.timer);
      watcher.timer = null;
    }
    delete _watchers[jobId];

    window.PO.Logger && window.PO.Logger.info("job_events.watch_ended", {
      component: "job-events",
      data: { jobId: jobId },
    });
  }

  /* ═══════════════════════════════════════════════════════════════════
   * unwatch(jobId) — manually stop tracking
   * ═══════════════════════════════════════════════════════════════════ */

  function unwatch(jobId) {
    _cleanupWatcher(jobId);
  }

  /* ── Unwatch all ── */
  function unwatchAll() {
    var ids = Object.keys(_watchers);
    for (var i = 0; i < ids.length; i++) {
      _cleanupWatcher(ids[i]);
    }
  }

  return {
    watch:      watch,
    unwatch:    unwatch,
    unwatchAll: unwatchAll,
  };
})();
