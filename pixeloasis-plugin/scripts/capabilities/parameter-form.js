/* parameter-form.js — v2 restricted JSON Schema → DOM form controls
 *
 * Only supports the subset of JSON Schema that the gateway is allowed to
 * declare.  Unknown control types produce a disabled control with an
 * upgrade message; the form submission is disabled in that case.
 *
 * Provides:
 *   buildForm(schema, initialValues)  → DocumentFragment
 *   getValues(formEl)                 → { values, errors }
 *   mergeDefaults(schema, storedDraft) → merged values object
 *   validateValues(schema, values)    → { valid, errors }
 */

window.PO = window.PO || {};

window.PO.ParameterForm = (function () {
  "use strict";

  var DRAFT_KEY = "po.parameterDrafts.v2";

  /* ═══════════════════════════════════════════════════════════════════
   * buildForm(schema, initialValues) → DocumentFragment
   * ═══════════════════════════════════════════════════════════════════ */

  function buildForm(schema, initialValues) {
    var frag = document.createDocumentFragment();
    var hasUnsupported = false;

    if (!schema || !schema.properties) {
      var emptyMsg = document.createElement("p");
      emptyMsg.className = "po-param-form-empty";
      emptyMsg.textContent = "此能力暂无可用参数";
      frag.appendChild(emptyMsg);
      return { fragment: frag, hasUnsupported: false };
    }

    var props = schema.properties;
    var propKeys = Object.keys(props);

    for (var i = 0; i < propKeys.length; i++) {
      var key = propKeys[i];
      var prop = props[key];
      var value = (initialValues && initialValues[key] !== undefined) ? initialValues[key] : prop.default;

      var group = document.createElement("div");
      group.className = "po-param-form-group";

      /* Label */
      var label = document.createElement("label");
      label.className = "po-param-label";
      label.textContent = prop.title || key;
      label.setAttribute("for", "param-" + key);
      group.appendChild(label);

      /* Description */
      if (prop.description) {
        var desc = document.createElement("span");
        desc.className = "po-param-form-hint";
        desc.textContent = prop.description;
        group.appendChild(desc);
      }

      /* Control */
      var controlResult = _buildControl(key, prop, value);
      group.appendChild(controlResult.element);

      if (controlResult.unsupported) {
        hasUnsupported = true;
      }

      /* Error container */
      var errorEl = document.createElement("span");
      errorEl.className = "po-param-form-error";
      errorEl.id = "param-error-" + key;
      errorEl.setAttribute("role", "alert");
      group.appendChild(errorEl);

      frag.appendChild(group);
    }

    return { fragment: frag, hasUnsupported: hasUnsupported };
  }

  /* ── Build a single control based on schema type ── */
  function _buildControl(key, prop, value) {
    var el;
    var unsupported = false;

    /* Enum → select */
    if (prop.enum && Array.isArray(prop.enum)) {
      el = document.createElement("select");
      el.id = "param-" + key;
      el.className = "po-param-select";
      el.setAttribute("data-param-key", key);
      el.setAttribute("data-param-type", "enum");

      for (var ei = 0; ei < prop.enum.length; ei++) {
        var opt = document.createElement("option");
        opt.value = prop.enum[ei];
        opt.textContent = prop.enumLabels ? (prop.enumLabels[ei] || prop.enum[ei]) : prop.enum[ei];
        if (String(prop.enum[ei]) === String(value)) opt.selected = true;
        el.appendChild(opt);
      }
      return { element: el, unsupported: false };
    }

    /* Boolean → toggle/checkbox */
    if (prop.type === "boolean") {
      el = document.createElement("input");
      el.type = "checkbox";
      el.id = "param-" + key;
      el.className = "po-param-checkbox";
      el.setAttribute("data-param-key", key);
      el.setAttribute("data-param-type", "boolean");
      if (value === true) el.checked = true;
      return { element: el, unsupported: false };
    }

    /* Number / Integer → range or number input */
    if (prop.type === "number" || prop.type === "integer") {
      var hasRange = (typeof prop.minimum === "number" && typeof prop.maximum === "number");

      if (hasRange) {
        var container = document.createElement("div");
        container.className = "po-param-range-container";

        el = document.createElement("input");
        el.type = "range";
        el.id = "param-" + key;
        el.className = "po-param-range";
        el.setAttribute("data-param-key", key);
        el.setAttribute("data-param-type", prop.type);
        el.min = String(prop.minimum);
        el.max = String(prop.maximum);
        el.step = prop.type === "integer" ? "1" : String(prop.multipleOf || 0.01);
        el.value = String(value !== undefined ? value : (prop.default !== undefined ? prop.default : prop.minimum));

        var valDisplay = document.createElement("span");
        valDisplay.className = "po-param-range-val";
        valDisplay.id = "param-" + key + "-val";
        valDisplay.textContent = el.value;

        el.addEventListener("input", function () {
          valDisplay.textContent = el.value;
        });

        container.appendChild(el);
        container.appendChild(valDisplay);
        return { element: container, unsupported: false };
      }

      /* Plain number input */
      el = document.createElement("input");
      el.type = "number";
      el.id = "param-" + key;
      el.className = "po-param-input";
      el.setAttribute("data-param-key", key);
      el.setAttribute("data-param-type", prop.type);
      if (typeof prop.minimum === "number") el.min = String(prop.minimum);
      if (typeof prop.maximum === "number") el.max = String(prop.maximum);
      if (prop.type === "integer") el.step = "1";
      if (value !== undefined) el.value = String(value);
      if (prop.placeholder) el.placeholder = prop.placeholder;
      return { element: el, unsupported: false };
    }

    /* String → text input or textarea */
    if (prop.type === "string") {
      if (prop.format === "textarea" || (prop.maxLength && prop.maxLength > 200)) {
        el = document.createElement("textarea");
        el.id = "param-" + key;
        el.className = "po-param-textarea";
        el.setAttribute("data-param-key", key);
        el.setAttribute("data-param-type", "string");
        if (prop.maxLength) el.maxLength = prop.maxLength;
        if (value !== undefined) el.value = String(value);
        return { element: el, unsupported: false };
      }

      el = document.createElement("input");
      el.type = "text";
      el.id = "param-" + key;
      el.className = "po-param-input";
      el.setAttribute("data-param-key", key);
      el.setAttribute("data-param-type", prop.type);
      if (prop.maxLength) el.maxLength = prop.maxLength;
      if (value !== undefined) el.value = String(value);
      if (prop.placeholder) el.placeholder = prop.placeholder;
      return { element: el, unsupported: false };
    }

    /* Color → text input with hex validation */
    if (prop.type === "color" || prop.format === "color" || prop.format === "hex") {
      el = document.createElement("input");
      el.type = "text";
      el.id = "param-" + key;
      el.className = "po-param-input";
      el.setAttribute("data-param-key", key);
      el.setAttribute("data-param-type", "color");
      el.maxLength = 9; /* #RRGGBB or #RRGGBBAA */
      el.placeholder = "#RRGGBB";
      if (value !== undefined) el.value = String(value);
      return { element: el, unsupported: false };
    }

    /* Object (one level of nested properties) */
    if (prop.type === "object" && prop.properties) {
      var objContainer = document.createElement("fieldset");
      objContainer.className = "po-param-object";
      var legend = document.createElement("legend");
      legend.textContent = prop.title || key;
      objContainer.appendChild(legend);

      var nested = buildForm(prop, value || {});
      objContainer.appendChild(nested.fragment);

      /* Mark all nested controls with parent key */
      var nestedControls = objContainer.querySelectorAll("[data-param-key]");
      for (var ni = 0; ni < nestedControls.length; ni++) {
        var nc = nestedControls[ni];
        nc.setAttribute("data-param-key", key + "." + nc.getAttribute("data-param-key"));
      }

      return { element: objContainer, unsupported: nested.hasUnsupported };
    }

    /* Unsupported type */
    el = document.createElement("div");
    el.className = "po-param-unsupported";
    var unsupportedMsg = document.createElement("span");
    unsupportedMsg.className = "po-param-form-error";
    unsupportedMsg.textContent = "此版本插件不支持该参数类型（" + (prop.type || "unknown") + "）";
    el.appendChild(unsupportedMsg);
    unsupported = true;

    return { element: el, unsupported: unsupported };
  }

  /* ═══════════════════════════════════════════════════════════════════
   * getValues(formEl) → { values, errors }
   * ═══════════════════════════════════════════════════════════════════ */

  function getValues(formEl) {
    var values = {};
    var errors = {};

    if (!formEl) return { values: values, errors: errors };

    var controls = formEl.querySelectorAll("[data-param-key]");
    for (var i = 0; i < controls.length; i++) {
      var ctrl = controls[i];
      var key = ctrl.getAttribute("data-param-key");
      var type = ctrl.getAttribute("data-param-type");

      if (!key) continue;

      /* Handle nested keys (object properties) */
      if (key.indexOf(".") !== -1) {
        var parts = key.split(".");
        if (!values[parts[0]]) values[parts[0]] = {};
        values[parts[0]][parts[1]] = _readControlValue(ctrl, type);
      } else {
        values[key] = _readControlValue(ctrl, type);
      }

      /* Clear previous error */
      var errorEl = document.getElementById("param-error-" + key.split(".")[0]);
      if (errorEl) errorEl.textContent = "";
    }

    return { values: values, errors: errors };
  }

  function _readControlValue(ctrl, type) {
    if (!ctrl) return undefined;

    if (ctrl.tagName === "SELECT") {
      return ctrl.value;
    }

    if (ctrl.type === "checkbox") {
      return ctrl.checked;
    }

    if (ctrl.type === "range" || ctrl.type === "number") {
      var num = parseFloat(ctrl.value);
      if (type === "integer") return Math.round(num);
      return isNaN(num) ? undefined : num;
    }

    if (ctrl.tagName === "TEXTAREA") {
      return ctrl.value;
    }

    /* text, color, etc. */
    if (ctrl.value !== undefined) {
      return ctrl.value;
    }

    return undefined;
  }

  /* ═══════════════════════════════════════════════════════════════════
   * validateValues(schema, values) → { valid, errors }
   * ═══════════════════════════════════════════════════════════════════ */

  function validateValues(schema, values) {
    var errors = {};

    if (!schema || !schema.properties) return { valid: true, errors: errors };

    var props = schema.properties;
    var keys = Object.keys(props);

    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var prop = props[key];
      var val = values[key];

      /* Required check */
      if (prop.required === true && (val === undefined || val === null || val === "")) {
        errors[key] = (prop.title || key) + " 为必填项";
        continue;
      }

      if (val === undefined || val === null) continue;

      /* Type-specific validation */
      if (prop.type === "number" || prop.type === "integer") {
        if (typeof val !== "number" || isNaN(val)) {
          errors[key] = (prop.title || key) + " 必须为数字";
          continue;
        }
        if (prop.type === "integer" && !Number.isInteger(val)) {
          errors[key] = (prop.title || key) + " 必须为整数";
          continue;
        }
        if (typeof prop.minimum === "number" && val < prop.minimum) {
          errors[key] = "最小值为 " + prop.minimum;
          continue;
        }
        if (typeof prop.maximum === "number" && val > prop.maximum) {
          errors[key] = "最大值为 " + prop.maximum;
          continue;
        }
      }

      if (prop.type === "string" && prop.maxLength && typeof val === "string") {
        if (val.length > prop.maxLength) {
          errors[key] = "最多 " + prop.maxLength + " 个字符";
        }
      }

      if ((prop.type === "color" || prop.format === "color" || prop.format === "hex") && typeof val === "string") {
        if (val.length > 0 && !/^#[0-9A-Fa-f]{3,8}$/.test(val)) {
          errors[key] = "请使用有效的十六进制颜色值（如 #FF0000）";
        }
      }

      if (prop.enum && Array.isArray(prop.enum)) {
        if (prop.enum.indexOf(val) === -1) {
          errors[key] = "无效的选项值";
        }
      }
    }

    return { valid: Object.keys(errors).length === 0, errors: errors };
  }

  /* ═══════════════════════════════════════════════════════════════════
   * mergeDefaults(schema, storedDraft) → merged values
   * ═══════════════════════════════════════════════════════════════════ */

  function mergeDefaults(schema, storedDraft) {
    var merged = {};

    /* Start with schema defaults */
    if (schema && schema.properties) {
      var props = schema.properties;
      var keys = Object.keys(props);
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        var prop = props[key];

        if (prop.default !== undefined) {
          merged[key] = prop.default;
        } else if (prop.type === "number" || prop.type === "integer") {
          merged[key] = typeof prop.minimum === "number" ? prop.minimum : 0;
        } else if (prop.type === "boolean") {
          merged[key] = false;
        } else {
          merged[key] = "";
        }
      }
    }

    /* Overlay stored draft values (only for fields still in schema) */
    if (storedDraft && typeof storedDraft === "object") {
      var schemaKeys = schema && schema.properties ? Object.keys(schema.properties) : [];
      for (var j = 0; j < schemaKeys.length; j++) {
        var k = schemaKeys[j];
        if (storedDraft[k] !== undefined) {
          merged[k] = storedDraft[k];
        }
      }
      /* Fields in draft but NOT in current schema are silently discarded */
    }

    return merged;
  }

  /* ═══════════════════════════════════════════════════════════════════
   * Draft persistence
   * ═══════════════════════════════════════════════════════════════════ */

  function saveDraft(capabilityId, schemaRevision, values) {
    try {
      var raw = localStorage.getItem(DRAFT_KEY);
      var drafts = raw ? JSON.parse(raw) : {};
      if (!drafts || typeof drafts !== "object") drafts = {};

      drafts[capabilityId] = {
        schemaRevision: schemaRevision || null,
        values: values || {},
        savedAt: Date.now(),
      };

      localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts));
    } catch (e) {
      window.PO.Logger && window.PO.Logger.warn("parameter.draft_save_failed", {
        component: "parameter-form",
        error: e,
      });
    }
  }

  function loadDraft(capabilityId, currentSchemaRevision) {
    try {
      var raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return null;

      var drafts = JSON.parse(raw);
      if (!drafts || typeof drafts !== "object") return null;

      var draft = drafts[capabilityId];
      if (!draft || !draft.values) return null;

      /* Discard if schema revision changed */
      if (currentSchemaRevision && draft.schemaRevision !== currentSchemaRevision) {
        window.PO.Logger && window.PO.Logger.info("parameter.draft_schema_mismatch", {
          component: "parameter-form",
          data: {
            capabilityId: capabilityId,
            draftRevision: draft.schemaRevision,
            currentRevision: currentSchemaRevision,
          },
        });
        /* Still return values; individual fields will be merged */
      }

      /* Check if draft is too old (30 days) */
      var maxAge = 30 * 24 * 60 * 60 * 1000;
      if (draft.savedAt && (Date.now() - draft.savedAt) > maxAge) return null;

      return draft.values;
    } catch (e) {
      return null;
    }
  }

  function clearDrafts() {
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ }
  }

  return {
    buildForm:       buildForm,
    getValues:       getValues,
    validateValues:  validateValues,
    mergeDefaults:   mergeDefaults,
    saveDraft:       saveDraft,
    loadDraft:       loadDraft,
    clearDrafts:     clearDrafts,
  };
})();
