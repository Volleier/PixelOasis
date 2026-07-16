/* capability-sections.js — v2 UI rendering: search, favorites, sections, cards
 *
 * All DOM creation uses document.createElement / textContent (NO innerHTML
 * for gateway-provided text).  Event handling uses delegation on the app
 * container — no per-card bindings.
 *
 * Provides:
 *   renderApp()                    — build complete v2 app DOM
 *   renderFavorites()              — render favorite cards in favorites area
 *   renderSection(sectionId)       — render capability cards for one section
 *   renderCapabilityCard(cap)      — create a single card DOM element
 *   setSearch(query)               — filter visible cards
 *   toggleSection(sectionId)       — collapse / expand
 */

window.PO = window.PO || {};

window.PO.CapabilitySections = (function () {
  "use strict";

  /* ── Element references (set by renderApp) ── */
  var _appRoot = null;
  var _searchInput = null;
  var _favoritesContainer = null;
  var _favoritesCount = null;
  var _favoritesEmpty = null;
  var _sectionContainers = {};   /* sectionId → .po-section__body */
  var _sectionHeaders = {};      /* sectionId → .po-section__header button */

  /* ── Current search query ── */
  var _currentQuery = "";

  /* ── P0 placeholder message ── */
  var PLACEHOLDER_MSG = "能力配置将在下一阶段接入";

  /* ═══════════════════════════════════════════════════════════════════
   * renderCapabilityCard(capability) → HTMLElement
   * ═══════════════════════════════════════════════════════════════════ */

  function renderCapabilityCard(cap) {
    var card = document.createElement("div");
    card.className = "po-capability-card";
    card.setAttribute("data-capability-id", cap.id);

    /* Disabled state */
    var avail = cap.availability;
    var isDisabled = (avail && (avail.state === "missing_models" ||
                                avail.state === "missing_nodes" ||
                                avail.state === "unsupported_hardware"));
    var isPolicyDisabled = (avail && avail.state === "policy_disabled");

    if (isDisabled) {
      card.setAttribute("aria-disabled", "true");
      card.classList.add("po-capability-card--disabled");
    }

    /* ── Card body (clickable area) ── */
    var body = document.createElement("button");
    body.className = "po-capability-card__body";
    body.type = "button";
    body.setAttribute("data-capability-id", cap.id);
    if (isDisabled) {
      body.disabled = true;
      body.setAttribute("aria-disabled", "true");
    }
    body.setAttribute("aria-label", cap.title + " — " + (cap.description || ""));

    /* Icon placeholder */
    var icon = document.createElement("span");
    icon.className = "po-capability-card__icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = _iconGlyph(cap.icon);
    body.appendChild(icon);

    /* Text area */
    var text = document.createElement("span");
    text.className = "po-capability-card__text";

    var title = document.createElement("span");
    title.className = "po-capability-card__title";
    title.textContent = cap.title; /* textContent only */
    text.appendChild(title);

    var desc = document.createElement("span");
    desc.className = "po-capability-card__desc";
    desc.textContent = cap.description; /* textContent only */
    text.appendChild(desc);

    /* Input requirements badge */
    var inputSummary = window.PO.CapabilityLabels.getInputSummary(cap.input);
    if (inputSummary) {
      var req = document.createElement("span");
      req.className = "po-capability-card__input-req";
      req.textContent = inputSummary;
      text.appendChild(req);
    }

    body.appendChild(text);

    /* Availability badge */
    var readinessInfo = window.PO.CapabilityLabels.getReadinessInfo(avail ? avail.state : "ready");
    if (readinessInfo.text) {
      var badge = document.createElement("span");
      badge.className = "po-badge " + readinessInfo.cls;
      badge.textContent = readinessInfo.text;
      body.appendChild(badge);
    }

    card.appendChild(body);

    /* ── Favorite toggle ── */
    var favBtn = document.createElement("button");
    favBtn.className = "po-favorite-toggle";
    favBtn.type = "button";
    favBtn.setAttribute("data-action", "toggle-favorite");
    favBtn.setAttribute("data-capability-id", cap.id);
    favBtn.setAttribute("aria-label", "收藏 " + cap.title);
    var isFav = window.PO.FavoritesStore.isFavorite(cap.id);
    favBtn.setAttribute("aria-pressed", isFav ? "true" : "false");
    favBtn.textContent = isFav ? "★" : "☆";

    /* Disable favorite toggle if policy_disabled */
    if (isPolicyDisabled) {
      favBtn.disabled = true;
      favBtn.setAttribute("aria-disabled", "true");
      /* Don't render policy_disabled cards at all */
    }

    card.appendChild(favBtn);

    return card;
  }

  /* ── Icon glyph mapping ── */
  function _iconGlyph(icon) {
    var glyphs = {
      effects:   "✦",
      combat:    "⚔",
      studio:    "◼",
      portrait:  "👤",
      hair:      "💇",
      lighting:  "☀",
    };
    return glyphs[icon] || "◆";
  }

  /* ═══════════════════════════════════════════════════════════════════
   * renderFavorites()
   * ═══════════════════════════════════════════════════════════════════ */

  function renderFavorites() {
    if (!_favoritesContainer || !_favoritesEmpty || !_favoritesCount) return;

    /* Clear existing cards (keep empty state + count) */
    var existingCards = _favoritesContainer.querySelectorAll(".po-capability-card");
    for (var i = 0; i < existingCards.length; i++) {
      existingCards[i].remove();
    }

    var favIds = window.PO.FavoritesStore.getFavorites();
    var count = favIds.length;

    /* Update count display */
    _favoritesCount.textContent = "(" + count + "/" + window.PO.FavoritesStore.MAX_FAVORITES + ")";

    if (count === 0) {
      _favoritesEmpty.style.display = "";
    } else {
      _favoritesEmpty.style.display = "none";

      for (var j = 0; j < favIds.length; j++) {
        var cap = window.PO.CapabilityStore.getById(favIds[j]);
        if (!cap) continue; /* Skip IDs not in current registry */

        /* Filter by search */
        if (_currentQuery && !_matchesSearch(cap, _currentQuery)) continue;

        var card = renderCapabilityCard(cap);

        /* Add move-up / move-down buttons for favorites */
        if (j > 0) {
          var upBtn = _makeMoveBtn(favIds[j], -1, "上移");
          card.appendChild(upBtn);
        }
        if (j < favIds.length - 1) {
          var downBtn = _makeMoveBtn(favIds[j], 1, "下移");
          card.appendChild(downBtn);
        }

        _favoritesContainer.appendChild(card);
      }
    }
  }

  function _makeMoveBtn(capId, delta, label) {
    var btn = document.createElement("button");
    btn.className = "po-favorite-move-btn";
    btn.type = "button";
    btn.setAttribute("data-action", "move-favorite");
    btn.setAttribute("data-capability-id", capId);
    btn.setAttribute("data-delta", String(delta));
    btn.setAttribute("aria-label", label);
    btn.textContent = delta < 0 ? "▲" : "▼";
    return btn;
  }

  /* ═══════════════════════════════════════════════════════════════════
   * renderSection(sectionId)
   * ═══════════════════════════════════════════════════════════════════ */

  function renderSection(sectionId) {
    var container = _sectionContainers[sectionId];
    if (!container) return;

    /* Clear existing cards */
    container.innerHTML = "";

    var grouped = window.PO.CapabilityStore.getGrouped();
    var caps = grouped[sectionId] || [];

    if (caps.length === 0) {
      var empty = document.createElement("div");
      empty.className = "po-section__empty";
      empty.textContent = "该分区暂无可用能力";
      container.appendChild(empty);
      return;
    }

    /* Filter by search */
    var visibleCount = 0;
    for (var i = 0; i < caps.length; i++) {
      var cap = caps[i];

      /* Don't render policy_disabled */
      if (cap.availability && cap.availability.state === "policy_disabled") continue;

      /* Search filter */
      if (_currentQuery && !_matchesSearch(cap, _currentQuery)) continue;

      /* Don't render cards that are already shown as favorites */
      /* (roadmap says: favorites cards are a second view, still show in section) */
      /* Actually re-reading: "未收藏能力仅在所属分区显示一次" — so favorited ones
         DO appear in both places (收藏区 is a second view of the same card) */

      var card = renderCapabilityCard(cap);
      container.appendChild(card);
      visibleCount++;
    }

    if (visibleCount === 0 && _currentQuery) {
      var noMatch = document.createElement("div");
      noMatch.className = "po-section__empty";
      noMatch.textContent = "无匹配结果";
      container.appendChild(noMatch);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
   * renderAllSections()
   * ═══════════════════════════════════════════════════════════════════ */

  function renderAllSections() {
    var sections = window.PO.CapabilityLabels.SECTION_ORDER;
    for (var i = 0; i < sections.length; i++) {
      renderSection(sections[i].id);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
   * renderAll (favorites + all sections)
   * ═══════════════════════════════════════════════════════════════════ */

  function renderAll() {
    renderFavorites();
    renderAllSections();
  }

  /* ═══════════════════════════════════════════════════════════════════
   * setSearch(query)
   * ═══════════════════════════════════════════════════════════════════ */

  function setSearch(query) {
    _currentQuery = (query && typeof query === "string") ? query.trim() : "";
    if (_searchInput && _searchInput.value !== _currentQuery) {
      _searchInput.value = _currentQuery;
    }

    /* Update state */
    window.PO.CapabilityStore.search(_currentQuery);
    if (window.PO.state && window.PO.state.ui) {
      window.PO.state.ui.search = _currentQuery;
    }

    renderAll();
  }

  /* ═══════════════════════════════════════════════════════════════════
   * toggleSection(sectionId)
   * ═══════════════════════════════════════════════════════════════════ */

  function toggleSection(sectionId) {
    var header = _sectionHeaders[sectionId];
    var body = _sectionContainers[sectionId];
    if (!header || !body) return;

    var sectionEl = header.closest(".po-section");
    if (!sectionEl) return;

    var isCollapsed = sectionEl.classList.toggle("po-section--collapsed");
    header.setAttribute("aria-expanded", isCollapsed ? "false" : "true");

    /* Persist */
    if (window.PO.state && window.PO.state.ui) {
      window.PO.state.ui.collapsedSections[sectionId] = isCollapsed;
    }
    try {
      var raw = localStorage.getItem("po.sectionCollapse.v2");
      var data = raw ? JSON.parse(raw) : {};
      data[sectionId] = isCollapsed;
      localStorage.setItem("po.sectionCollapse.v2", JSON.stringify(data));
    } catch (e) { /* ignore */ }
  }

  /* ── Restore section collapse state ── */
  function restoreCollapseState() {
    try {
      var raw = localStorage.getItem("po.sectionCollapse.v2");
      if (!raw) return;
      var data = JSON.parse(raw);
      if (!data || typeof data !== "object") return;
      var sections = window.PO.CapabilityLabels.SECTION_ORDER;
      for (var i = 0; i < sections.length; i++) {
        var sid = sections[i].id;
        if (data[sid] === true) {
          var header = _sectionHeaders[sid];
          var body = _sectionContainers[sid];
          if (header && body) {
            var sectionEl = header.closest(".po-section");
            if (sectionEl) {
              sectionEl.classList.add("po-section--collapsed");
              header.setAttribute("aria-expanded", "false");
            }
          }
          if (window.PO.state && window.PO.state.ui) {
            window.PO.state.ui.collapsedSections[sid] = true;
          }
        }
      }
    } catch (e) { /* ignore */ }
  }

  /* ═══════════════════════════════════════════════════════════════════
   * _matchesSearch(capability, query)
   * ═══════════════════════════════════════════════════════════════════ */

  function _matchesSearch(cap, q) {
    if (!q) return true;
    var lq = q.toLowerCase();
    if (cap.title.toLowerCase().indexOf(lq) !== -1) return true;
    if (cap.description.toLowerCase().indexOf(lq) !== -1) return true;
    if (Array.isArray(cap.tags)) {
      for (var i = 0; i < cap.tags.length; i++) {
        if (cap.tags[i].toLowerCase().indexOf(lq) !== -1) return true;
      }
    }
    return false;
  }

  /* ═══════════════════════════════════════════════════════════════════
   * showPlaceholder(capabilityId)
   * ═══════════════════════════════════════════════════════════════════ */

  function showPlaceholder(capabilityId) {
    var cap = window.PO.CapabilityStore.getById(capabilityId);
    var title = cap ? cap.title : capabilityId;
    window.PO.showTransientStatus && window.PO.showTransientStatus(title + " — " + PLACEHOLDER_MSG);
  }

  /* ═══════════════════════════════════════════════════════════════════
   * renderApp(rootElement) — build the complete v2 app DOM
   * ═══════════════════════════════════════════════════════════════════ */

  function renderApp(rootEl) {
    _appRoot = rootEl;

    /* Clear root */
    rootEl.innerHTML = "";

    /* ── Root container ── */
    var root = document.createElement("div");
    root.className = "po-root";

    /* ── Main scrollable area ── */
    var main = document.createElement("main");
    main.className = "po-main";

    var scroll = document.createElement("div");
    scroll.className = "po-main-scroll";

    /* Search bar */
    var searchBar = document.createElement("div");
    searchBar.className = "po-search-bar";

    _searchInput = document.createElement("input");
    _searchInput.className = "po-search";
    _searchInput.type = "search";
    _searchInput.placeholder = "搜索功能…";
    _searchInput.setAttribute("aria-label", "搜索功能");
    _searchInput.setAttribute("data-action", "search-input");
    searchBar.appendChild(_searchInput);

    scroll.appendChild(searchBar);

    /* ── Favorites area ── */
    var favSection = document.createElement("section");
    favSection.className = "po-favorites";

    var favHeader = document.createElement("div");
    favHeader.className = "po-favorites__header";

    var favTitle = document.createElement("h2");
    favTitle.className = "po-favorites__title";
    favTitle.textContent = "★ 收藏 ";

    _favoritesCount = document.createElement("span");
    _favoritesCount.className = "po-favorites__count";
    _favoritesCount.textContent = "(0/" + window.PO.FavoritesStore.MAX_FAVORITES + ")";
    favTitle.appendChild(_favoritesCount);
    favHeader.appendChild(favTitle);

    _favoritesEmpty = document.createElement("p");
    _favoritesEmpty.className = "po-favorites__empty";
    _favoritesEmpty.textContent = "从下方功能卡点击 ☆ 收藏常用功能";

    _favoritesContainer = document.createElement("div");
    _favoritesContainer.className = "po-favorites__cards";

    favSection.appendChild(favHeader);
    favSection.appendChild(_favoritesEmpty);
    favSection.appendChild(_favoritesContainer);
    scroll.appendChild(favSection);

    /* ── Six sections ── */
    var sections = window.PO.CapabilityLabels.SECTION_ORDER;
    for (var si = 0; si < sections.length; si++) {
      var sec = sections[si];
      var sectionEl = document.createElement("section");
      sectionEl.className = "po-section";
      sectionEl.setAttribute("data-section", sec.id);

      var header = document.createElement("div");
      header.className = "po-section__header";

      var toggleBtn = document.createElement("button");
      toggleBtn.className = "po-section__toggle";
      toggleBtn.type = "button";
      toggleBtn.setAttribute("data-action", "toggle-section");
      toggleBtn.setAttribute("data-section-id", sec.id);
      toggleBtn.setAttribute("aria-expanded", "true");
      toggleBtn.setAttribute("aria-label", "折叠 " + sec.title);
      toggleBtn.textContent = "▾";
      _sectionHeaders[sec.id] = toggleBtn;
      header.appendChild(toggleBtn);

      var sectionTitle = document.createElement("h2");
      sectionTitle.className = "po-section__title";
      sectionTitle.textContent = sec.title;
      header.appendChild(sectionTitle);

      sectionEl.appendChild(header);

      var body = document.createElement("div");
      body.className = "po-section__body";
      _sectionContainers[sec.id] = body;
      sectionEl.appendChild(body);

      scroll.appendChild(sectionEl);
    }

    main.appendChild(scroll);
    root.appendChild(main);

    /* ── Bottom bar ── */
    var bottomBar = document.createElement("footer");
    bottomBar.className = "po-bottom-bar";

    var statusNode = document.createElement("div");
    statusNode.id = "status";
    statusNode.className = "po-status";
    statusNode.textContent = "就绪";

    var taskLink = document.createElement("span");
    taskLink.className = "po-task-link";
    taskLink.id = "task-link";
    taskLink.textContent = "任务：0 个运行中";

    var settingsBtn = document.createElement("button");
    settingsBtn.id = "settings-btn";
    settingsBtn.className = "po-bottom-button";
    settingsBtn.type = "button";
    settingsBtn.textContent = "设置";

    bottomBar.appendChild(statusNode);
    bottomBar.appendChild(taskLink);
    bottomBar.appendChild(settingsBtn);
    root.appendChild(bottomBar);

    /* ── Settings overlay + drawer (reused from v1 design) ── */
    var settingsOverlay = document.createElement("div");
    settingsOverlay.id = "settings-overlay";
    settingsOverlay.className = "po-settings-overlay";
    settingsOverlay.hidden = true;
    root.appendChild(settingsOverlay);

    var settingsDrawer = document.createElement("aside");
    settingsDrawer.id = "settings-drawer";
    settingsDrawer.className = "po-settings-drawer";
    settingsDrawer.hidden = true;

    var drawerBody = document.createElement("div");
    drawerBody.className = "po-settings-drawer__body";

    /* Theme toggle row */
    var themeRow = document.createElement("div");
    themeRow.className = "po-setting-row";

    var themeCopy = document.createElement("div");
    themeCopy.className = "po-setting-copy";
    var themeLabel = document.createElement("div");
    themeLabel.className = "po-setting-row__label";
    themeLabel.textContent = "亮暗模式";
    var themeHint = document.createElement("div");
    themeHint.className = "po-setting-row__hint";
    themeHint.textContent = "仅显示界面，逻辑暂未接入";
    themeCopy.appendChild(themeLabel);
    themeCopy.appendChild(themeHint);
    themeRow.appendChild(themeCopy);

    var themeToggle = document.createElement("button");
    themeToggle.id = "theme-toggle-btn";
    themeToggle.className = "po-toggle";
    themeToggle.type = "button";
    themeToggle.setAttribute("aria-pressed", "false");
    var themeThumb = document.createElement("span");
    themeThumb.className = "po-toggle__thumb";
    themeToggle.appendChild(themeThumb);
    themeRow.appendChild(themeToggle);
    drawerBody.appendChild(themeRow);

    /* Gateway URL */
    var gwGroup = document.createElement("div");
    gwGroup.className = "po-setting-group";
    var gwLabel = document.createElement("label");
    gwLabel.className = "po-setting-row__label";
    gwLabel.setAttribute("for", "gateway-url-input");
    gwLabel.textContent = "网关地址";
    var gwInput = document.createElement("input");
    gwInput.id = "gateway-url-input";
    gwInput.className = "po-settings-url-input";
    gwInput.type = "text";
    gwInput.placeholder = "http://127.0.0.1:8787";
    gwGroup.appendChild(gwLabel);
    gwGroup.appendChild(gwInput);
    drawerBody.appendChild(gwGroup);

    /* Log settings */
    var logGroup = document.createElement("div");
    logGroup.className = "po-setting-group";
    var logRow = document.createElement("div");
    logRow.className = "po-setting-row";
    var logLabel = document.createElement("span");
    logLabel.className = "po-setting-row__label";
    logLabel.textContent = "日志记录";
    logRow.appendChild(logLabel);
    var logToggle = document.createElement("button");
    logToggle.id = "log-toggle-btn";
    logToggle.className = "po-toggle";
    logToggle.type = "button";
    logToggle.setAttribute("aria-pressed", "true");
    var logThumb = document.createElement("span");
    logThumb.className = "po-toggle__thumb";
    logToggle.appendChild(logThumb);
    logRow.appendChild(logToggle);
    logGroup.appendChild(logRow);
    var logOpenBtn = document.createElement("button");
    logOpenBtn.id = "log-open-btn";
    logOpenBtn.className = "po-button po-button--secondary";
    logOpenBtn.type = "button";
    logOpenBtn.style.cssText = "margin-top:8px;width:100%;";
    logOpenBtn.textContent = "打开日志";
    logGroup.appendChild(logOpenBtn);
    drawerBody.appendChild(logGroup);

    /* Environment status area */
    var envGroup = document.createElement("div");
    envGroup.className = "po-setting-group";
    var envLabel = document.createElement("span");
    envLabel.className = "po-setting-row__label";
    envLabel.textContent = "环境状态";
    envGroup.appendChild(envLabel);
    var envStatus = document.createElement("div");
    envStatus.id = "env-status";
    envStatus.className = "po-env-status";
    envStatus.textContent = "检查中…";
    envGroup.appendChild(envStatus);
    drawerBody.appendChild(envGroup);

    /* Danger zone: clear data */
    var dangerGroup = document.createElement("div");
    dangerGroup.className = "po-setting-group";
    var dangerLabel = document.createElement("span");
    dangerLabel.className = "po-setting-row__label";
    dangerLabel.textContent = "数据管理";
    dangerGroup.appendChild(dangerLabel);
    var clearFavBtn = document.createElement("button");
    clearFavBtn.id = "clear-favorites-btn";
    clearFavBtn.className = "po-button po-button--secondary";
    clearFavBtn.type = "button";
    clearFavBtn.style.cssText = "margin-top:4px;width:100%;";
    clearFavBtn.textContent = "清除收藏";
    dangerGroup.appendChild(clearFavBtn);
    var clearCacheBtn = document.createElement("button");
    clearCacheBtn.id = "clear-cache-btn";
    clearCacheBtn.className = "po-button po-button--secondary";
    clearCacheBtn.type = "button";
    clearCacheBtn.style.cssText = "margin-top:4px;width:100%;";
    clearCacheBtn.textContent = "清除能力缓存";
    dangerGroup.appendChild(clearCacheBtn);
    drawerBody.appendChild(dangerGroup);

    settingsDrawer.appendChild(drawerBody);
    root.appendChild(settingsDrawer);

    rootEl.appendChild(root);

    /* ── Register legacy DOM element aliases for v1 compat ── */
    if (window.PO.elements === undefined) {
      window.PO.elements = {};
    }
    var els = window.PO.elements;
    els.mainEl = main;
    els.settingsButton = settingsBtn;
    els.settingsOverlay = settingsOverlay;
    els.settingsDrawer = settingsDrawer;
    els.themeToggleButton = themeToggle;
    els.gatewayUrlInput = gwInput;
    els.statusNode = statusNode;

    /* Update status node reference for v1 status functions */
    if (!els.previewEmpty) els.previewEmpty = document.createElement("div");
    if (!els.previewImage) els.previewImage = document.createElement("img");
  }

  /* ── Update task link in bottom bar ── */
  function updateTaskLink(activeCount) {
    var link = document.getElementById("task-link");
    if (link) {
      link.textContent = "任务：" + (activeCount || 0) + " 个运行中";
    }
  }

  /* ── Update environment status display ── */
  function updateEnvStatus(statusText) {
    var el = document.getElementById("env-status");
    if (el) el.textContent = statusText;
  }

  return {
    renderApp:             renderApp,
    renderFavorites:       renderFavorites,
    renderSection:         renderSection,
    renderAllSections:     renderAllSections,
    renderAll:             renderAll,
    renderCapabilityCard:  renderCapabilityCard,
    setSearch:             setSearch,
    toggleSection:         toggleSection,
    restoreCollapseState:  restoreCollapseState,
    showPlaceholder:       showPlaceholder,
    updateTaskLink:        updateTaskLink,
    updateEnvStatus:       updateEnvStatus,
  };
})();
