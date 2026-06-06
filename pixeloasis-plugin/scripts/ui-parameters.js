window.PO = window.PO || {};

/* ── Per-workflow parameter persistence ── */
window.PO.workflowParams = {};

/* ── Currently open workflow id (null when page is closed) ── */
window.PO.activeWorkflowId = null;

/* ── Build parameter page HTML (called once, cached in DOM) ── */

window.PO.buildParameterPage = function () {
  return [
    '<div id="param-page" class="po-param-page" hidden>',

    /* Header */
    '<div class="po-param-page__header">',
    '<button id="param-back-btn" class="po-param-back-btn" type="button">← 返回</button>',
    '<span id="param-title" class="po-param-title"></span>',
    "</div>",

    /* Scrollable body */
    '<div class="po-param-page__scroll">',

    /* Prompt */
    '<div class="po-param-group">',
    '<label class="po-param-label" for="param-prompt">提示词</label>',
    '<textarea id="param-prompt" class="po-param-textarea" rows="3" placeholder="描述你希望生成的内容…"></textarea>',
    "</div>",

    /* Negative prompt */
    '<div class="po-param-group">',
    '<label class="po-param-label" for="param-neg-prompt">负面提示词</label>',
    '<textarea id="param-neg-prompt" class="po-param-textarea" rows="2" placeholder="描述你希望避免的内容…"></textarea>',
    "</div>",

    /* Seed + random toggle */
    '<div class="po-param-row">',
    '<div class="po-param-col">',
    '<label class="po-param-label" for="param-seed">Seed</label>',
    '<input id="param-seed" class="po-param-input" type="number" value="-1" />',
    "</div>",
    '<div class="po-param-col po-param-col--shrink">',
    '<button id="param-random-seed" class="po-param-toggle-btn" type="button">随机</button>',
    "</div>",
    "</div>",

    /* Steps */
    '<div class="po-param-group">',
    '<div class="po-param-range-header">',
    '<label class="po-param-label" for="param-steps">Steps</label>',
    '<span id="param-steps-val" class="po-param-range-val">28</span>',
    "</div>",
    '<input id="param-steps" class="po-param-range" type="range" min="1" max="100" value="28" />',
    "</div>",

    /* CFG */
    '<div class="po-param-group">',
    '<div class="po-param-range-header">',
    '<label class="po-param-label" for="param-cfg">CFG</label>',
    '<span id="param-cfg-val" class="po-param-range-val">7</span>',
    "</div>",
    '<input id="param-cfg" class="po-param-range" type="range" min="1" max="30" step="0.5" value="7" />',
    "</div>",

    /* Denoise */
    '<div class="po-param-group">',
    '<div class="po-param-range-header">',
    '<label class="po-param-label" for="param-denoise">Denoise</label>',
    '<span id="param-denoise-val" class="po-param-range-val">0.75</span>',
    "</div>",
    '<input id="param-denoise" class="po-param-range" type="range" min="0" max="1" step="0.01" value="0.75" />',
    "</div>",

    /* Sampler */
    '<div class="po-param-group">',
    '<label class="po-param-label" for="param-sampler">Sampler</label>',
    '<select id="param-sampler" class="po-param-select"></select>',
    "</div>",

    /* Scheduler */
    '<div class="po-param-group">',
    '<label class="po-param-label" for="param-scheduler">Scheduler</label>',
    '<select id="param-scheduler" class="po-param-select"></select>',
    "</div>",

    "</div>", /* end scroll */

    /* Action buttons (pinned at bottom of param page) */
    '<div class="po-param-actions">',
    '<button id="param-run-btn" class="po-button po-button--primary" type="button">生成</button>',
    '<button id="param-back-btn-bottom" class="po-button" type="button">返回</button>',
    "</div>",

    "</div>",
  ].join("");
};

/* ── Populate sampler / scheduler <select> options ── */

window.PO.populateSelectOptions = function (selectEl, options, selectedValue) {
  selectEl.innerHTML = "";
  for (var i = 0; i < options.length; i++) {
    var opt = document.createElement("option");
    opt.value = options[i];
    opt.textContent = options[i];
    if (options[i] === selectedValue) {
      opt.selected = true;
    }
    selectEl.appendChild(opt);
  }
};

/* ── Open parameter page for a workflow ── */

window.PO.openParameterPage = function (workflowId) {
  /* Check both WORKFLOWS and ENTRY_WORKFLOWS registries */
  var workflow = window.PO.WORKFLOWS[workflowId] || (window.PO.ENTRY_WORKFLOWS || {})[workflowId];
  if (!workflow) return;

  window.PO.activeWorkflowId = workflowId;

  /* Load persisted params or defaults */
  var saved = window.PO.workflowParams[workflowId];
  var params = saved || Object.assign({}, workflow.defaults);

  /* Populate UI */
  var els = window.PO.paramElements;
  els.title.textContent = workflow.title;
  els.prompt.value = params.prompt || "";
  els.negPrompt.value = params.negativePrompt || "";
  els.seed.value = params.seed;
  els.steps.value = params.steps;
  els.stepsVal.textContent = params.steps;
  els.cfg.value = params.cfg;
  els.cfgVal.textContent = params.cfg;
  els.denoise.value = params.denoise;
  els.denoiseVal.textContent = params.denoise;

  window.PO.populateSelectOptions(els.sampler, window.PO.SAMPLER_OPTIONS, params.sampler);
  window.PO.populateSelectOptions(els.scheduler, window.PO.SCHEDULER_OPTIONS, params.scheduler);

  /* Show */
  els.page.hidden = false;
};

