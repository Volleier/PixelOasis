import { useState } from "react";

import type { PresetDefinition } from "../domain/presets";

import { runPresetWorkflow } from "../services/workflow/runPresetWorkflow";

const defaultOptions = {
  gatewayUrl: "http://127.0.0.1:8787",
  provider: "echo",
};

export function usePresetWorkflow() {
  const [status, setStatus] = useState("Idle");
  const [runningPresetId, setRunningPresetId] = useState<string | null>(null);

  async function execute(preset: PresetDefinition) {
    setRunningPresetId(preset.id);
    setStatus(`Running: ${preset.label}`);

    try {
      await runPresetWorkflow(preset, defaultOptions);
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
    execute,
  };
}
