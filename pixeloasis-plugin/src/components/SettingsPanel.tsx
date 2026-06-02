import type { PluginSettings } from "../domain/settings";

interface SettingsPanelProps {
  settings: PluginSettings;
  loading: boolean;
  saving: boolean;
  message: string;
  onChange: <K extends keyof PluginSettings>(
    field: K,
    value: PluginSettings[K],
  ) => void;
  onSave: () => void;
}

export function SettingsPanel({
  settings,
  loading,
  saving,
  message,
  onChange,
  onSave,
}: SettingsPanelProps) {
  return (
    <section className="settings-card">
      <div className="settings-panel">
        <div>
          <p className="settings-panel__eyebrow">设置</p>
          <h2 className="settings-panel__title">网关配置</h2>
          <p className="settings-panel__copy">
            无需修改源码即可控制后端路由。
          </p>
        </div>

        <div className="settings-panel__fields">
          <label className="settings-panel__field">
            <span className="settings-panel__label">Gateway URL</span>
            <input
              className="settings-panel__input"
              value={settings.gatewayUrl}
              disabled={loading || saving}
              onInput={(event) =>
                onChange(
                  "gatewayUrl",
                  (event.currentTarget as HTMLInputElement).value,
                )
              }
            />
          </label>

          <label className="settings-panel__field">
            <span className="settings-panel__label">Provider</span>
            <input
              className="settings-panel__input"
              value={settings.provider}
              disabled={loading || saving}
              onInput={(event) =>
                onChange(
                  "provider",
                  (event.currentTarget as HTMLInputElement).value,
                )
              }
            />
          </label>

          <label className="settings-panel__field">
            <span className="settings-panel__label">Workflow</span>
            <input
              className="settings-panel__input"
              value={settings.workflow}
              disabled={loading || saving}
              onInput={(event) =>
                onChange(
                  "workflow",
                  (event.currentTarget as HTMLInputElement).value,
                )
              }
            />
          </label>
        </div>

        <div className="settings-panel__footer">
          <p className="settings-panel__message">{message}</p>
          <button
            className="settings-save"
            disabled={loading || saving}
            onClick={onSave}
          >
            {saving ? "保存中" : "保存设置"}
          </button>
        </div>
      </div>
    </section>
  );
}
