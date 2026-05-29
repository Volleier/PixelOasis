import "@spectrum-web-components/button/sp-button.js";
import "@spectrum-web-components/card/sp-card.js";

import type { PresetDefinition } from "../domain/presets";

interface PresetCardProps {
  preset: PresetDefinition;
  busy: boolean;
  onRun: () => void;
}

export function PresetCard({ preset, busy, onRun }: PresetCardProps) {
  return (
    <sp-card class="preset-card">
      <div className="preset-card__body">
        <div>
          <p className="preset-card__eyebrow">{preset.id}</p>
          <h3 className="preset-card__title">{preset.label}</h3>
          <p className="preset-card__summary">{preset.summary}</p>
        </div>
        <sp-button
          variant="accent"
          treatment="fill"
          disabled={busy}
          onClick={onRun}
        >
          {busy ? "处理中" : "运行预设"}
        </sp-button>
      </div>
    </sp-card>
  );
}
