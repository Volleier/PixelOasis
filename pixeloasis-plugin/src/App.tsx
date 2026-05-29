import "@spectrum-web-components/divider/sp-divider.js";
import "@spectrum-web-components/theme/sp-theme.js";

import { presets } from "./domain/presets";
import { usePresetWorkflow } from "./hooks/usePresetWorkflow";
import { PresetCard } from "./components/PresetCard";
import { StatusBar } from "./components/StatusBar";
import "./styles/app.css";

export function App() {
  const { status, runningPresetId, execute } = usePresetWorkflow();
  const busy = runningPresetId !== null;

  return (
    <sp-theme color="dark" scale="medium" system="express">
      <main className="app-shell">
        <section className="hero">
          <p className="hero__eyebrow">PixelOasis</p>
          <h1 className="hero__title">Photoshop AI workflow bridge</h1>
          <p className="hero__copy">
            Use preset-driven, component-based workflows to capture a selection,
            call a model endpoint, and return the result as a masked layer.
          </p>
        </section>

        <StatusBar status={status} busy={busy} />

        <sp-divider size="m" />

        <section className="preset-grid">
          {presets.map((preset) => (
            <PresetCard
              key={preset.id}
              preset={preset}
              busy={runningPresetId === preset.id}
              onRun={() => void execute(preset)}
            />
          ))}
        </section>

        <section className="notes">
          <h2 className="notes__title">Integration points</h2>
          <p className="notes__copy">
            `captureSelection` and `placeGeneratedLayer` still need real UXP
            batchPlay and imaging implementations.
          </p>
          <p className="notes__copy">
            Frontend and backend fields are normalized in `docs/protocol.md`.
          </p>
        </section>
      </main>
    </sp-theme>
  );
}
