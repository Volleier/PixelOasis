/* capabilities-route.js — V2 capability registry endpoint
 *
 * GET /v2/capabilities         → all enabled capabilities
 * GET /v2/capabilities/{id}    → single capability
 *
 * Uses the capability registry loaded from *.capability.json files.
 * Falls back to fixture data if registry is not available.
 */

import { writeJson, v2NotFound } from "../../utils/errors.js";
import { getCapabilities, getCapability, refreshCapabilityReadiness } from "../../capabilities/registry-instance.js";
import logger from "../../utils/logger.js";

/* ── Fixture: fallback if registry not loaded ── */
const CAPABILITIES_FIXTURE = [
  { id: "effects.desertSandstorm", title: "飞沙走石", section: "sceneEffects", description: "生成沙漠背景、风沙、近景颗粒和运动模糊效果", input: { source: "document", mask: "optional", points: "none", subjectMask: "optional" }, parameterSchema: {}, availability: { state: "ready", profile: "quality_16gb" }, ui: { order: 10, requiresConfirm: true } },
  { id: "effects.blackSmokeDust", title: "黑色烟尘", section: "sceneEffects", description: "分形噪声烟体与粒子效果，支持遮挡合成", input: { source: "document", mask: "optional", points: "optional", subjectMask: "optional" }, parameterSchema: {}, availability: { state: "ready", profile: "quality_16gb" }, ui: { order: 20, requiresConfirm: true } },
  { id: "effects.waterSparkle", title: "水面波光", section: "sceneEffects", description: "水面高光波纹、闪烁和阈值混合效果", input: { source: "document", mask: "required", points: "none", editMask: "required" }, parameterSchema: {}, availability: { state: "ready", profile: "quality_16gb" }, ui: { order: 30, requiresConfirm: true } },
  { id: "effects.lightning", title: "雷电", section: "sceneEffects", description: "分形分支雷电、辉光和场景环境反射", input: { source: "document", mask: "optional", points: "two", subjectMask: "optional" }, parameterSchema: {}, availability: { state: "ready", profile: "quality_16gb" }, ui: { order: 40, requiresConfirm: true } },
  { id: "effects.sparksDebris", title: "火花碎石", section: "combatEffects", description: "火花轨迹、辉光与碎石粒子效果", input: { source: "document", mask: "optional", points: "optional", subjectMask: "optional" }, parameterSchema: {}, availability: { state: "ready", profile: "quality_16gb" }, ui: { order: 10, requiresConfirm: true } },
  { id: "effects.bulletStorm", title: "枪林弹雨", section: "combatEffects", description: "多弹道、曳光、枪口方向和前后景遮挡效果", input: { source: "document", mask: "optional", points: "optional", subjectMask: "optional" }, parameterSchema: {}, availability: { state: "ready", profile: "quality_16gb" }, ui: { order: 20, requiresConfirm: true } },
  { id: "scene.quickCleanupGrade", title: "场照修图", section: "studioComposite", description: "近景穿帮清理、背景压暗、降饱和与轻景深", input: { source: "document", mask: "none", points: "none" }, parameterSchema: {}, availability: { state: "ready", profile: "quality_16gb" }, ui: { order: 10, requiresConfirm: true } },
  { id: "scene.whiteStudio", title: "白棚", section: "studioComposite", description: "主体抠图、灰白无缝棚生成、接触阴影与色温匹配", input: { source: "document", mask: "none", points: "none", subjectMask: "optional" }, parameterSchema: {}, availability: { state: "ready", profile: "quality_16gb" }, ui: { order: 20, requiresConfirm: true } },
  { id: "scene.lightBlend", title: "光影溶图", section: "studioComposite", description: "主体重照、色彩融合与接触阴影合成", input: { source: "document", mask: "none", points: "none", subjectMask: "required" }, parameterSchema: {}, availability: { state: "ready", profile: "quality_16gb" }, ui: { order: 30, requiresConfirm: true } },
  { id: "scene.dimensionalize2D", title: "2D 转 3D", section: "studioComposite", description: "深度法线驱动的立体化重绘与明暗增强", input: { source: "document", mask: "optional", points: "none" }, parameterSchema: {}, availability: { state: "ready", profile: "quality_16gb" }, ui: { order: 40, requiresConfirm: true } },
  { id: "scene.fullCleanup", title: "场照清场", section: "studioComposite", description: "开放词汇检测并移除灯架/三脚架/路人等穿帮元素", input: { source: "document", mask: "none", points: "none" }, parameterSchema: {}, availability: { state: "ready", profile: "quality_16gb" }, ui: { order: 50, requiresConfirm: true } },
  { id: "creative.fufuDolls", title: "fufu 玩偶", section: "studioComposite", description: "生成 2-5 个 fufu 风格玩偶透明元素并深度布局", input: { source: "document", mask: "none", points: "none", subjectMask: "optional" }, parameterSchema: {}, availability: { state: "ready", profile: "quality_16gb" }, ui: { order: 60, requiresConfirm: true } },
  { id: "portrait.impastoMakeup", title: "厚涂妆感", section: "portrait", description: "保身份局部重绘、厚涂高光阴影塑形皮肤", input: { source: "selection", mask: "none", points: "none", subjectMask: "none" }, parameterSchema: {}, availability: { state: "ready", profile: "quality_16gb" }, ui: { order: 10, requiresConfirm: true } },
  { id: "portrait.impastoEyes", title: "厚涂眼睛", section: "portrait", description: "虹膜玻璃高光、焦散与荧光睫毛效果", input: { source: "selection", mask: "none", points: "none", subjectMask: "none" }, parameterSchema: {}, availability: { state: "ready", profile: "quality_16gb" }, ui: { order: 20, requiresConfirm: true } },
  { id: "portrait.masculineFace", title: "成男转绘", section: "portrait", description: "受控修改下颌、眉骨、鼻唇明暗，保持身份", input: { source: "selection", mask: "none", points: "none", subjectMask: "none" }, parameterSchema: {}, availability: { state: "ready", profile: "quality_16gb" }, ui: { order: 30, requiresConfirm: true } },
  { id: "portrait.bustEnhance", title: "丰胸", section: "portrait", description: "受限局部形变与服装褶皱修复（仅限成人）", input: { source: "selection", mask: "required", points: "none", editMask: "required" }, parameterSchema: {}, availability: { state: "ready", profile: "quality_16gb" }, ui: { order: 40, requiresConfirm: true } },
  { id: "wardrobe.removeSafetyShorts", title: "服装修复", section: "portrait", description: "外层服装延展与非私密区域重建（仅限成人）", input: { source: "selection", mask: "required", points: "none", editMask: "required" }, parameterSchema: {}, availability: { state: "ready", profile: "quality_16gb" }, ui: { order: 50, requiresConfirm: true } },
  { id: "hair.handdrawnLong", title: "手绘感长发", section: "hair", description: "扩展夸张二次元长发，线稿/色块控制与边缘融合", input: { source: "selection", mask: "required", points: "none", editMask: "required" }, parameterSchema: {}, availability: { state: "ready", profile: "quality_16gb" }, ui: { order: 10, requiresConfirm: true } },
  { id: "hair.beautify", title: "头发美化", section: "hair", description: "去假发边、结构保持重绘、发丝补边与皮肤交界融合", input: { source: "selection", mask: "required", points: "none", editMask: "required" }, parameterSchema: {}, availability: { state: "ready", profile: "quality_16gb" }, ui: { order: 20, requiresConfirm: true } },
  { id: "hair.strands", title: "厚涂发丝", section: "hair", description: "程序化曲线发丝与少量语义融合", input: { source: "selection", mask: "required", points: "none", editMask: "required" }, parameterSchema: {}, availability: { state: "ready", profile: "quality_16gb" }, ui: { order: 30, requiresConfirm: true } },
  { id: "hair.windFlow", title: "氛围飘发", section: "hair", description: "光流式形变与生成式补全飘发效果", input: { source: "selection", mask: "required", points: "none", editMask: "required" }, parameterSchema: {}, availability: { state: "ready", profile: "quality_16gb" }, ui: { order: 40, requiresConfirm: true } },
  { id: "lighting.flashRim", title: "闪光灯轮廓", section: "lightingCleanup", description: "背面方向轮廓光、轻体积雾与头发透光", input: { source: "document", mask: "none", points: "none", subjectMask: "optional" }, parameterSchema: {}, availability: { state: "ready", profile: "quality_16gb" }, ui: { order: 10, requiresConfirm: true } },
  { id: "cleanup.removeSupport", title: "消除梯子", section: "lightingCleanup", description: "检测并移除梯子/凳子，补全被遮挡区域", input: { source: "selection", mask: "required", points: "none", editMask: "required" }, parameterSchema: {}, availability: { state: "ready", profile: "quality_16gb" }, ui: { order: 20, requiresConfirm: true } },
  { id: "lighting.underlight", title: "氛围底光", section: "lightingCleanup", description: "底部点/面光照明、主体底光与环境溢光（七色可选）", input: { source: "document", mask: "none", points: "none", subjectMask: "optional" }, parameterSchema: {}, availability: { state: "ready", profile: "quality_16gb" }, ui: { order: 30, requiresConfirm: true } },
  { id: "cleanup.removeLightingGear", title: "消除灯架", section: "lightingCleanup", description: "检测并移除灯箱/灯架/三脚架/线缆，自动补全背景", input: { source: "document", mask: "optional", points: "none", editMask: "optional" }, parameterSchema: {}, availability: { state: "ready", profile: "quality_16gb" }, ui: { order: 40, requiresConfirm: true } },
  { id: "lighting.enhance", title: "光影增强", section: "lightingCleanup", description: "光源方向估计、法线引导塑形与肤色保护", input: { source: "document", mask: "optional", points: "none" }, parameterSchema: {}, availability: { state: "ready", profile: "quality_16gb" }, ui: { order: 50, requiresConfirm: true } },
  { id: "lighting.backlight", title: "逆光", section: "lightingCleanup", description: "背后光源、逆光重照、空气透视与边缘光", input: { source: "document", mask: "none", points: "none", subjectMask: "optional" }, parameterSchema: {}, availability: { state: "ready", profile: "quality_16gb" }, ui: { order: 60, requiresConfirm: true } },
];

