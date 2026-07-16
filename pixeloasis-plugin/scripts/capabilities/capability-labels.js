/* capability-labels.js — v2 capability labels, sections, and fixture data
 *
 * Provides:
 *   SECTION_ORDER          — 6 fixed sections with localised titles
 *   SECTION_ICONS          — allowed icon keys
 *   OLD_NAME_MAP           — legacy display-name migration
 *   EXPECTED_CAPABILITY_IDS — all 27 capabilityId strings
 *   CAPABILITIES_FIXTURE   — hardcoded 27-capability fallback data
 *   normalizeCapability()  — validate and sanitize a raw capability object
 */

window.PO = window.PO || {};

window.PO.CapabilityLabels = (function () {
  "use strict";

  /* ── Section definitions ── */
  var SECTION_ORDER = [
    { id: "sceneEffects",     title: "场景氛围" },
    { id: "combatEffects",    title: "战斗特效" },
    { id: "studioComposite",  title: "场照与合成" },
    { id: "portrait",         title: "人像塑形" },
    { id: "hair",             title: "头发创作" },
    { id: "lightingCleanup",  title: "光影与清理" },
  ];

  /* Valid section IDs (whitelist) */
  var VALID_SECTIONS = {};
  for (var si = 0; si < SECTION_ORDER.length; si++) {
    VALID_SECTIONS[SECTION_ORDER[si].id] = true;
  }

  /* ── Allowed icon keys ── */
  var SECTION_ICONS = {
    sceneEffects:    "effects",
    combatEffects:   "combat",
    studioComposite: "studio",
    portrait:        "portrait",
    hair:            "hair",
    lightingCleanup: "lighting",
  };

  /* ── Legacy display-name map (old name → canonical capabilityId) ── */
  var OLD_NAME_MAP = {
    "场照修图":   "scene.quickCleanupGrade",
    "白棚":      "scene.whiteStudio",
    "光影溶图":   "scene.lightBlend",
    "2D 转 3D":  "scene.dimensionalize2D",
    "场照清场":   "scene.fullCleanup",
    "fufu 玩偶":  "creative.fufuDolls",
  };

  /* ── All 27 expected capability IDs ── */
  var EXPECTED_CAPABILITY_IDS = [
    "effects.desertSandstorm",
    "effects.blackSmokeDust",
    "effects.waterSparkle",
    "effects.lightning",
    "effects.sparksDebris",
    "effects.bulletStorm",
    "scene.quickCleanupGrade",
    "scene.whiteStudio",
    "scene.lightBlend",
    "scene.dimensionalize2D",
    "scene.fullCleanup",
    "creative.fufuDolls",
    "portrait.impastoMakeup",
    "portrait.impastoEyes",
    "portrait.masculineFace",
    "portrait.bustEnhance",
    "wardrobe.removeSafetyShorts",
    "hair.handdrawnLong",
    "hair.beautify",
    "hair.strands",
    "hair.windFlow",
    "lighting.flashRim",
    "cleanup.removeSupport",
    "lighting.underlight",
    "cleanup.removeLightingGear",
    "lighting.enhance",
    "lighting.backlight",
  ];

  /* ── Input requirement labels ── */
  var INPUT_LABELS = {
    document:      "全图",
    selection:     "选区",
    subjectMask:   "主体",
    editMask:      "编辑区域",
    points:        "控制点",
    reference:     "参考图",
  };

  /* ── Readiness display info ── */
  var READINESS_INFO = {
    ready:                 { cls: "po-badge--ready",     text: "" },
    degraded:              { cls: "po-badge--degraded",  text: "兼容模式" },
    missing_models:        { cls: "po-badge--missing",   text: "模型缺失" },
    missing_nodes:         { cls: "po-badge--missing",   text: "节点缺失" },
    unsupported_hardware:  { cls: "po-badge--hardware",  text: "硬件不足" },
    policy_disabled:       { cls: "po-badge--disabled",  text: "已禁用" },
  };

  /* ═══════════════════════════════════════════════════════════════════
   * CAPABILITIES FIXTURE — 27 capabilities used when gateway is offline
   * ═══════════════════════════════════════════════════════════════════ */

  var CAPABILITIES_FIXTURE = [
    /* ── 场景氛围 (4) ── */
    {
      id: "effects.desertSandstorm",
      title: "飞沙走石",
      section: "sceneEffects",
      description: "生成沙漠背景、风沙、近景颗粒和运动模糊效果",
      icon: "effects",
      input: { source: "document", mask: "optional", points: "none", subjectMask: "optional" },
      parameterSchema: {},
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 10, requiresConfirm: true },
      tags: ["沙", "风", "沙漠", "粒子"],
    },
    {
      id: "effects.blackSmokeDust",
      title: "黑色烟尘",
      section: "sceneEffects",
      description: "分形噪声烟体与粒子效果，支持遮挡合成",
      icon: "effects",
      input: { source: "document", mask: "optional", points: "optional", subjectMask: "optional" },
      parameterSchema: {},
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 20, requiresConfirm: true },
      tags: ["烟", "尘", "烟雾"],
    },
    {
      id: "effects.waterSparkle",
      title: "水面波光",
      section: "sceneEffects",
      description: "水面高光波纹、闪烁和阈值混合效果",
      icon: "effects",
      input: { source: "document", mask: "required", points: "none", editMask: "required" },
      parameterSchema: {},
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 30, requiresConfirm: true },
      tags: ["水", "波光", "高光", "反射"],
    },
    {
      id: "effects.lightning",
      title: "雷电",
      section: "sceneEffects",
      description: "分形分支雷电、辉光和场景环境反射",
      icon: "effects",
      input: { source: "document", mask: "optional", points: "two", subjectMask: "optional" },
      parameterSchema: {},
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 40, requiresConfirm: true },
      tags: ["雷", "电", "闪电", "辉光"],
    },

    /* ── 战斗特效 (2) ── */
    {
      id: "effects.sparksDebris",
      title: "火花碎石",
      section: "combatEffects",
      description: "火花轨迹、辉光与碎石粒子效果",
      icon: "combat",
      input: { source: "document", mask: "optional", points: "optional", subjectMask: "optional" },
      parameterSchema: {},
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 10, requiresConfirm: true },
      tags: ["火花", "碎石", "粒子", "战斗"],
    },
    {
      id: "effects.bulletStorm",
      title: "枪林弹雨",
      section: "combatEffects",
      description: "多弹道、曳光、枪口方向和前后景遮挡效果",
      icon: "combat",
      input: { source: "document", mask: "optional", points: "optional", subjectMask: "optional" },
      parameterSchema: {},
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 20, requiresConfirm: true },
      tags: ["子弹", "弹道", "战斗", "枪"],
    },

    /* ── 场照与合成 (6) ── */
    {
      id: "scene.quickCleanupGrade",
      title: "场照修图",
      section: "studioComposite",
      description: "近景穿帮清理、背景压暗、降饱和与轻景深",
      icon: "studio",
      input: { source: "document", mask: "none", points: "none" },
      parameterSchema: {},
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 10, requiresConfirm: true },
      tags: ["场照", "修图", "清理", "调色"],
    },
    {
      id: "scene.whiteStudio",
      title: "白棚",
      section: "studioComposite",
      description: "主体抠图、灰白无缝棚生成、接触阴影与色温匹配",
      icon: "studio",
      input: { source: "document", mask: "none", points: "none", subjectMask: "optional" },
      parameterSchema: {},
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 20, requiresConfirm: true },
      tags: ["白棚", "抠图", "棚拍", "背景"],
    },
    {
      id: "scene.lightBlend",
      title: "光影溶图",
      section: "studioComposite",
      description: "主体重照、色彩融合与接触阴影合成",
      icon: "studio",
      input: { source: "document", mask: "none", points: "none", subjectMask: "required" },
      parameterSchema: {},
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 30, requiresConfirm: true },
      tags: ["溶图", "光影", "融合", "重照"],
    },
    {
      id: "scene.dimensionalize2D",
      title: "2D 转 3D",
      section: "studioComposite",
      description: "深度法线驱动的立体化重绘与明暗增强（视觉3D，非网格）",
      icon: "studio",
      input: { source: "document", mask: "optional", points: "none" },
      parameterSchema: {},
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 40, requiresConfirm: true },
      tags: ["3D", "立体", "深度", "法线"],
    },
    {
      id: "scene.fullCleanup",
      title: "场照清场",
      section: "studioComposite",
      description: "开放词汇检测并移除灯架/三脚架/路人等穿帮元素",
      icon: "studio",
      input: { source: "document", mask: "none", points: "none" },
      parameterSchema: {},
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 50, requiresConfirm: true },
      tags: ["清场", "去物", "穿帮", "修复"],
    },
    {
      id: "creative.fufuDolls",
      title: "fufu 玩偶",
      section: "studioComposite",
      description: "生成 2-5 个 fufu 风格玩偶透明元素并深度布局",
      icon: "studio",
      input: { source: "document", mask: "none", points: "none", subjectMask: "optional" },
      parameterSchema: {},
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 60, requiresConfirm: true },
      tags: ["fufu", "玩偶", "创意", "生成"],
    },

    /* ── 人像塑形 (5) ── */
    {
      id: "portrait.impastoMakeup",
      title: "厚涂妆感",
      section: "portrait",
      description: "保身份局部重绘、厚涂高光阴影塑形皮肤",
      icon: "portrait",
      input: { source: "selection", mask: "none", points: "none", subjectMask: "none" },
      parameterSchema: {},
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 10, requiresConfirm: true },
      tags: ["厚涂", "妆感", "皮肤", "人像"],
    },
    {
      id: "portrait.impastoEyes",
      title: "厚涂眼睛",
      section: "portrait",
      description: "虹膜玻璃高光、焦散与荧光睫毛效果",
      icon: "portrait",
      input: { source: "selection", mask: "none", points: "none", subjectMask: "none" },
      parameterSchema: {},
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 20, requiresConfirm: true },
      tags: ["眼睛", "厚涂", "高光", "睫毛"],
    },
    {
      id: "portrait.masculineFace",
      title: "成男转绘",
      section: "portrait",
      description: "受控修改下颌、眉骨、鼻唇明暗，保持身份",
      icon: "portrait",
      input: { source: "selection", mask: "none", points: "none", subjectMask: "none" },
      parameterSchema: {},
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 30, requiresConfirm: true },
      tags: ["成男", "转绘", "面部", "男性化"],
    },
    {
      id: "portrait.bustEnhance",
      title: "丰胸",
      section: "portrait",
      description: "受限局部形变与服装褶皱修复（仅限成人）",
      icon: "portrait",
      input: { source: "selection", mask: "required", points: "none", editMask: "required" },
      parameterSchema: {},
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 40, requiresConfirm: true },
      tags: ["丰胸", "塑形", "成人"],
    },
    {
      id: "wardrobe.removeSafetyShorts",
      title: "服装修复",
      section: "portrait",
      description: "外层服装延展与非私密区域重建（仅限成人）",
      icon: "portrait",
      input: { source: "selection", mask: "required", points: "none", editMask: "required" },
      parameterSchema: {},
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 50, requiresConfirm: true },
      tags: ["服装", "修复", "打底裤", "成人"],
    },

    /* ── 头发创作 (4) ── */
    {
      id: "hair.handdrawnLong",
      title: "手绘感长发",
      section: "hair",
      description: "扩展夸张二次元长发，线稿/色块控制与边缘融合",
      icon: "hair",
      input: { source: "selection", mask: "required", points: "none", editMask: "required" },
      parameterSchema: {},
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 10, requiresConfirm: true },
      tags: ["长发", "手绘", "二次元", "头发"],
    },
    {
      id: "hair.beautify",
      title: "头发美化",
      section: "hair",
      description: "去假发边、结构保持重绘、发丝补边与皮肤交界融合",
      icon: "hair",
      input: { source: "selection", mask: "required", points: "none", editMask: "required" },
      parameterSchema: {},
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 20, requiresConfirm: true },
      tags: ["头发", "美化", "发型", "边缘"],
    },
    {
      id: "hair.strands",
      title: "厚涂发丝",
      section: "hair",
      description: "程序化曲线发丝与少量语义融合",
      icon: "hair",
      input: { source: "selection", mask: "required", points: "none", editMask: "required" },
      parameterSchema: {},
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 30, requiresConfirm: true },
      tags: ["发丝", "厚涂", "头发", "程序化"],
    },
    {
      id: "hair.windFlow",
      title: "氛围飘发",
      section: "hair",
      description: "光流式形变与生成式补全飘发效果",
      icon: "hair",
      input: { source: "selection", mask: "required", points: "none", editMask: "required" },
      parameterSchema: {},
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 40, requiresConfirm: true },
      tags: ["飘发", "风", "氛围", "头发"],
    },

    /* ── 光影与清理 (6) ── */
    {
      id: "lighting.flashRim",
      title: "闪光灯轮廓",
      section: "lightingCleanup",
      description: "背面方向轮廓光、轻体积雾与头发透光",
      icon: "lighting",
      input: { source: "document", mask: "none", points: "none", subjectMask: "optional" },
      parameterSchema: {},
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 10, requiresConfirm: true },
      tags: ["轮廓光", "闪光灯", "透光", "边缘"],
    },
    {
      id: "cleanup.removeSupport",
      title: "消除梯子",
      section: "lightingCleanup",
      description: "检测并移除梯子/凳子，补全被遮挡区域",
      icon: "lighting",
      input: { source: "selection", mask: "required", points: "none", editMask: "required" },
      parameterSchema: {},
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 20, requiresConfirm: true },
      tags: ["梯子", "移除", "去物", "修复"],
    },
    {
      id: "lighting.underlight",
      title: "氛围底光",
      section: "lightingCleanup",
      description: "底部点/面光照明、主体底光与环境溢光（七色可选）",
      icon: "lighting",
      input: { source: "document", mask: "none", points: "none", subjectMask: "optional" },
      parameterSchema: {},
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 30, requiresConfirm: true },
      tags: ["底光", "氛围", "彩色", "照明"],
    },
    {
      id: "cleanup.removeLightingGear",
      title: "消除灯架",
      section: "lightingCleanup",
      description: "检测并移除灯箱/灯架/三脚架/线缆，自动补全背景",
      icon: "lighting",
      input: { source: "document", mask: "optional", points: "none", editMask: "optional" },
      parameterSchema: {},
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 40, requiresConfirm: true },
      tags: ["灯架", "移除", "补全", "自动"],
    },
    {
      id: "lighting.enhance",
      title: "光影增强",
      section: "lightingCleanup",
      description: "光源方向估计、法线引导塑形与肤色保护",
      icon: "lighting",
      input: { source: "document", mask: "optional", points: "none" },
      parameterSchema: {},
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 50, requiresConfirm: true },
      tags: ["光影", "增强", "塑形", "对比度"],
    },
    {
      id: "lighting.backlight",
      title: "逆光",
      section: "lightingCleanup",
      description: "背后光源、逆光重照、空气透视与边缘光",
      icon: "lighting",
      input: { source: "document", mask: "none", points: "none", subjectMask: "optional" },
      parameterSchema: {},
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 60, requiresConfirm: true },
      tags: ["逆光", "背光", "空气透视", "重照"],
    },
  ];

  /* ═══════════════════════════════════════════════════════════════════
   * normalizeCapability(raw)
   * ═══════════════════════════════════════════════════════════════════ */

  function normalizeCapability(raw) {
    if (!raw || typeof raw !== "object") return null;

    /* Reject non-string IDs */
    if (typeof raw.id !== "string" || raw.id.length === 0) {
      window.PO.Logger && window.PO.Logger.warn("capability.invalid_id", {
        component: "capability-labels",
        data: { reason: "non-string or empty capability id" },
      });
      return null;
    }

    /* Reject unknown section */
    if (!VALID_SECTIONS[raw.section]) {
      window.PO.Logger && window.PO.Logger.warn("capability.unknown_section", {
        component: "capability-labels",
        data: { capabilityId: raw.id, section: raw.section },
      });
      return null;
    }

    /* Validate icon is in whitelist */
    var icon = raw.icon || SECTION_ICONS[raw.section] || "effects";
    var validIcon = false;
    var iconKeys = Object.keys(SECTION_ICONS);
    for (var i = 0; i < iconKeys.length; i++) {
      if (SECTION_ICONS[iconKeys[i]] === icon) { validIcon = true; break; }
    }
    if (!validIcon) {
      icon = SECTION_ICONS[raw.section] || "effects";
    }

    /* Validate ui.requiresConfirm — missing = true (safe default) */
    var requiresConfirm = true;
    if (raw.ui && typeof raw.ui.requiresConfirm === "boolean") {
      requiresConfirm = raw.ui.requiresConfirm;
    }

    return {
      id:              raw.id,
      title:           String(raw.title || raw.id),
      section:         raw.section,
      description:     String(raw.description || ""),
      icon:            icon,
      input:           raw.input || { source: "document", mask: "none", points: "none" },
      parameterSchema: raw.parameterSchema || {},
      availability:    raw.availability || { state: "ready", profile: null },
      ui: {
        order:           (raw.ui && typeof raw.ui.order === "number") ? raw.ui.order : 999,
        requiresConfirm: requiresConfirm,
      },
      tags:            Array.isArray(raw.tags) ? raw.tags.slice() : [],
      _raw:            null, /* never expose raw gateway data to UI rendering */
    };
  }

  /* ── Get readiness display info ── */
  function getReadinessInfo(state) {
    return READINESS_INFO[state] || READINESS_INFO.ready;
  }

  /* ── Get input requirement summary ── */
  function getInputSummary(input) {
    if (!input) return "全图";
    var parts = [];
    if (input.source === "selection") parts.push("需选区");
    if (input.editMask === "required") parts.push("需编辑蒙版");
    if (input.subjectMask === "required") parts.push("需主体");
    if (input.points === "two") parts.push("需2个控制点");
    if (input.mask === "required" && input.source !== "selection") parts.push("需蒙版");
    return parts.length > 0 ? parts.join("，") : "全图处理";
  }

  return {
    SECTION_ORDER:           SECTION_ORDER,
    SECTION_ICONS:           SECTION_ICONS,
    OLD_NAME_MAP:            OLD_NAME_MAP,
    EXPECTED_CAPABILITY_IDS: EXPECTED_CAPABILITY_IDS,
    CAPABILITIES_FIXTURE:    CAPABILITIES_FIXTURE,
    INPUT_LABELS:            INPUT_LABELS,
    normalizeCapability:     normalizeCapability,
    getReadinessInfo:        getReadinessInfo,
    getInputSummary:         getInputSummary,
  };
})();
