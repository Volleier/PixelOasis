import type { PresetDefinition } from "../domain/presets";

interface PresetCardProps {
  preset: PresetDefinition;
  busy: boolean;
  disabled?: boolean;
  onRun: () => void;
}

export function PresetCard({
  preset,
  busy,
  disabled = false,
  onRun,
}: PresetCardProps) {
  return (
    <article className="preset-card">
      <div className="preset-card__body">
        <div>
          <p className="preset-card__eyebrow">{preset.id}</p>
          <h3 className="preset-card__title">{preset.label}</h3>
          <p className="preset-card__summary">{preset.summary}</p>
        </div>
        <button
          className="preset-button"
          disabled={busy || disabled}
          onClick={onRun}
        >
          {busy ? "处理中" : "运行"}
        </button>
      </div>
    </article>
  );
}
