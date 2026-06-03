(function () {
  const TEXT = {
    selection: "Selection",
    selectRectTool: "\u9009\u62e9\u77e9\u5f62\u9009\u6846\u5de5\u5177",
    captureSelection: "\u6293\u53d6\u5f53\u524d\u9009\u533a",
    settings: "\u8bbe\u7f6e",
    themeMode: "\u4eae\u6697\u6a21\u5f0f",
    themeHint: "\u4ec5\u663e\u793a\u754c\u9762\uff0c\u903b\u8f91\u6682\u672a\u63a5\u5165",
    ready: "ready",
    noDocument: "No active document.",
    noSelection: "No active selection.",
    shellReady: "uxp shell ready",
    settingsOpened: "settings opened",
    settingsClosed: "settings closed",
    themeClicked: "theme toggle clicked",
  };

  function buildTemplate() {
    return `
      <div class="po-root">
        <main class="po-main">
          <section class="po-card">
            <div class="po-card__eyebrow">${TEXT.selection}</div>
            <button id="tool-btn" class="po-button" type="button">
              ${TEXT.selectRectTool}
            </button>
            <button id="capture-btn" class="po-button po-button--secondary" type="button">
              ${TEXT.captureSelection}
            </button>
          </section>
        </main>

        <aside id="settings-sheet" class="po-sheet" aria-hidden="true">
          <div class="po-sheet__header">${TEXT.settings}</div>
          <div class="po-sheet__body">
            <div class="po-setting-row">
              <div class="po-setting-copy">
                <div class="po-setting-row__label">${TEXT.themeMode}</div>
                <div class="po-setting-row__hint">${TEXT.themeHint}</div>
              </div>
              <button id="theme-toggle-btn" class="po-toggle" type="button" aria-pressed="false">
                <span class="po-toggle__thumb"></span>
              </button>
            </div>
          </div>
        </aside>

        <footer class="po-bottom-bar">
          <div id="status" class="po-status">${TEXT.ready}</div>
          <button id="settings-btn" class="po-bottom-button" type="button">${TEXT.settings}</button>
        </footer>
      </div>
    `;
  }

  function normalizeNumber(value) {
    if (typeof value === "number" && isFinite(value)) {
      return value;
    }

    if (value && typeof value === "object") {
      if (typeof value._value === "number") {
        return value._value;
      }

      if (typeof value.value === "number") {
        return value.value;
      }
    }

    return null;
  }

  function normalizeSelectionBounds(candidate) {
    if (!candidate || typeof candidate !== "object") {
      return null;
    }

    const left = normalizeNumber(candidate.left);
    const top = normalizeNumber(candidate.top);
    const right = normalizeNumber(candidate.right);
    const bottom = normalizeNumber(candidate.bottom);

    if (left === null || top === null || right === null || bottom === null) {
      return null;
    }

    return {
      left: left,
      top: top,
      width: right - left,
      height: bottom - top,
    };
  }

  function formatSelectionBounds(bounds) {
    return (
      "selection: " +
      bounds.left +
      "," +
      bounds.top +
      " " +
      bounds.width +
      "x" +
      bounds.height
    );
  }

  async function getSelectionBounds() {
    const photoshop = window.require("photoshop");
    const { app, action } = photoshop;
    const documentRef = app.activeDocument;

    if (!documentRef) {
      throw new Error(TEXT.noDocument);
    }

    const [result] = await action.batchPlay(
      [
        {
          _obj: "get",
          _target: [
            { _property: "selection" },
            { _ref: "document", _id: documentRef.id },
            { _ref: "application" },
          ],
          _options: {
            dialogOptions: "dontDisplay",
          },
        },
      ],
      {},
    );

    const selection =
      normalizeSelectionBounds(result.selection) ||
      normalizeSelectionBounds(result.selection && result.selection.bounds) ||
      normalizeSelectionBounds(result.bounds);

    if (!selection || selection.width <= 0 || selection.height <= 0) {
      throw new Error(TEXT.noSelection);
    }

    return selection;
  }

  try {
    const appRoot = document.getElementById("app");

    if (!appRoot) {
      throw new Error("PixelOasis root element not found.");
    }

    appRoot.innerHTML = buildTemplate();

    const toolButton = document.getElementById("tool-btn");
    const captureButton = document.getElementById("capture-btn");
    const settingsButton = document.getElementById("settings-btn");
    const settingsSheet = document.getElementById("settings-sheet");
    const themeToggleButton = document.getElementById("theme-toggle-btn");
    const statusNode = document.getElementById("status");

    if (
      !toolButton ||
      !captureButton ||
      !settingsButton ||
      !settingsSheet ||
      !themeToggleButton ||
      !statusNode
    ) {
      throw new Error("PixelOasis UI element not found.");
    }

    const selectRectangularMarqueeToolCommand = [
      {
        _obj: "select",
        _target: [{ _ref: "marqueeRectTool" }],
      },
    ];

    let transientStatusTimer = null;

    function setStatus(message) {
      statusNode.textContent = message;
    }

    function clearTransientTimer() {
      if (transientStatusTimer) {
        clearTimeout(transientStatusTimer);
        transientStatusTimer = null;
      }
    }

    async function refreshSelectionStatus() {
      clearTransientTimer();

      try {
        const bounds = await getSelectionBounds();
        setStatus(formatSelectionBounds(bounds));
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      }
    }

    function showTransientStatus(message) {
      clearTransientTimer();
      setStatus(message);
      transientStatusTimer = setTimeout(function () {
        void refreshSelectionStatus();
      }, 1200);
    }

    function toggleSettings() {
      const isOpen = settingsSheet.classList.contains("is-open");
      settingsSheet.classList.toggle("is-open", !isOpen);
      settingsSheet.setAttribute("aria-hidden", isOpen ? "true" : "false");
      showTransientStatus(isOpen ? TEXT.settingsClosed : TEXT.settingsOpened);
    }

    settingsButton.addEventListener("click", toggleSettings);

    themeToggleButton.addEventListener("click", function () {
      const current = themeToggleButton.getAttribute("aria-pressed") === "true";
      themeToggleButton.setAttribute("aria-pressed", current ? "false" : "true");
      showTransientStatus(TEXT.themeClicked);
    });

    toolButton.addEventListener("click", async function () {
      try {
        const photoshop = window.require("photoshop");
        const { app, action, core } = photoshop;
        const before =
          app.currentTool && app.currentTool.id ? app.currentTool.id : "unknown";

        await core.executeAsModal(
          async function () {
            await action.batchPlay(selectRectangularMarqueeToolCommand, {
              synchronousExecution: false,
              modalBehavior: "execute",
            });
          },
          { commandName: "PixelOasis Select Rectangular Marquee Tool" },
        );

        const after =
          app.currentTool && app.currentTool.id ? app.currentTool.id : "unknown";
        showTransientStatus("tool: " + before + " -> " + after);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      }
    });

    captureButton.addEventListener("click", async function () {
      try {
        const bounds = await getSelectionBounds();
        showTransientStatus(formatSelectionBounds(bounds));
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      }
    });

    try {
      const photoshop = window.require("photoshop");
      if (photoshop && photoshop.app) {
        void refreshSelectionStatus();
      } else {
        setStatus(TEXT.shellReady);
      }
    } catch (innerError) {
      setStatus(innerError instanceof Error ? innerError.message : String(innerError));
    }
  } catch (error) {
    document.body.innerHTML = `<pre class="po-fatal">${
      error instanceof Error ? error.stack || error.message : String(error)
    }</pre>`;
  }
})();