const _byId = {};
(function buildIndex() {
  for (const c of CAPABILITIES_FIXTURE) { _byId[c.id] = c; }
})();

/* ── GET /v2/capabilities ── */
export async function handleCapabilities(req, res, params) {
  await refreshCapabilityReadiness();
  /* The v2 registry is authoritative. Fixture data must never advertise
     executable capabilities when the registry failed to initialise. */
  const registryCaps = getCapabilities();
  if (registryCaps && registryCaps.length > 0) {
    writeJson(res, 200, {
      schemaVersion: "2.0",
      revision: "capability-registry",
      capabilities: registryCaps,
    });
    return;
  }

  writeJson(res, 503, {
    error: {
      code: "CAPABILITY_REGISTRY_UNAVAILABLE",
      message: "Capability registry is unavailable",
      retryable: true,
    },
  });
}

/* ── GET /v2/capabilities/{id} ── */
export async function handleCapabilityById(req, res, routeParams) {
  await refreshCapabilityReadiness();
  const id = routeParams.id;

  /* Try registry first */
  const cap = getCapability(id) || _byId[id];
  if (!cap) {
    v2NotFound(res, "CAPABILITY_NOT_FOUND", "Capability not found: " + id);
    return;
  }
  writeJson(res, 200, cap);
}
