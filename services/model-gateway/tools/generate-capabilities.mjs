import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

const caps = [
  {id:"effects.desertSandstorm",title:"飞沙走石",section:"sceneEffects",dir:"effects",pipeline:"desert-sandstorm-v1",desc:"生成沙漠背景、风沙、近景颗粒和运动模糊效果",input:{source:"document",mask:"optional",points:"none",subjectMask:"optional"}},
  {id:"effects.blackSmokeDust",title:"黑色烟尘",section:"sceneEffects",dir:"effects",pipeline:"black-smoke-v1",desc:"分形噪声烟体与粒子效果，支持遮挡合成",input:{source:"document",mask:"optional",points:"optional",subjectMask:"optional"}},
  {id:"effects.waterSparkle",title:"水面波光",section:"sceneEffects",dir:"effects",pipeline:"water-sparkle-v1",desc:"水面高光波纹、闪烁和阈值混合效果",input:{source:"document",mask:"required",points:"none",editMask:"required"}},
  {id:"effects.lightning",title:"雷电",section:"sceneEffects",dir:"effects",pipeline:"lightning-v1",desc:"分形分支雷电、辉光和场景环境反射",input:{source:"document",mask:"optional",points:"two",subjectMask:"optional"}},
  {id:"effects.sparksDebris",title:"火花碎石",section:"combatEffects",dir:"effects",pipeline:"sparks-debris-v1",desc:"火花轨迹、辉光与碎石粒子效果",input:{source:"document",mask:"optional",points:"optional",subjectMask:"optional"}},
  {id:"effects.bulletStorm",title:"枪林弹雨",section:"combatEffects",dir:"effects",pipeline:"bullet-storm-v1",desc:"多弹道、曳光、枪口方向和前后景遮挡效果",input:{source:"document",mask:"optional",points:"optional",subjectMask:"optional"}},
  {id:"scene.quickCleanupGrade",title:"场照修图",section:"studioComposite",dir:"scene",pipeline:"quick-cleanup-v1",desc:"近景穿帮清理、背景压暗、降饱和与轻景深",input:{source:"document",mask:"none",points:"none"}},
  {id:"scene.whiteStudio",title:"白棚",section:"studioComposite",dir:"scene",pipeline:"white-studio-v1",desc:"主体抠图、灰白无缝棚生成、接触阴影与色温匹配",input:{source:"document",mask:"none",points:"none",subjectMask:"optional"}},
  {id:"scene.lightBlend",title:"光影溶图",section:"studioComposite",dir:"scene",pipeline:"light-blend-v1",desc:"主体重照、色彩融合与接触阴影合成",input:{source:"document",mask:"none",points:"none",subjectMask:"required"}},
  {id:"scene.dimensionalize2D",title:"2D 转 3D",section:"studioComposite",dir:"scene",pipeline:"dimensionalize-v1",desc:"深度法线驱动的立体化重绘与明暗增强（视觉3D，非网格）",input:{source:"document",mask:"optional",points:"none"}},
  {id:"scene.fullCleanup",title:"场照清场",section:"studioComposite",dir:"scene",pipeline:"full-cleanup-v1",desc:"开放词汇检测并移除灯架/三脚架/路人等穿帮元素",input:{source:"document",mask:"none",points:"none"}},
  {id:"creative.fufuDolls",title:"fufu 玩偶",section:"studioComposite",dir:"creative",pipeline:"fufu-dolls-v1",desc:"生成 2-5 个 fufu 风格玩偶透明元素并深度布局",input:{source:"document",mask:"none",points:"none",subjectMask:"optional"}},
  {id:"portrait.impastoMakeup",title:"厚涂妆感",section:"portrait",dir:"portrait",pipeline:"impasto-makeup-v1",desc:"保身份局部重绘、厚涂高光阴影塑形皮肤",input:{source:"selection",mask:"none",points:"none",subjectMask:"none"}},
  {id:"portrait.impastoEyes",title:"厚涂眼睛",section:"portrait",dir:"portrait",pipeline:"impasto-eyes-v1",desc:"虹膜玻璃高光、焦散与荧光睫毛效果",input:{source:"selection",mask:"none",points:"none",subjectMask:"none"}},
  {id:"portrait.masculineFace",title:"成男转绘",section:"portrait",dir:"portrait",pipeline:"masculine-face-v1",desc:"受控修改下颌、眉骨、鼻唇明暗，保持身份",input:{source:"selection",mask:"none",points:"none",subjectMask:"none"}},
  {id:"portrait.bustEnhance",title:"丰胸",section:"portrait",dir:"portrait",pipeline:"bust-enhance-v1",desc:"受限局部形变与服装褶皱修复（仅限成人）",input:{source:"selection",mask:"required",points:"none",editMask:"required"},sensitive:true},
  {id:"wardrobe.removeSafetyShorts",title:"服装修复",section:"portrait",dir:"wardrobe",pipeline:"garment-repair-v1",desc:"外层服装延展与非私密区域重建（仅限成人）",input:{source:"selection",mask:"required",points:"none",editMask:"required"},sensitive:true},
  {id:"hair.handdrawnLong",title:"手绘感长发",section:"hair",dir:"hair",pipeline:"handdrawn-long-v1",desc:"扩展夸张二次元长发，线稿/色块控制与边缘融合",input:{source:"selection",mask:"required",points:"none",editMask:"required"}},
  {id:"hair.beautify",title:"头发美化",section:"hair",dir:"hair",pipeline:"hair-beautify-v1",desc:"去假发边、结构保持重绘、发丝补边与皮肤交界融合",input:{source:"selection",mask:"required",points:"none",editMask:"required"}},
  {id:"hair.strands",title:"厚涂发丝",section:"hair",dir:"hair",pipeline:"hair-strands-v1",desc:"程序化曲线发丝与少量语义融合",input:{source:"selection",mask:"required",points:"none",editMask:"required"}},
  {id:"hair.windFlow",title:"氛围飘发",section:"hair",dir:"hair",pipeline:"hair-windflow-v1",desc:"光流式形变与生成式补全飘发效果",input:{source:"selection",mask:"required",points:"none",editMask:"required"}},
  {id:"lighting.flashRim",title:"闪光灯轮廓",section:"lightingCleanup",dir:"lighting",pipeline:"flash-rim-v1",desc:"背面方向轮廓光、轻体积雾与头发透光",input:{source:"document",mask:"none",points:"none",subjectMask:"optional"}},
  {id:"cleanup.removeSupport",title:"消除梯子",section:"lightingCleanup",dir:"cleanup",pipeline:"remove-support-v1",desc:"检测并移除梯子/凳子，补全被遮挡区域",input:{source:"selection",mask:"required",points:"none",editMask:"required"}},
  {id:"lighting.underlight",title:"氛围底光",section:"lightingCleanup",dir:"lighting",pipeline:"underlight-v1",desc:"底部点/面光照明、主体底光与环境溢光（七色可选）",input:{source:"document",mask:"none",points:"none",subjectMask:"optional"}},
  {id:"cleanup.removeLightingGear",title:"消除灯架",section:"lightingCleanup",dir:"cleanup",pipeline:"remove-gear-v1",desc:"检测并移除灯箱/灯架/三脚架/线缆，自动补全背景",input:{source:"document",mask:"optional",points:"none",editMask:"optional"}},
  {id:"lighting.enhance",title:"光影增强",section:"lightingCleanup",dir:"lighting",pipeline:"lighting-enhance-v1",desc:"光源方向估计、法线引导塑形与肤色保护",input:{source:"document",mask:"optional",points:"none"}},
  {id:"lighting.backlight",title:"逆光",section:"lightingCleanup",dir:"lighting",pipeline:"backlight-v1",desc:"背后光源、逆光重照、空气透视与边缘光",input:{source:"document",mask:"none",points:"none",subjectMask:"optional"}},
];

const baseDir = resolve(import.meta.dirname || ".", "..", "capabilities");

for (const c of caps) {
  const dir = resolve(baseDir, c.dir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const obj = {
    schemaVersion: "2.0",
    id: c.id,
    title: { "zh-CN": c.title },
    description: { "zh-CN": c.desc },
    section: c.section,
    input: c.input,
    parameterSchema: {},
    outputSchema: {},
    pipeline: c.pipeline,
    variants: [],
    policy: { sensitive: !!c.sensitive },
    enabled: true,
    ui: { order: 10, requiresConfirm: true, icon: c.dir },
  };

  const filePath = resolve(dir, c.id + ".capability.json");
  writeFileSync(filePath, JSON.stringify(obj, null, 2) + "\n");
}

console.log("Created " + caps.length + " capability files");
