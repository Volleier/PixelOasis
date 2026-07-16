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
      description: "",
      icon: "effects",
      input: { source: "document", mask: "optional", points: "none", subjectMask: "optional" },
      parameterSchema: { properties: { seed: { type: "integer", default: -1, title: "随机种子", description: "" }, profile: { type: "string", enum: ["quality_16gb","balanced_16gb"], default: "quality_16gb", title: "质量档" }, intensity: { type: "number", minimum: 0, maximum: 1, default: 0.55, title: "强度", description: "" }, wind: { type: "string", enum: ["left","right"], enumLabels: ["左","右"], default: "right", title: "风向" }, sandHue: { type: "string", default: "#D6A23A", title: "沙色", format: "color" }, replaceBackground: { type: "boolean", default: false, title: "替换背景", description: "" } } },
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 10, requiresConfirm: true },
      tags: ["沙", "风", "沙漠", "粒子"],
    },
    {
      id: "effects.blackSmokeDust",
      title: "黑色烟尘",
      section: "sceneEffects",
      description: "",
      icon: "effects",
      input: { source: "document", mask: "optional", points: "optional", subjectMask: "optional" },
      parameterSchema: { properties: { seed: { type: "integer", default: -1, title: "随机种子" }, profile: { type: "string", enum: ["quality_16gb","balanced_16gb"], default: "quality_16gb", title: "质量档" }, density: { type: "number", minimum: 0, maximum: 1, default: 0.5, title: "浓度", description: "" }, direction: { type: "string", enum: ["up","upRight","right","downRight","down"], enumLabels: ["上","右上","右","右下","下"], default: "upRight", title: "方向" }, spread: { type: "number", minimum: 0, maximum: 1, default: 0.5, title: "扩散", description: "" }, occlusion: { type: "string", enum: ["auto","front","back"], enumLabels: ["自动","前景遮挡","后景"], default: "auto", title: "遮挡模式" } } },
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 20, requiresConfirm: true },
      tags: ["烟", "尘", "烟雾"],
    },
    {
      id: "effects.waterSparkle",
      title: "水面波光",
      section: "sceneEffects",
      description: "",
      icon: "effects",
      input: { source: "document", mask: "required", points: "none", editMask: "required" },
      parameterSchema: { properties: { seed: { type: "integer", default: -1, title: "随机种子" }, profile: { type: "string", enum: ["quality_16gb","balanced_16gb"], default: "quality_16gb", title: "质量档" }, amount: { type: "number", minimum: 0, maximum: 1, default: 0.45, title: "数量", description: "" }, sunAngle: { type: "string", enum: ["auto","low","mid","high"], enumLabels: ["自动","低","中","高"], default: "auto", title: "日光角度" }, sparkleSize: { type: "number", minimum: 0, maximum: 1, default: 0.35, title: "闪烁大小" }, glow: { type: "number", minimum: 0, maximum: 1, default: 0.5, title: "辉光强度" } } },
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 30, requiresConfirm: true },
      tags: ["水", "波光", "高光", "反射"],
    },
    {
      id: "effects.lightning",
      title: "一键雷电",
      section: "sceneEffects",
      description: "",
      icon: "effects",
      input: { source: "document", mask: "optional", points: "two", subjectMask: "optional" },
      parameterSchema: { properties: { seed: { type: "integer", default: -1, title: "随机种子" }, profile: { type: "string", enum: ["quality_16gb","balanced_16gb"], default: "quality_16gb", title: "质量档" }, branches: { type: "number", minimum: 0, maximum: 1, default: 0.5, title: "分支数量", description: "" }, color: { type: "string", default: "#C9E4FF", title: "雷电颜色", format: "color" }, glow: { type: "number", minimum: 0, maximum: 1, default: 0.6, title: "辉光" }, relight: { type: "number", minimum: 0, maximum: 1, default: 0.35, title: "环境反射", description: "" } } },
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 40, requiresConfirm: true },
      tags: ["雷", "电", "闪电", "辉光"],
    },

    /* ── 战斗特效 (2) ── */
    {
      id: "effects.sparksDebris",
      title: "火花碎石",
      section: "combatEffects",
      description: "",
      icon: "combat",
      input: { source: "document", mask: "optional", points: "optional", subjectMask: "optional" },
      parameterSchema: { properties: { seed: { type: "integer", default: -1, title: "随机种子" }, profile: { type: "string", enum: ["quality_16gb","balanced_16gb"], default: "quality_16gb", title: "质量档" }, amount: { type: "number", minimum: 0, maximum: 1, default: 0.3, title: "数量" }, direction: { type: "string", enum: ["up","right","down","left","random"], enumLabels: ["上","右","下","左","随机"], default: "random", title: "方向" }, antiGravity: { type: "number", minimum: -1, maximum: 1, default: 0.35, title: "反重力", description: "" }, warmth: { type: "number", minimum: 0, maximum: 1, default: 0.8, title: "色温", description: "" } } },
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 10, requiresConfirm: true },
      tags: ["火花", "碎石", "粒子", "战斗"],
    },
    {
      id: "effects.bulletStorm",
      title: "枪林弹雨",
      section: "combatEffects",
      description: "",
      icon: "combat",
      input: { source: "document", mask: "optional", points: "optional", subjectMask: "optional" },
      parameterSchema: { properties: { seed: { type: "integer", default: -1, title: "随机种子" }, profile: { type: "string", enum: ["quality_16gb","balanced_16gb"], default: "quality_16gb", title: "质量档" }, amount: { type: "number", minimum: 0, maximum: 1, default: 0.45, title: "弹道数量" }, direction: { type: "string", enum: ["auto","left","right","center"], enumLabels: ["自动","左侧","右侧","居中"], default: "auto", title: "枪口方向" }, motionBlur: { type: "number", minimum: 0, maximum: 1, default: 0.7, title: "运动模糊" }, foregroundRatio: { type: "number", minimum: 0, maximum: 1, default: 0.4, title: "前景比例", description: "" } } },
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 20, requiresConfirm: true },
      tags: ["子弹", "弹道", "战斗", "枪"],
    },

    /* ── 场照与合成 (6) ── */
    {
      id: "scene.quickCleanupGrade",
      title: "一键场照",
      section: "studioComposite",
      description: "",
      icon: "studio",
      input: { source: "document", mask: "none", points: "none" },
      parameterSchema: { properties: { seed: { type: "integer", default: -1, title: "随机种子" }, profile: { type: "string", enum: ["quality_16gb","balanced_16gb"], default: "quality_16gb", title: "质量档" }, cleanup: { type: "string", enum: ["nearby","all"], enumLabels: ["近景","全部"], default: "nearby", title: "清理范围" }, backgroundExposure: { type: "number", minimum: -2, maximum: 2, default: -0.7, title: "背景曝光", description: "" }, desaturate: { type: "number", minimum: 0, maximum: 1, default: 0.28, title: "降饱和" }, backgroundBlur: { type: "number", minimum: 0, maximum: 1, default: 0, title: "背景模糊", description: "" } } },
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 10, requiresConfirm: true },
      tags: ["场照", "修图", "清理", "调色"],
    },
    {
      id: "scene.whiteStudio",
      title: "一键白棚",
      section: "studioComposite",
      description: "",
      icon: "studio",
      input: { source: "document", mask: "none", points: "none", subjectMask: "optional" },
      parameterSchema: { properties: { seed: { type: "integer", default: -1, title: "随机种子" }, profile: { type: "string", enum: ["quality_16gb","balanced_16gb"], default: "quality_16gb", title: "质量档" }, backdrop: { type: "string", enum: ["white","lightGray","midGray"], enumLabels: ["纯白","浅灰","中灰"], default: "lightGray", title: "背景色" }, shadow: { type: "number", minimum: 0, maximum: 1, default: 0.35, title: "阴影强度" }, edgeDecontaminate: { type: "number", minimum: 0, maximum: 1, default: 0.6, title: "边缘去色", description: "" } } },
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 20, requiresConfirm: true },
      tags: ["白棚", "抠图", "棚拍", "背景"],
    },
    {
      id: "scene.lightBlend",
      title: "光影溶图",
      section: "studioComposite",
      description: "",
      icon: "studio",
      input: { source: "document", mask: "none", points: "none", subjectMask: "required" },
      parameterSchema: { properties: { seed: { type: "integer", default: -1, title: "随机种子" }, profile: { type: "string", enum: ["quality_16gb","balanced_16gb"], default: "quality_16gb", title: "质量档" }, strength: { type: "number", minimum: 0, maximum: 1, default: 0.55, title: "强度" }, colorMatch: { type: "number", minimum: 0, maximum: 1, default: 0.65, title: "色彩匹配" }, contactShadow: { type: "number", minimum: 0, maximum: 1, default: 0.45, title: "接触阴影" }, lightDirection: { type: "string", enum: ["auto","backLeft","backRight","backCenter","top","left","right"], enumLabels: ["自动","左后","右后","后中","顶","左","右"], default: "auto", title: "光源方向" } } },
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 30, requiresConfirm: true },
      tags: ["溶图", "光影", "融合", "重照"],
    },
    {
      id: "scene.dimensionalize2D",
      title: "2D转3D",
      section: "studioComposite",
      description: "",
      icon: "studio",
      input: { source: "document", mask: "optional", points: "none" },
      parameterSchema: { properties: { seed: { type: "integer", default: -1, title: "随机种子" }, profile: { type: "string", enum: ["quality_16gb","balanced_16gb"], default: "quality_16gb", title: "质量档" }, depth: { type: "number", minimum: 0, maximum: 1, default: 0.55, title: "深度强度" }, material: { type: "string", enum: ["auto","skin","fabric","metal"], enumLabels: ["自动","皮肤","布料","金属"], default: "auto", title: "材质类型" }, preserveComposition: { type: "number", minimum: 0, maximum: 1, default: 0.9, title: "保留构图", description: "" } } },
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 40, requiresConfirm: true },
      tags: ["3D", "立体", "深度", "法线"],
    },
    {
      id: "scene.fullCleanup",
      title: "场照清场",
      section: "studioComposite",
      description: "",
      icon: "studio",
      input: { source: "document", mask: "none", points: "none" },
      parameterSchema: { properties: { seed: { type: "integer", default: -1, title: "随机种子" }, profile: { type: "string", enum: ["quality_16gb","balanced_16gb"], default: "quality_16gb", title: "质量档" }, removePeople: { type: "boolean", default: true, title: "移除路人" }, removeGear: { type: "boolean", default: true, title: "移除器材", description: "" }, removeClutter: { type: "number", minimum: 0, maximum: 1, default: 0.65, title: "杂物清理强度" }, protectSubject: { type: "boolean", default: true, title: "保护主体", description: "" } } },
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 50, requiresConfirm: true },
      tags: ["清场", "去物", "穿帮", "修复"],
    },
    {
      id: "creative.fufuDolls",
      title: "fufu玩偶",
      section: "studioComposite",
      description: "",
      icon: "studio",
      input: { source: "document", mask: "none", points: "none", subjectMask: "optional" },
      parameterSchema: { properties: { seed: { type: "integer", default: -1, title: "随机种子" }, profile: { type: "string", enum: ["quality_16gb","balanced_16gb"], default: "quality_16gb", title: "质量档" }, count: { type: "integer", minimum: 1, maximum: 5, default: 3, title: "数量" }, style: { type: "string", enum: ["fufu"], enumLabels: ["fufu风格"], default: "fufu", title: "风格" }, interaction: { type: "string", enum: ["surround","standing","sitting","floating"], enumLabels: ["环绕","站立","坐姿","漂浮"], default: "surround", title: "交互姿势" }, scale: { type: "number", minimum: 0.5, maximum: 1.5, default: 1, title: "缩放", description: "" } } },
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 60, requiresConfirm: true },
      tags: ["fufu", "玩偶", "创意", "生成"],
    },

    /* ── 人像塑形 (5) ── */
    {
      id: "portrait.impastoMakeup",
      title: "厚涂妆感",
      section: "portrait",
      description: "",
      icon: "portrait",
      input: { source: "selection", mask: "none", points: "none", subjectMask: "none" },
      parameterSchema: { properties: { seed: { type: "integer", default: -1, title: "随机种子" }, profile: { type: "string", enum: ["quality_16gb","balanced_16gb"], default: "quality_16gb", title: "质量档" }, strength: { type: "number", minimum: 0, maximum: 1, default: 0.45, title: "强度" }, texture: { type: "number", minimum: 0, maximum: 1, default: 0.55, title: "纹理", description: "" }, sculpt: { type: "number", minimum: 0, maximum: 1, default: 0.5, title: "塑形", description: "" }, protectFeatures: { type: "boolean", default: true, title: "保护五官", description: "" } } },
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 10, requiresConfirm: true },
      tags: ["厚涂", "妆感", "皮肤", "人像"],
    },
    {
      id: "portrait.impastoEyes",
      title: "厚涂眼睛",
      section: "portrait",
      description: "",
      icon: "portrait",
      input: { source: "selection", mask: "none", points: "none", subjectMask: "none" },
      parameterSchema: { properties: { seed: { type: "integer", default: -1, title: "随机种子" }, profile: { type: "string", enum: ["quality_16gb","balanced_16gb"], default: "quality_16gb", title: "质量档" }, glow: { type: "number", minimum: 0, maximum: 1, default: 0.45, title: "发光" }, glass: { type: "number", minimum: 0, maximum: 1, default: 0.65, title: "玻璃高光", description: "" }, lashColor: { type: "string", default: "#8EF6FF", title: "睫毛颜色", format: "color" }, irisColor: { type: "string", enum: ["auto","amber","blue","brown","gray","green","hazel","violet"], enumLabels: ["自动","琥珀","蓝","棕","灰","绿","褐","紫"], default: "auto", title: "虹膜颜色" } } },
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 20, requiresConfirm: true },
      tags: ["眼睛", "厚涂", "高光", "睫毛"],
    },
    {
      id: "portrait.masculineFace",
      title: "成男转绘",
      section: "portrait",
      description: "",
      icon: "portrait",
      input: { source: "selection", mask: "none", points: "none", subjectMask: "none" },
      parameterSchema: { properties: { seed: { type: "integer", default: -1, title: "随机种子" }, profile: { type: "string", enum: ["quality_16gb","balanced_16gb"], default: "quality_16gb", title: "质量档" }, strength: { type: "number", minimum: 0, maximum: 1, default: 0.45, title: "强度" }, jaw: { type: "number", minimum: 0, maximum: 1, default: 0.4, title: "下颌", description: "" }, brow: { type: "number", minimum: 0, maximum: 1, default: 0.35, title: "眉骨" }, featureDepth: { type: "number", minimum: 0, maximum: 1, default: 0.35, title: "五官深度" } } },
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 30, requiresConfirm: true },
      tags: ["成男", "转绘", "面部", "男性化"],
    },
    {
      id: "portrait.bustEnhance",
      title: "一键丰胸",
      section: "portrait",
      description: "",
      icon: "portrait",
      input: { source: "selection", mask: "required", points: "none", editMask: "required" },
      parameterSchema: { properties: { seed: { type: "integer", default: -1, title: "随机种子" }, profile: { type: "string", enum: ["quality_16gb","balanced_16gb"], default: "quality_16gb", title: "质量档" }, strength: { type: "number", minimum: 0.1, maximum: 0.6, default: 0.25, title: "强度", description: "" }, preserveWaist: { type: "boolean", default: true, title: "保持腰部" }, preserveFace: { type: "boolean", default: true, title: "保持面部" } } },
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 40, requiresConfirm: true },
      tags: ["丰胸", "塑形", "成人"],
    },
    {
      id: "wardrobe.removeSafetyShorts",
      title: "消除打底裤",
      section: "portrait",
      description: "",
      icon: "portrait",
      input: { source: "selection", mask: "required", points: "none", editMask: "required" },
      parameterSchema: { properties: { seed: { type: "integer", default: -1, title: "随机种子" }, profile: { type: "string", enum: ["quality_16gb","balanced_16gb"], default: "quality_16gb", title: "质量档" }, mode: { type: "string", enum: ["extendOuterGarment"], enumLabels: ["延展外层服装"], default: "extendOuterGarment", title: "修复模式" }, strength: { type: "number", minimum: 0, maximum: 1, default: 0.5, title: "强度" }, textureMatch: { type: "number", minimum: 0, maximum: 1, default: 0.7, title: "纹理匹配" } } },
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 50, requiresConfirm: true },
      tags: ["服装", "修复", "打底裤", "成人"],
    },

    /* ── 头发创作 (4) ── */
    {
      id: "hair.handdrawnLong",
      title: "手绘感长发",
      section: "hair",
      description: "",
      icon: "hair",
      input: { source: "selection", mask: "required", points: "none", editMask: "required" },
      parameterSchema: { properties: { seed: { type: "integer", default: -1, title: "随机种子" }, profile: { type: "string", enum: ["quality_16gb","balanced_16gb"], default: "quality_16gb", title: "质量档" }, length: { type: "number", minimum: 0, maximum: 1, default: 0.7, title: "长度" }, volume: { type: "number", minimum: 0, maximum: 1, default: 0.6, title: "发量" }, wind: { type: "string", enum: ["none","left","right","up"], enumLabels: ["无","左","右","上"], default: "auto", title: "风向" }, lineWeight: { type: "number", minimum: 0, maximum: 1, default: 0.5, title: "线稿感" } } },
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 10, requiresConfirm: true },
      tags: ["长发", "手绘", "二次元", "头发"],
    },
    {
      id: "hair.beautify",
      title: "头发美化",
      section: "hair",
      description: "",
      icon: "hair",
      input: { source: "selection", mask: "required", points: "none", editMask: "required" },
      parameterSchema: { properties: { seed: { type: "integer", default: -1, title: "随机种子" }, profile: { type: "string", enum: ["quality_16gb","balanced_16gb"], default: "quality_16gb", title: "质量档" }, strength: { type: "number", minimum: 0, maximum: 1, default: 0.4, title: "强度" }, shine: { type: "number", minimum: 0, maximum: 1, default: 0.35, title: "光泽" }, edgeBlend: { type: "number", minimum: 0, maximum: 1, default: 0.7, title: "边缘融合", description: "" }, preserveStyle: { type: "boolean", default: true, title: "保留发型" } } },
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 20, requiresConfirm: true },
      tags: ["头发", "美化", "发型", "边缘"],
    },
    {
      id: "hair.strands",
      title: "厚涂发丝",
      section: "hair",
      description: "",
      icon: "hair",
      input: { source: "selection", mask: "required", points: "none", editMask: "required" },
      parameterSchema: { properties: { seed: { type: "integer", default: -1, title: "随机种子" }, profile: { type: "string", enum: ["quality_16gb","balanced_16gb"], default: "quality_16gb", title: "质量档" }, amount: { type: "number", minimum: 0, maximum: 1, default: 0.45, title: "发丝数量" }, length: { type: "number", minimum: 0, maximum: 1, default: 0.4, title: "发丝长度" }, flyaway: { type: "number", minimum: 0, maximum: 1, default: 0.3, title: "碎发", description: "" }, strandColor: { type: "string", enum: ["auto","darkBrown","lightBrown","black","blonde","red","blue","pink"], enumLabels: ["自动","深棕","浅棕","黑","金","红","蓝","粉"], default: "auto", title: "发丝颜色" } } },
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 30, requiresConfirm: true },
      tags: ["发丝", "厚涂", "头发", "程序化"],
    },
    {
      id: "hair.windFlow",
      title: "氛围飘发",
      section: "hair",
      description: "",
      icon: "hair",
      input: { source: "selection", mask: "required", points: "none", editMask: "required" },
      parameterSchema: { properties: { seed: { type: "integer", default: -1, title: "随机种子" }, profile: { type: "string", enum: ["quality_16gb","balanced_16gb"], default: "quality_16gb", title: "质量档" }, wind: { type: "string", enum: ["left","right","up"], enumLabels: ["左","右","上"], default: "right", title: "风向" }, strength: { type: "number", minimum: 0, maximum: 1, default: 0.5, title: "强度" }, turbulence: { type: "number", minimum: 0, maximum: 1, default: 0.25, title: "湍流", description: "" }, preserveLength: { type: "boolean", default: true, title: "保留长度" } } },
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 40, requiresConfirm: true },
      tags: ["飘发", "风", "氛围", "头发"],
    },

    /* ── 光影与清理 (6) ── */
    {
      id: "lighting.flashRim",
      title: "闪光灯轮廓",
      section: "lightingCleanup",
      description: "",
      icon: "lighting",
      input: { source: "document", mask: "none", points: "none", subjectMask: "optional" },
      parameterSchema: { properties: { seed: { type: "integer", default: -1, title: "随机种子" }, profile: { type: "string", enum: ["quality_16gb","balanced_16gb"], default: "quality_16gb", title: "质量档" }, direction: { type: "string", enum: ["backLeft","backRight","backCenter","top","topLeft","topRight"], enumLabels: ["左后","右后","后中","顶部","左上","右上"], default: "backLeft", title: "闪光方向" }, power: { type: "number", minimum: 0, maximum: 1, default: 0.55, title: "强度" }, temperature: { type: "integer", minimum: 2500, maximum: 10000, default: 6200, title: "色温 (K)" }, hairTransmission: { type: "number", minimum: 0, maximum: 1, default: 0.5, title: "头发透光" } } },
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 10, requiresConfirm: true },
      tags: ["轮廓光", "闪光灯", "透光", "边缘"],
    },
    {
      id: "cleanup.removeSupport",
      title: "消除梯子",
      section: "lightingCleanup",
      description: "",
      icon: "lighting",
      input: { source: "selection", mask: "required", points: "none", editMask: "required" },
      parameterSchema: { properties: { seed: { type: "integer", default: -1, title: "随机种子" }, profile: { type: "string", enum: ["quality_16gb","balanced_16gb"], default: "quality_16gb", title: "质量档" }, rebuildOccluded: { type: "boolean", default: true, title: "重建被遮挡区域" }, strength: { type: "number", minimum: 0, maximum: 1, default: 0.8, title: "强度" }, keepShadow: { type: "boolean", default: true, title: "保留阴影" } } },
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 20, requiresConfirm: true },
      tags: ["梯子", "移除", "去物", "修复"],
    },
    {
      id: "lighting.underlight",
      title: "氛围底光",
      section: "lightingCleanup",
      description: "",
      icon: "lighting",
      input: { source: "document", mask: "none", points: "none", subjectMask: "optional" },
      parameterSchema: { properties: { seed: { type: "integer", default: -1, title: "随机种子" }, profile: { type: "string", enum: ["quality_16gb","balanced_16gb"], default: "quality_16gb", title: "质量档" }, color: { type: "string", enum: ["red","orange","yellow","green","cyan","blue","purple"], enumLabels: ["红","橙","黄","绿","青","蓝","紫"], default: "cyan", title: "颜色" }, power: { type: "number", minimum: 0, maximum: 1, default: 0.5, title: "强度" }, spread: { type: "number", minimum: 0, maximum: 1, default: 0.6, title: "扩散" } } },
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 30, requiresConfirm: true },
      tags: ["底光", "氛围", "彩色", "照明"],
    },
    {
      id: "cleanup.removeLightingGear",
      title: "消除灯架",
      section: "lightingCleanup",
      description: "",
      icon: "lighting",
      input: { source: "document", mask: "optional", points: "none", editMask: "optional" },
      parameterSchema: { properties: { seed: { type: "integer", default: -1, title: "随机种子" }, profile: { type: "string", enum: ["quality_16gb","balanced_16gb"], default: "quality_16gb", title: "质量档" }, autoDetect: { type: "boolean", default: true, title: "自动检测" }, includeCables: { type: "boolean", default: true, title: "含线缆" }, strength: { type: "number", minimum: 0, maximum: 1, default: 0.7, title: "强度" } } },
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 40, requiresConfirm: true },
      tags: ["灯架", "移除", "补全", "自动"],
    },
    {
      id: "lighting.enhance",
      title: "光影增强",
      section: "lightingCleanup",
      description: "",
      icon: "lighting",
      input: { source: "document", mask: "optional", points: "none" },
      parameterSchema: { properties: { seed: { type: "integer", default: -1, title: "随机种子" }, profile: { type: "string", enum: ["quality_16gb","balanced_16gb"], default: "quality_16gb", title: "质量档" }, strength: { type: "number", minimum: 0, maximum: 1, default: 0.45, title: "强度" }, contrast: { type: "number", minimum: 0, maximum: 1, default: 0.25, title: "对比度" }, protectSkin: { type: "boolean", default: true, title: "肤色保护" }, direction: { type: "string", enum: ["auto","top","bottom","left","right","topLeft","topRight","bottomLeft","bottomRight"], enumLabels: ["自动","上","下","左","右","左上","右上","左下","右下"], default: "auto", title: "光源方向" } } },
      availability: { state: "ready", profile: "quality_16gb" },
      ui: { order: 50, requiresConfirm: true },
      tags: ["光影", "增强", "塑形", "对比度"],
    },
    {
      id: "lighting.backlight",
      title: "一键逆光",
      section: "lightingCleanup",
      description: "",
      icon: "lighting",
      input: { source: "document", mask: "none", points: "none", subjectMask: "optional" },
      parameterSchema: { properties: { seed: { type: "integer", default: -1, title: "随机种子" }, profile: { type: "string", enum: ["quality_16gb","balanced_16gb"], default: "quality_16gb", title: "质量档" }, direction: { type: "string", enum: ["backCenter","backLeft","backRight","topBack"], enumLabels: ["后中","左后","右后","顶后"], default: "backCenter", title: "光源方向" }, power: { type: "number", minimum: 0, maximum: 1, default: 0.55, title: "强度" }, haze: { type: "number", minimum: 0, maximum: 1, default: 0.2, title: "空气透视", description: "" }, temperature: { type: "integer", minimum: 2500, maximum: 10000, default: 5500, title: "色温 (K)" } } },
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
