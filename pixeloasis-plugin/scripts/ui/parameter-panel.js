/* parameter-panel.js — v2 parameter configuration overlay
 *
 * Full-screen overlay for capability parameter configuration.
 * Receives capability + capture + preflight data; never captures itself.
 *
 * "开始生成" is the ONLY submit path.  In P1 it calls a mock function.
 *
 * Provides:
 *   open({capability, capture, preflight, draftValues})
 *   close()
 */

window.PO = window.PO || {};

window.PO.ParameterPanel = (function () {
  "use strict";

  var _overlay = null;
  var _currentCapability = null;
  var _currentCapture = null;
  var _currentPreflight = null;
  var _formResult = null;       /* { fragment, hasUnsupported } */
  var _subjectMode = "auto";
  var _adultConfirmed = false;

  /* ═══════════════════════════════════════════════════════════════════
   * open({ capability, capture, preflight, draftValues })
   * ═══════════════════════════════════════════════════════════════════ */

  function open(opts) {
    opts = opts || {};
    _currentCapability = opts.capability || null;
    _currentCapture = opts.capture || null;
    _currentPreflight = opts.preflight || null;
    _adultConfirmed = false;

    if (!_currentCapability) return;

    /* Update state */
    if (window.PO.state && window.PO.state.parameterPanel) {
      window.PO.state.parameterPanel.open = true;
      window.PO.state.parameterPanel.capabilityId = _currentCapability.id;
    }

    /* Load draft values */
    var draftValues = window.PO.ParameterForm.loadDraft(
      _currentCapability.id,
      window.PO.state && window.PO.state.capabilities ? window.PO.state.capabilities.revision : null
    );

    var initialValues = window.PO.ParameterForm.mergeDefaults(
      _currentCapability.parameterSchema,
      draftValues
    );

    /* Build overlay */
    _buildOverlay(_currentCapability, _currentCapture, _currentPreflight, initialValues);

    /* Show */
    _overlay.style.display = "";
    _overlay.removeAttribute("hidden");

    /* Focus trap */
    setTimeout(function () {
      var firstInput = _overlay.querySelector("input, select, textarea, button");
      if (firstInput) firstInput.focus();
    }, 100);

    window.PO.Logger && window.PO.Logger.info("parameter_panel.opened", {
      component: "parameter-panel",
      data: { capabilityId: _currentCapability.id },
    });
  }

  /* ═══════════════════════════════════════════════════════════════════
   * close()
   * ═══════════════════════════════════════════════════════════════════ */

  function close() {
    /* Save draft before closing */
    if (_currentCapability && _formResult && !_formResult.hasUnsupported) {
      try {
        var formEl = _overlay.querySelector(".po-param-overlay__form");
        if (formEl) {
          var result = window.PO.ParameterForm.getValues(formEl);
          window.PO.ParameterForm.saveDraft(
            _currentCapability.id,
            window.PO.state && window.PO.state.capabilities ? window.PO.state.capabilities.revision : null,
            result.values
          );
        }
      } catch (e) { /* ignore */ }
    }

    /* Release capture data */
    if (_currentCapture) {
      window.PO.CaptureUtils.releaseCapture(_currentCapture);
      _currentCapture = null;
    }

    _currentCapability = null;
    _currentPreflight = null;
    _formResult = null;
    _adultConfirmed = false;

    if (_overlay) {
      _overlay.style.display = "none";
      _overlay.setAttribute("hidden", "");
      if (_overlay.parentNode) _overlay.parentNode.removeChild(_overlay);
      _overlay = null;
    }

    /* Update state */
    if (window.PO.state && window.PO.state.parameterPanel) {
      window.PO.state.parameterPanel.open = false;
      window.PO.state.parameterPanel.capabilityId = null;
    }

    window.PO.Logger && window.PO.Logger.info("parameter_panel.closed", {
      component: "parameter-panel",
    });
  }

  /* ═══════════════════════════════════════════════════════════════════
   * _buildOverlay(capability, capture, preflight, initialValues)
   * ═══════════════════════════════════════════════════════════════════ */

  function _buildOverlay(capability, capture, preflight, initialValues) {
    /* Remove existing overlay */
    if (_overlay && _overlay.parentNode) {
      _overlay.parentNode.removeChild(_overlay);
    }

    _overlay = document.createElement("div");
    _overlay.className = "po-param-overlay";
    _overlay.setAttribute("role", "dialog");
    _overlay.setAttribute("aria-label", "参数配置 — " + capability.title);

    /* ── Header ── */
    var header = document.createElement("div");
    header.className = "po-param-overlay__header";

    var backBtn = document.createElement("button");
    backBtn.className = "po-param-overlay__back";
    backBtn.type = "button";
    backBtn.textContent = "← 返回";
    backBtn.setAttribute("aria-label", "返回功能列表");
    backBtn.addEventListener("click", function (e) { e.preventDefault(); close(); });
    header.appendChild(backBtn);

    var title = document.createElement("span");
    title.className = "po-param-overlay__title";
    title.textContent = capability.title;
    header.appendChild(title);

    /* Degraded badge */
    if (capability.availability && capability.availability.state === "degraded") {
      var degradedBadge = document.createElement("span");
      degradedBadge.className = "po-badge po-badge--degraded";
      degradedBadge.textContent = "兼容模式";
      header.appendChild(degradedBadge);
    }

    _overlay.appendChild(header);

    /* ── Scrollable body ── */
    var scroll = document.createElement("div");
    scroll.className = "po-param-overlay__scroll";

    /* ── Capture summary ── */
    if (capture) {
      var summary = document.createElement("div");
      summary.className = "po-param-summary";

      var summaryTitle = document.createElement("div");
      summaryTitle.className = "po-param-summary__title";
      summaryTitle.textContent = "输入范围";
      summary.appendChild(summaryTitle);

      /* Preview thumbnail */
      if (capture.preview) {
        var thumb = document.createElement("img");
        thumb.className = "po-param-thumb";
        thumb.src = window.PO.toDataUrl(capture.preview, "image/jpeg");
        thumb.alt = "捕获预览";
        summary.appendChild(thumb);
      }

      /* Scope info */
      var scopeInfo = document.createElement("div");
      scopeInfo.className = "po-param-summary__info";
      var scopeLabel = capture.scope === "document" ? "整图" :
                       capture.scope === "selection" ? "选区" :
                       capture.scope === "subject" ? "主体" : capture.scope;
      scopeInfo.textContent = scopeLabel;

      var bounds = capture.editBounds || capture.subjectBounds || capture.bounds;
      if (bounds) {
        scopeInfo.textContent += " — " + bounds.width + " × " + bounds.height + " px";
      }
      if (capture.sourceScale && capture.sourceScale < 1) {
        scopeInfo.textContent += "（已缩放至 " + Math.round(capture.sourceScale * 100) + "% 处理）";
      }
      if (capture.conversionApplied) {
        scopeInfo.textContent += " — 色彩已转换";
      }
      summary.appendChild(scopeInfo);

      scroll.appendChild(summary);
    }

    /* ── Preflight warnings ── */
    if (preflight && preflight.warnings && preflight.warnings.length > 0) {
      var warnSection = document.createElement("div");
      warnSection.className = "po-param-section";
      for (var wi = 0; wi < preflight.warnings.length; wi++) {
        var warn = document.createElement("div");
        warn.className = "po-param-warning";
        warn.textContent = "⚠ " + preflight.warnings[wi].message;
        warnSection.appendChild(warn);
      }
      scroll.appendChild(warnSection);
    }

    /* ── Subject source choice ── */
    if (preflight && preflight.requireSubjectChoice) {
      var subjectSection = document.createElement("div");
      subjectSection.className = "po-param-section";

      var subjectLabel = document.createElement("label");
      subjectLabel.className = "po-param-label";
      subjectLabel.textContent = "主体来源";
      subjectSection.appendChild(subjectLabel);

      var subjectChoice = document.createElement("div");
      subjectChoice.className = "po-param-subject-choice";

      var modes = [
        { value: "auto", label: "自动识别（推荐）" },
        { value: "selection", label: "使用当前选区" },
      ];

      for (var mi = 0; mi < modes.length; mi++) {
        var radioLabel = document.createElement("label");
        radioLabel.className = "po-param-radio-label";

        var radio = document.createElement("input");
        radio.type = "radio";
        radio.name = "subject-mode";
        radio.value = modes[mi].value;
        radio.setAttribute("data-param-key", "_subjectMode");
        if (modes[mi].value === _subjectMode) radio.checked = true;
        radio.addEventListener("change", function () {
          _subjectMode = this.value;
        });
        radioLabel.appendChild(radio);
        radioLabel.appendChild(document.createTextNode(" " + modes[mi].label));
        subjectChoice.appendChild(radioLabel);
      }

      subjectSection.appendChild(subjectChoice);
      scroll.appendChild(subjectSection);
    }

    /* ── Sensitive action notice ── */
    if (preflight && preflight.requireAdultConfirm) {
      var sensitiveSection = document.createElement("div");
      sensitiveSection.className = "po-param-sensitive-notice";

      var sensitiveTitle = document.createElement("div");
      sensitiveTitle.className = "po-param-sensitive-notice__title";
      sensitiveTitle.textContent = "⚠ 成人内容确认";
      sensitiveSection.appendChild(sensitiveTitle);

      var sensitiveText = document.createElement("p");
      sensitiveText.textContent = "此功能仅限成年主体使用。使用此功能即表示您确认：主体已满 18 岁，且您有权编辑此图像。操作将被记录用于安全审计。";
      sensitiveSection.appendChild(sensitiveText);

      var confirmLabel = document.createElement("label");
      confirmLabel.className = "po-param-radio-label";

      var confirmCheckbox = document.createElement("input");
      confirmCheckbox.type = "checkbox";
      confirmCheckbox.id = "adult-confirm";
      confirmCheckbox.setAttribute("data-param-key", "_adultConfirmed");
      confirmCheckbox.addEventListener("change", function () {
        _adultConfirmed = this.checked;
        _updateSubmitButton();
      });
      confirmLabel.appendChild(confirmCheckbox);
      confirmLabel.appendChild(document.createTextNode(" 我确认并同意上述条款"));
      sensitiveSection.appendChild(confirmLabel);

      scroll.appendChild(sensitiveSection);
    }

    /* ── Parameter form ── */
    var formSection = document.createElement("div");
    formSection.className = "po-param-overlay__form";

    _formResult = window.PO.ParameterForm.buildForm(
      capability.parameterSchema || {},
      initialValues
    );
    formSection.appendChild(_formResult.fragment);

    if (_formResult.hasUnsupported) {
      var unsupportedMsg = document.createElement("div");
      unsupportedMsg.className = "po-param-warning";
      unsupportedMsg.textContent = "⚠ 部分参数类型不受支持，提交已禁用。请升级插件版本。";
      formSection.appendChild(unsupportedMsg);
    }

    scroll.appendChild(formSection);

    _overlay.appendChild(scroll);

    /* ── Bottom actions ── */
    var actions = document.createElement("div");
    actions.className = "po-param-overlay__actions";

    var cancelBtn = document.createElement("button");
    cancelBtn.className = "po-button po-button--secondary";
    cancelBtn.type = "button";
    cancelBtn.textContent = "返回";
    cancelBtn.addEventListener("click", function (e) { e.preventDefault(); close(); });
    actions.appendChild(cancelBtn);

    var submitBtn = document.createElement("button");
    submitBtn.id = "param-submit-btn";
    submitBtn.className = "po-button po-button--primary";
    submitBtn.type = "button";
    submitBtn.textContent = "开始生成";
    submitBtn.addEventListener("click", function (e) { e.preventDefault(); _handleSubmit(); });
    actions.appendChild(submitBtn);

    _overlay.appendChild(actions);

    /* ── Keyboard handling ── */
    _overlay.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    });

    /* ── Append to app root ── */
    var appRoot = document.getElementById("app");
    if (appRoot) {
      appRoot.appendChild(_overlay);
    }

    /* Update submit button state */
    _updateSubmitButton();
  }

  /* ── Update submit button disabled state ── */
  function _updateSubmitButton() {
    var btn = document.getElementById("param-submit-btn");
    if (!btn) return;

    var disabled = false;

    /* Adult confirm required but not checked */
    if (_currentPreflight && _currentPreflight.requireAdultConfirm && !_adultConfirmed) {
      disabled = true;
    }

    /* Unsupported parameter types */
    if (_formResult && _formResult.hasUnsupported) {
      disabled = true;
    }

    btn.disabled = disabled;
    if (disabled) {
      btn.title = _adultConfirmed ? "部分参数不受支持" : "请先完成成人内容确认";
    } else {
      btn.title = "";
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
   * _handleSubmit — P1 mock (no real job submission)
   * ═══════════════════════════════════════════════════════════════════ */

  function _handleSubmit() {
    if (!_currentCapability) return;

    /* Validate form */
    var formEl = _overlay.querySelector(".po-param-overlay__form");
    if (!formEl) return;

    var result = window.PO.ParameterForm.getValues(formEl);

    /* Remove internal keys */
    delete result.values._subjectMode;
    delete result.values._adultConfirmed;

    /* Validate against schema */
    var validation = window.PO.ParameterForm.validateValues(
      _currentCapability.parameterSchema || {},
      result.values
    );

    /* Display errors */
    if (!validation.valid) {
      var errorKeys = Object.keys(validation.errors);
      for (var i = 0; i < errorKeys.length; i++) {
        var key = errorKeys[i];
        var errorEl = document.getElementById("param-error-" + key);
        if (errorEl) {
          errorEl.textContent = validation.errors[key];
        }
      }
      window.PO.showTransientStatus &&
        window.PO.showTransientStatus("请修正参数错误后再提交");
      return;
    }

    /* Save draft */
    window.PO.ParameterForm.saveDraft(
      _currentCapability.id,
      window.PO.state && window.PO.state.capabilities ? window.PO.state.capabilities.revision : null,
      result.values
    );

    /* ── P1 MOCK: show placeholder, no actual job submission ── */
    window.PO.Logger && window.PO.Logger.info("parameter_panel.submit_mock", {
      component: "parameter-panel",
      data: {
        capabilityId: _currentCapability.id,
        subjectMode: _subjectMode,
        adultConfirmed: _adultConfirmed,
      },
    });

    var submitBtn = document.getElementById("param-submit-btn");
    if (submitBtn) {
      submitBtn.textContent = "任务提交将在下一阶段接入";
      submitBtn.disabled = true;
      setTimeout(function () {
        submitBtn.textContent = "开始生成";
        _updateSubmitButton();
      }, 2000);
    }

    window.PO.showTransientStatus &&
      window.PO.showTransientStatus("任务提交将在下一阶段接入（P1 Mock）");

    /* Don't close — user can continue adjusting or manually return */
  }

  /* ── Get subject mode ── */
  function getSubjectMode() {
    return _subjectMode;
  }

  return {
    open:           open,
    close:          close,
    getSubjectMode: getSubjectMode,
  };
})();
