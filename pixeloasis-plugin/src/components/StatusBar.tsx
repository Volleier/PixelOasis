import "@spectrum-web-components/progress-circle/sp-progress-circle.js";

interface StatusBarProps {
  status: string;
  busy: boolean;
}

export function StatusBar({ status, busy }: StatusBarProps) {
  return (
    <div className="status-bar">
      <div>
        <p className="status-bar__label">Workflow Status</p>
        <p className="status-bar__value">{status}</p>
      </div>
      {busy ? <sp-progress-circle size="s" indeterminate /> : null}
    </div>
  );
}
