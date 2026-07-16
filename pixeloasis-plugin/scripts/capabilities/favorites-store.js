/* favorites-store.js — v2 favorites persistence and management
 *
 * Storage key: po.favorites.v2
 * Structure:   { version: 2, ids: string[], tombstones: { [id]: removedAt } }
 *
 * Rules:
 *   - Max 12 favorites
 *   - Tombstone entries expire after 30 days
 *   - Favorites order is stable and user-controlled
 *   - Never store title, image, or usage time
 */

window.PO = window.PO || {};

window.PO.FavoritesStore = (function () {
  "use strict";

  var STORAGE_KEY = "po.favorites.v2";
  var MAX_FAVORITES = 12;
  var TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000; /* 30 days */

  /* ── Internal data ── */
  var _ids = [];
  var _tombstones = {}; /* { capabilityId: removedAt } */

  /* ── Atomic save ── */
  function _save() {
    try {
      var data = JSON.stringify({
        version: 2,
        ids: _ids.slice(),
        tombstones: _tombstones,
      });
      localStorage.setItem(STORAGE_KEY, data);
    } catch (e) {
      window.PO.Logger && window.PO.Logger.warn("favorites.save_failed", {
        component: "favorites-store",
        error: e,
      });
    }
  }

  /* ── Load from localStorage ── */
  function loadFavorites() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        _ids = [];
        _tombstones = {};
        return;
      }

      var data = JSON.parse(raw);

      /* Validate structure */
      if (!data || typeof data !== "object") throw new Error("invalid favorites data");

      var ids = Array.isArray(data.ids) ? data.ids : [];
      var tombstones = (data.tombstones && typeof data.tombstones === "object") ? data.tombstones : {};

      /* Filter non-string IDs */
      _ids = [];
      for (var i = 0; i < ids.length; i++) {
        if (typeof ids[i] === "string" && ids[i].length > 0) {
          _ids.push(ids[i]);
        }
      }

      /* Filter expired tombstones */
      var now = Date.now();
      _tombstones = {};
      var tombKeys = Object.keys(tombstones);
      for (var j = 0; j < tombKeys.length; j++) {
        var k = tombKeys[j];
        var removedAt = tombstones[k];
        if (typeof removedAt === "number" && (now - removedAt) < TOMBSTONE_TTL_MS) {
          _tombstones[k] = removedAt;
        }
      }

      /* Sync state */
      if (window.PO.state && window.PO.state.favorites) {
        window.PO.state.favorites.ids = _ids.slice();
        window.PO.state.favorites.tombstones = Object.assign({}, _tombstones);
      }
    } catch (e) {
      /* Corrupt storage → reset */
      window.PO.Logger && window.PO.Logger.warn("favorites.storage_corrupt", {
        component: "favorites-store",
        error: e,
        data: { storageKey: STORAGE_KEY },
      });
      _ids = [];
      _tombstones = {};
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) { /* ignore */ }
    }
  }

  /* ── Save (public, used after batch operations) ── */
  function saveFavorites() {
    _save();
    /* Sync to state */
    if (window.PO.state && window.PO.state.favorites) {
      window.PO.state.favorites.ids = _ids.slice();
      window.PO.state.favorites.tombstones = Object.assign({}, _tombstones);
    }
  }

  /* ── Check if an ID is a favorite ── */
  function isFavorite(id) {
    return _ids.indexOf(id) !== -1;
  }

  /* ── Get ordered favorites list ── */
  function getFavorites() {
    return _ids.slice();
  }

  /* ── Get favorite count ── */
  function getCount() {
    return _ids.length;
  }

  /* ── Toggle favorite status ── */
  function toggleFavorite(id) {
    if (!id || typeof id !== "string") return { added: false, removed: false };

    var idx = _ids.indexOf(id);

    if (idx !== -1) {
      /* Remove from favorites */
      _ids.splice(idx, 1);
      _tombstones[id] = Date.now();
      _save();
      return { added: false, removed: true };
    } else {
      /* Add to favorites */
      /* Validate capability exists and is not policy_disabled */
      if (window.PO.CapabilityStore) {
        var cap = window.PO.CapabilityStore.getById(id);
        if (!cap) {
          window.PO.Logger && window.PO.Logger.warn("favorites.add_rejected_not_found", {
            component: "favorites-store",
            data: { capabilityId: id },
          });
          return { added: false, removed: false, reason: "not-found" };
        }
        if (cap.availability && cap.availability.state === "policy_disabled") {
          window.PO.Logger && window.PO.Logger.warn("favorites.add_rejected_policy_disabled", {
            component: "favorites-store",
            data: { capabilityId: id },
          });
          return { added: false, removed: false, reason: "policy-disabled" };
        }
      }

      /* Enforce max */
      if (_ids.length >= MAX_FAVORITES) {
        window.PO.Logger && window.PO.Logger.warn("favorites.max_reached", {
          component: "favorites-store",
          data: { limit: MAX_FAVORITES, capabilityId: id },
        });
        return { added: false, removed: false, reason: "max-reached" };
      }

      /* Check if ID was tombstoned — restore at original position if possible */
      if (_tombstones[id]) {
        delete _tombstones[id];
      }

      _ids.push(id);
      _save();
      return { added: true, removed: false };
    }
  }

  /* ── Move favorite up/down ── */
  function moveFavorite(id, delta) {
    var idx = _ids.indexOf(id);
    if (idx === -1) return false;

    var newIdx = idx + delta;
    if (newIdx < 0 || newIdx >= _ids.length) return false;

    /* Swap */
    var tmp = _ids[idx];
    _ids[idx] = _ids[newIdx];
    _ids[newIdx] = tmp;

    _save();
    return true;
  }

  /* ── Remove a favorite by ID (explicit removal, not toggle) ── */
  function removeFavorite(id) {
    var idx = _ids.indexOf(id);
    if (idx === -1) return false;
    _ids.splice(idx, 1);
    _tombstones[id] = Date.now();
    _save();
    return true;
  }

  /* ── Prune tombstones for IDs no longer in the registry ── */
  function pruneTombstones(registryIds) {
    if (!Array.isArray(registryIds)) return;

    var registryMap = {};
    for (var i = 0; i < registryIds.length; i++) {
      registryMap[registryIds[i]] = true;
    }

    var now = Date.now();
    var tombKeys = Object.keys(_tombstones);
    var changed = false;

    for (var j = 0; j < tombKeys.length; j++) {
      var k = tombKeys[j];
      /* If the ID is back in the registry, keep the tombstone (for restore-position logic) */
      if (registryMap[k]) continue;
      /* If tombstone is older than 30 days, remove it */
      if ((now - _tombstones[k]) >= TOMBSTONE_TTL_MS) {
        delete _tombstones[k];
        changed = true;
      }
    }

    if (changed) _save();
  }

  /* ── Clear all favorites ── */
  function clearAll() {
    var allIds = _ids.slice();
    var now = Date.now();
    for (var i = 0; i < allIds.length; i++) {
      _tombstones[allIds[i]] = now;
    }
    _ids = [];
    _save();
  }

  return {
    loadFavorites:    loadFavorites,
    saveFavorites:    saveFavorites,
    isFavorite:       isFavorite,
    getFavorites:     getFavorites,
    getCount:         getCount,
    toggleFavorite:   toggleFavorite,
    moveFavorite:     moveFavorite,
    removeFavorite:   removeFavorite,
    pruneTombstones:  pruneTombstones,
    clearAll:         clearAll,
    MAX_FAVORITES:    MAX_FAVORITES,
  };
})();
