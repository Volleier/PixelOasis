/* job-store.js — v2 job metadata persistence
 *
 * Storage key: po.jobs.v2
 * Never stores base64, prompt content, asset binaries, or artifact URLs.
 *
 * TTL:
 *   - succeeded + placed: 7 days
 *   - failed / canceled: 24 hours
 *
 * Provides:
 *   load() / upsert(summary) / remove(jobId) / get(jobId)
 *   listActive() / listRecoverable() / markPlaced(jobId)
 */

window.PO = window.PO || {};

window.PO.JobStore = (function () {
  "use strict";

  var STORAGE_KEY = "po.jobs.v2";
  var SUCCEEDED_TTL_MS = 7 * 24 * 60 * 60 * 1000;  /* 7 days */
  var FAILED_TTL_MS = 24 * 60 * 60 * 1000;          /* 24 hours */
  var TERMINAL_STATES = { succeeded: true, failed: true, canceled: true };

  var _jobs = {}; /* { [jobId]: jobSummary } */

  /* ── Load from localStorage ── */
  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) { _jobs = {}; return; }

      var data = JSON.parse(raw);
      if (!data || typeof data !== "object" || !data.jobs) {
        throw new Error("invalid job store data");
      }

      var jobs = data.jobs;
      var now = Date.now();
      var validJobs = {};
      var jobIds = Object.keys(jobs);
      var pruned = 0;

      for (var i = 0; i < jobIds.length; i++) {
        var jid = jobIds[i];
        var job = jobs[jid];
        if (!job || typeof job !== "object") { pruned++; continue; }
        if (!job.jobId) { pruned++; continue; }

        /* Prune expired jobs */
        if (job.expiresAt && now > job.expiresAt) { pruned++; continue; }

        validJobs[jid] = job;
      }

      _jobs = validJobs;

      if (pruned > 0) {
        _save();
      }

      window.PO.Logger && window.PO.Logger.info("jobs.loaded", {
        component: "job-store",
        data: { count: Object.keys(_jobs).length, pruned: pruned },
      });
    } catch (e) {
      window.PO.Logger && window.PO.Logger.warn("jobs.storage_corrupt", {
        component: "job-store",
        error: e,
      });
      _jobs = {};
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) { /* ignore */ }
    }
  }

  /* ── Atomic save ── */
  function _save() {
    try {
      var data = JSON.stringify({ version: 2, jobs: _jobs });
      localStorage.setItem(STORAGE_KEY, data);
    } catch (e) {
      window.PO.Logger && window.PO.Logger.warn("jobs.save_failed", {
        component: "job-store",
        error: e,
      });
    }
  }

  /* ── Upsert job summary ── */
  function upsert(summary) {
    if (!summary || !summary.jobId) return;

    var existing = _jobs[summary.jobId];
    var merged = Object.assign({}, existing || {}, summary, {
      updatedAt: Date.now(),
    });

    /* Compute expiry */
    if (TERMINAL_STATES[merged.state]) {
      var ttl = merged.state === "succeeded" ? SUCCEEDED_TTL_MS : FAILED_TTL_MS;
      merged.expiresAt = Date.now() + ttl;
    }

    _jobs[summary.jobId] = merged;
    _save();

    /* Sync state */
    _syncState();
  }

  /* ── Remove job ── */
  function remove(jobId) {
    if (!_jobs[jobId]) return;
    delete _jobs[jobId];
    _save();
    _syncState();
  }

  /* ── Get single job ── */
  function get(jobId) {
    return _jobs[jobId] || null;
  }

  /* ── List non-terminal jobs ── */
  function listActive() {
    var active = [];
    var ids = Object.keys(_jobs);
    for (var i = 0; i < ids.length; i++) {
      var job = _jobs[ids[i]];
      if (!TERMINAL_STATES[job.state]) {
        active.push(job);
      }
    }
    return active;
  }

  /* ── List active jobs matching current document ── */
  function listRecoverable() {
    var docInfo = window.PO.CaptureUtils.getDocumentInfo();
    if (!docInfo) return [];

    var recoverable = [];
    var ids = Object.keys(_jobs);
    for (var i = 0; i < ids.length; i++) {
      var job = _jobs[ids[i]];
      /* Match documentId */
      if (job.documentId !== docInfo.id) continue;
      recoverable.push(job);
    }
    return recoverable;
  }

  /* ── Mark job as placed ── */
  function markPlaced(jobId) {
    var job = _jobs[jobId];
    if (!job) return;
    job.placementPlaced = true;
    job.placedAt = Date.now();
    job.expiresAt = Date.now() + SUCCEEDED_TTL_MS;
    _save();
  }

  /* ── Sync to state ── */
  function _syncState() {
    if (!window.PO.state || !window.PO.state.jobs) return;
    window.PO.state.jobs.byId = Object.assign({}, _jobs);
    var activeIds = [];
    var ids = Object.keys(_jobs);
    for (var i = 0; i < ids.length; i++) {
      if (!TERMINAL_STATES[_jobs[ids[i]].state]) {
        activeIds.push(ids[i]);
      }
    }
    window.PO.state.jobs.activeIds = activeIds;
  }

  /* ── Clear all jobs ── */
  function clearAll() {
    _jobs = {};
    _save();
    _syncState();
  }

  return {
    load:            load,
    upsert:          upsert,
    remove:          remove,
    get:             get,
    listActive:      listActive,
    listRecoverable: listRecoverable,
    markPlaced:      markPlaced,
    clearAll:        clearAll,
  };
})();
