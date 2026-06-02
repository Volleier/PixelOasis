import type { PresetDefinition } from "../../domain/presets";

import { captureSelection } from "../photoshop/captureSelection";
import { placeGeneratedLayer } from "../photoshop/placeGeneratedLayer";
import { generate } from "../gateway/generate";

export interface WorkflowOptions {
  gatewayUrl: string;
  provider: string;
  workflow: string;
}

function createCorrelationId(): string {
  return `po-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function runPresetWorkflow(
  preset: PresetDefinition,
  options: WorkflowOptions,
): Promise<void> {
  const selection = await captureSelection();

  const response = await generate(options.gatewayUrl, {
    presetId: preset.id,
    prompt: preset.prompt,
    selection,
    adapter: {
      provider: options.provider,
      endpoint: options.gatewayUrl,
      workflow: options.workflow,
    },
    parameters: preset.defaults,
    correlationId: createCorrelationId(),
  });

  await placeGeneratedLayer({
    imageBase64: response.result.imageBase64,
    mimeType: response.result.mimeType,
    bounds: selection.bounds,
    layerName: `PixelOasis - ${preset.label}`,
    maskBase64: selection.maskBase64,
  });
}
