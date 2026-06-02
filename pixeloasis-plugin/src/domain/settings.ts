export interface PluginSettings {
  gatewayUrl: string;
  provider: string;
  workflow: string;
}

export const defaultPluginSettings: PluginSettings = {
  gatewayUrl: "http://127.0.0.1:8787",
  provider: "echo",
  workflow: "default",
};
