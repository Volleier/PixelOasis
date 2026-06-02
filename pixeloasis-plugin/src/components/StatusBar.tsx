interface StatusBarProps {
  status: string;
  busy: boolean;
}

export function StatusBar({ status, busy }: StatusBarProps) {
  return (
    <div className="status-bar">
      <div>
        <p className="status-bar__label">工作流状态</p>
        <p className="status-bar__value">{status}</p>
      </div>
      {busy ? <div className="status-bar__spinner" aria-hidden="true" /> : null}
    </div>
  );
}
