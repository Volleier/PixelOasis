import { useState } from "react";

import type { PresetDefinition } from "../domain/presets";
import type { PluginSettings } from "../domain/settings";

import { runPresetWorkflow } from "../services/workflow/runPresetWorkflow";

export function usePresetWorkflow(settings: PluginSettings) {
  const [status, setStatus] = useState("Idle");
  const [runningPresetId, setRunningPresetId] = useState<string | null>(null);
  const isConfigured =
    settings.gatewayUrl.trim().length > 0 &&
    settings.provider.trim().length > 0 &&
    settings.workflow.trim().length > 0;

  async function execute(preset: PresetDefinition) {
    if (!isConfigured) {
      const message =
        "Configure gateway URL, provider, and workflow before running a preset.";
      setStatus(message);
      throw new Error(message);
    }

    setRunningPresetId(preset.id);
    setStatus(`Running: ${preset.label}`);

    try {
      await runPresetWorkflow(preset, settings);
      setStatus("Completed");
    } catch (error) {
      setStatus(error instanceof Error ? `Failed: ${error.message}` : "Failed");
      throw error;
    } finally {
      setRunningPresetId(null);
    }
  }

  return {
    status,
    runningPresetId,
    isConfigured,
    execute,
  };
}