/* ── Close parameter page (save current values first) ── */

window.PO.closeParameterPage = function () {
  window.PO.saveParameterPage();
  window.PO.activeWorkflowId = null;
  if (window.PO.paramElements) {
    window.PO.paramElements.page.hidden = true;
  }
};

/* ── Read current UI values and persist to workflowParams ── */

window.PO.saveParameterPage = function () {
  var workflowId = window.PO.activeWorkflowId;
  if (!workflowId) return;

  var els = window.PO.paramElements;
  window.PO.workflowParams[workflowId] = {
    prompt: els.prompt.value,
    negativePrompt: els.negPrompt.value,
    seed: parseInt(els.seed.value, 10) || -1,
    steps: parseInt(els.steps.value, 10) || 28,
    cfg: parseFloat(els.cfg.value) || 7,
    denoise: parseFloat(els.denoise.value) || 0.75,
    sampler: els.sampler.value,
    scheduler: els.scheduler.value,
  };
};

/* ── Build request payload from current params + capture state ── */

window.PO.assembleGenerateRequest = function () {
  var workflowId = window.PO.activeWorkflowId;
  if (!workflowId) return null;

  var params = window.PO.workflowParams[workflowId];
  if (!params) {
    var workflow = window.PO.WORKFLOWS[workflowId];
    params = workflow ? workflow.defaults : {};
  }

  var capture = window.PO.state.capture;
  var req = {
    correlationId: "po-" + Date.now().toString(36),
    workflowId: workflowId,
    selection: capture ? {
      documentId: capture.documentId || "",
      bounds: capture.bounds || {},
      imagePngBase64: capture.imagePngBase64 || "",
      maskPngBase64: capture.maskPngBase64 || "",
      previewJpegBase64: capture.previewJpegBase64 || "",
      colorMode: capture.colorMode || "RGB",
      resolution: capture.resolution || 72,
    } : null,
    parameters: {
      prompt: params.prompt || "",
      negativePrompt: params.negativePrompt || "",
      seed: params.seed,
      steps: params.steps,
      cfg: params.cfg,
      denoise: params.denoise,
      sampler: params.sampler,
      scheduler: params.scheduler,
    },
  };

  return req;
};

/* ── Event binding for parameter controls ── */

window.PO.initParameterPage = function () {
  var els = window.PO.paramElements;
  if (!els || !els.page) return;

  /* Back buttons */
  function doClose() { window.PO.closeParameterPage(); }
  els.backBtn.addEventListener("click", doClose);
  els.backBtnBottom.addEventListener("click", doClose);

  /* Random seed */
  els.randomSeedBtn.addEventListener("click", function () {
    var randomSeed = Math.floor(Math.random() * 2147483647);
    els.seed.value = randomSeed;
  });

  /* Range sliders → value display */
  els.steps.addEventListener("input", function () {
    els.stepsVal.textContent = els.steps.value;
  });

  els.cfg.addEventListener("input", function () {
    els.cfgVal.textContent = parseFloat(els.cfg.value).toFixed(1);
  });

  els.denoise.addEventListener("input", function () {
    els.denoiseVal.textContent = parseFloat(els.denoise.value).toFixed(2);
  });

  /* Run button — P3: send to gateway */
  els.runBtn.addEventListener("click", async function () {
    window.PO.saveParameterPage();
    var req = window.PO.assembleGenerateRequest();
    if (!req || !req.selection) {
      window.PO.showTransientStatus("请先抓取选区再生成");
      return;
    }

    /* Progress: check gateway */
    window.PO.setStatus("checking gateway...");
    var healthy = await window.PO.GatewayClient.health();
    if (!healthy) {
      window.PO.showTransientStatus("网关不可达 — 请确认 " + (window.PO.state.gatewayUrl || "http://127.0.0.1:8787") + " 已启动");
      return;
    }

    /* Progress: sending */
    window.PO.setStatus("sending request...");
    els.runBtn.disabled = true;
    els.runBtn.textContent = "生成中...";

    try {
      var result = await window.PO.GatewayClient.generate(req);

      /* Accept both protocol name (imagePngBase64) and legacy mock name (imageBase64) */
      var returnedImage = (result && result.result && (result.result.imagePngBase64 || result.result.imageBase64)) || null;

      if (result && result.status === "succeeded" && returnedImage) {
        window.PO.state.lastResult = result;

        /* P4 — Place returned image as a new layer in Photoshop */
        window.PO.setStatus("placing layer...");
        var capture = window.PO.state.capture;
        var placeBounds = capture
          ? { left: capture.bounds.left, top: capture.bounds.top, width: capture.bounds.width, height: capture.bounds.height }
          : null;
        var workflowTitle = (window.PO.WORKFLOWS[req.workflowId] || {}).title || req.workflowId;

        try {
          var placeInfo = await window.PO.placeGeneratedLayer(
            returnedImage,
            capture ? capture.maskPngBase64 : null,
            placeBounds,
            workflowTitle,
          );
          window.PO.showTransientStatus("生成完成 — " + placeInfo.layerName);
        } catch (placeErr) {
          window.PO.showTransientStatus("生成完成但置入失败: " + (placeErr.message || placeErr));
        }
      } else {
        var errMsg = (result && result.error && result.error.message)
          ? result.error.message
          : "生成失败";
        window.PO.showTransientStatus(errMsg);
      }
    } catch (error) {
      window.PO.showTransientStatus(error instanceof Error ? error.message : String(error));
    } finally {
      els.runBtn.disabled = false;
      els.runBtn.textContent = "生成";
    }
  });
};
