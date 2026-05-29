export type PresetId = "inpaint" | "skin-retouch" | "relight";

export interface PresetDefinition {
  id: PresetId;
  label: string;
  summary: string;
  prompt: string;
  defaults: Record<string, unknown>;
}

export const presets: PresetDefinition[] = [
  {
    id: "inpaint",
    label: "局部重绘",
    summary: "针对选区进行局部替换与重绘，尽量保持周边结构稳定。",
    prompt: "High fidelity localized inpaint, preserve surrounding composition.",
    defaults: {
      strength: 0.75,
      steps: 30,
    },
  },
  {
    id: "skin-retouch",
    label: "磨皮",
    summary: "保留人物特征与毛孔质感，减少瑕疵与粗糙噪点。",
    prompt: "Natural skin retouch, preserve pores and identity.",
    defaults: {
      denoise: 0.3,
      steps: 24,
    },
  },
  {
    id: "relight",
    label: "打光",
    summary: "重建局部光线层次，强调体积感与材质表现。",
    prompt: "Cinematic relight, preserve texture and subject placement.",
    defaults: {
      cfgScale: 6,
      steps: 28,
    },
  },
];
