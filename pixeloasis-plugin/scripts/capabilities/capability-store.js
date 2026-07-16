/* capability-store.js — v2 capability cache, query, and gateway fetch
 *
 * Cache key: po.capabilityCache.v2
 * TTL: 24 hours
 *
 * Provides:
 *   refreshCapabilities({force})  — fetch from gateway or use fixture
 *   getById(id)                   — single capability lookup
 *   getGrouped()                  — { sectionId: [capabilities] }
 *   search(query)                 — local case-insensitive search
 *   getAvailability(id)           — readiness state
 *   getAll()                      — all capabilities array
 */

window.PO = window.PO || {};

window.PO.CapabilityStore = (function () {
  "use strict";

  var CACHE_KEY = "po.capabilityCache.v2";
  var CACHE_TTL_MS = 24 * 60 * 60 * 1000; /* 24 hours */
  var SCHEMA_VERSION = "2.0";

  /* ── Internal state ── */
  var _capabilities = [];        /* Array of normalized capability objects */
  var _byId = {};                /* Fast lookup */
  var _revision = null;
  var _status = "idle";          /* idle | loading | ready | error */
  var _error = null;

  /* ── Sync to window.PO.state ── */
  function _syncState() {
    if (!window.PO.state || !window.PO.state.capabilities) return;
    window.PO.state.capabilities.status = _status;
    window.PO.state.capabilities.revision = _revision;
    window.PO.state.capabilities.items = _capabilities.slice();
    window.PO.state.capabilities.error = _error;
  }

  /* ── Load capabilities from fixture ── */
  function _loadFixture() {
    var fixture = window.PO.CapabilityLabels.CAPABILITIES_FIXTURE;
    _capabilities = [];
    _byId = {};

    for (var i = 0; i < fixture.length; i++) {
      var normalized = window.PO.CapabilityLabels.normalizeCapability(fixture[i]);
      if (normalized) {
        _capabilities.push(normalized);
        _byId[normalized.id] = normalized;
      }
    }

    /* Sort by section order then ui.order */
    var sectionOrder = {};
    var sections = window.PO.CapabilityLabels.SECTION_ORDER;
    for (var si = 0; si < sections.length; si++) {
      sectionOrder[sections[si].id] = si;
    }

    _capabilities.sort(function (a, b) {
      var sa = sectionOrder[a.section] !== undefined ? sectionOrder[a.section] : 999;
      var sb = sectionOrder[b.section] !== undefined ? sectionOrder[b.section] : 999;
      if (sa !== sb) return sa - sb;
      return a.ui.order - b.ui.order;
    });

    _status = "ready";
    _error = null;
    _syncState();

    window.PO.Logger && window.PO.Logger.info("capabilities.loaded_fixture", {
      component: "capability-store",
      data: { count: _capabilities.length },
    });
  }

  /* ── Try loading from cache ── */
  function _loadCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return false;

      var data = JSON.parse(raw);
      if (!data || typeof data !== "object") return false;
      if (!Array.isArray(data.capabilities)) return false;

      var fetchedAt = data.fetchedAt || 0;
      if (Date.now() - fetchedAt > CACHE_TTL_MS) {
        /* Cache expired but still usable as base — mark as stale */
        window.PO.Logger && window.PO.Logger.info("capabilities.cache_expired", {
          component: "capability-store",
          data: { fetchedAt: fetchedAt, ageMs: Date.now() - fetchedAt },
        });
      }

      _capabilities = [];
      _byId = {};
      var rawCaps = data.capabilities;
      for (var i = 0; i < rawCaps.length; i++) {
        var normalized = window.PO.CapabilityLabels.normalizeCapability(rawCaps[i]);
        if (normalized) {
          _capabilities.push(normalized);
          _byId[normalized.id] = normalized;
        }
      }

      _revision = data.revision || null;
      _status = "ready";
      return true;
    } catch (e) {
      window.PO.Logger && window.PO.Logger.warn("capabilities.cache_corrupt", {
        component: "capability-store",
        error: e,
      });
      return false;
    }
  }

  /* ── Save to cache ── */
  function _saveCache(rawCapabilities, revision) {
    try {
      var data = JSON.stringify({
        fetchedAt: Date.now(),
        revision: revision || null,
        capabilities: rawCapabilities,
      });
      localStorage.setItem(CACHE_KEY, data);
    } catch (e) {
      window.PO.Logger && window.PO.Logger.warn("capabilities.cache_save_failed", {
        component: "capability-store",
        error: e,
      });
    }
  }

  /* ── Fetch from gateway ── */
  async function _fetchFromGateway() {
    var baseUrl = (window.PO.state && window.PO.state.gateway && window.PO.state.gateway.baseUrl) ||
                  (window.PO.state && window.PO.state.gatewayUrl) ||
                  "http://127.0.0.1:8787";

    try {
      var resp = await fetch(baseUrl + "/v2/capabilities?locale=zh-CN", {
        method: "GET",
        headers: { "Accept": "application/json" },
      });

      if (!resp.ok) {
        throw new Error("HTTP " + resp.status);
      }

      var data = await resp.json();

      /* Validate schema version */
      if (data.schemaVersion !== SCHEMA_VERSION) {
        window.PO.Logger && window.PO.Logger.warn("capabilities.wrong_schema_version", {
          component: "capability-store",
          data: { expected: SCHEMA_VERSION, got: data.schemaVersion },
        });
      }

      var rawCaps = Array.isArray(data.capabilities) ? data.capabilities : [];

      /* Normalize and validate */
      _capabilities = [];
      _byId = {};
      var seenIds = {};

      for (var i = 0; i < rawCaps.length; i++) {
        var raw = rawCaps[i];

        /* Duplicate ID check */
        if (seenIds[raw.id]) {
          window.PO.Logger && window.PO.Logger.warn("capabilities.duplicate_id", {
            component: "capability-store",
            data: { capabilityId: raw.id },
          });
          continue;
        }
        seenIds[raw.id] = true;

        var normalized = window.PO.CapabilityLabels.normalizeCapability(raw);
        if (normalized) {
          _capabilities.push(normalized);
          _byId[normalized.id] = normalized;
        }
      }

      _revision = data.revision || null;
      _status = "ready";
      _error = null;

      /* Save cache */
      _saveCache(rawCaps, _revision);

      _syncState();

      window.PO.Logger && window.PO.Logger.info("capabilities.fetched_from_gateway", {
        component: "capability-store",
        data: { count: _capabilities.length, revision: _revision },
      });

    } catch (e) {
      window.PO.Logger && window.PO.Logger.warn("capabilities.gateway_fetch_failed", {
        component: "capability-store",
        error: e,
      });
      throw e;
    }
  }

  /* ── Refresh capabilities ── */
  async function refreshCapabilities(opts) {
    opts = opts || {};
    var force = opts.force === true;

    _status = "loading";
    _syncState();

    /* Try gateway first (if forced or no cached data) */
    if (force || _capabilities.length === 0) {
      try {
        await _fetchFromGateway();
        return;
      } catch (e) {
        /* Gateway failed — try cache */
        if (_loadCache()) {
          window.PO.Logger && window.PO.Logger.info("capabilities.using_cache", {
            component: "capability-store",
          });
          _status = "ready";
          _syncState();
          return;
        }
        /* Cache also failed — use fixture */
      }
    } else {
      /* Already have data, try background refresh */
      try {
        await _fetchFromGateway();
        return;
      } catch (e) {
        /* Silently keep existing data */
      }
      return;
    }

    /* Fallback to fixture */
    _loadFixture();
  }

  /* ── Get capability by ID ── */
  function getById(id) {
    return _byId[id] || null;
  }

  /* ── Get all capabilities ── */
  function getAll() {
    return _capabilities.slice();
  }

  /* ── Get capabilities grouped by section ── */
  function getGrouped() {
    var grouped = {};
    var sections = window.PO.CapabilityLabels.SECTION_ORDER;

    for (var si = 0; si < sections.length; si++) {
      grouped[sections[si].id] = [];
    }

    for (var i = 0; i < _capabilities.length; i++) {
      var cap = _capabilities[i];
      /* Skip policy_disabled */
      if (cap.availability && cap.availability.state === "policy_disabled") continue;

      if (!grouped[cap.section]) {
        grouped[cap.section] = [];
      }
      grouped[cap.section].push(cap);
    }

    return grouped;
  }

  /* ── Search capabilities ── */
  function search(query) {
    if (!query || typeof query !== "string" || query.trim().length === 0) {
      return _capabilities.map(function (c) { return c.id; });
    }

    var q = query.trim().toLowerCase();
    var results = [];

    for (var i = 0; i < _capabilities.length; i++) {
      var cap = _capabilities[i];
      if (cap.availability && cap.availability.state === "policy_disabled") continue;

      /* Match against title */
      if (cap.title.toLowerCase().indexOf(q) !== -1) {
        results.push(cap.id);
        continue;
      }

      /* Match against description */
      if (cap.description.toLowerCase().indexOf(q) !== -1) {
        results.push(cap.id);
        continue;
      }

      /* Match against tags */
      if (Array.isArray(cap.tags)) {
        for (var j = 0; j < cap.tags.length; j++) {
          if (cap.tags[j].toLowerCase().indexOf(q) !== -1) {
            results.push(cap.id);
            break;
          }
        }
      }
    }

    /* Update filtered IDs in state */
    if (window.PO.state && window.PO.state.capabilities) {
      window.PO.state.capabilities.filteredIds = results.slice();
    }

    return results;
  }

  /* ── Get availability for a capability ── */
  function getAvailability(id) {
    var cap = _byId[id];
    if (!cap) return null;
    return cap.availability;
  }

  /* ── Get capability count ── */
  function getCount() {
    return _capabilities.length;
  }

  /* ── Get store status ── */
  function getStatus() {
    return _status;
  }

  return {
    refreshCapabilities: refreshCapabilities,
    getById:             getById,
    getAll:              getAll,
    getGrouped:          getGrouped,
    search:              search,
    getAvailability:     getAvailability,
    getCount:            getCount,
    getStatus:           getStatus,
  };
})();
