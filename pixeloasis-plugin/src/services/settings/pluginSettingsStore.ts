import type { PluginSettings } from "../../domain/settings";
import { defaultPluginSettings } from "../../domain/settings";

declare const require: (module: string) => any;

const settingsFileName = "pixeloasis-settings.json";

async function getDataFolder() {
  const { storage } = require("uxp");
  return storage.localFileSystem.getDataFolder();
}

export async function loadPluginSettings(): Promise<PluginSettings> {
  try {
    const folder = await getDataFolder();
    const file = await folder.getEntry(settingsFileName);
    const raw = await file.read();
    const parsed = JSON.parse(raw);

    return {
      gatewayUrl:
        typeof parsed.gatewayUrl === "string" && parsed.gatewayUrl.trim()
          ? parsed.gatewayUrl.trim()
          : defaultPluginSettings.gatewayUrl,
      provider:
        typeof parsed.provider === "string" && parsed.provider.trim()
          ? parsed.provider.trim()
          : defaultPluginSettings.provider,
      workflow:
        typeof parsed.workflow === "string" && parsed.workflow.trim()
          ? parsed.workflow.trim()
          : defaultPluginSettings.workflow,
    };
  } catch {
    return defaultPluginSettings;
  }
}

export async function savePluginSettings(
  settings: PluginSettings,
): Promise<PluginSettings> {
  const normalized: PluginSettings = {
    gatewayUrl: settings.gatewayUrl.trim(),
    provider: settings.provider.trim(),
    workflow: settings.workflow.trim(),
  };

  if (!normalized.gatewayUrl) {
    throw new Error("Gateway URL is required.");
  }

  if (!normalized.provider) {
    throw new Error("Provider is required.");
  }

  if (!normalized.workflow) {
    throw new Error("Workflow is required.");
  }

  const folder = await getDataFolder();
  const file = await folder.createFile(settingsFileName, {
    overwrite: true,
  });

  await file.write(JSON.stringify(normalized, null, 2));
  return normalized;
}
