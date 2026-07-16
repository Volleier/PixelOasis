/* state-machine.js — Job state transition validator
 *
 * GatewayOrchestrationDesign §5.1:
 *   queued → preparing → running → postprocessing → succeeded
 *      │         │          │             │
 *      └─────────┴──────────┴─────────────┴──→ failed
 *               └──────────┴────────────────→ canceled
 *
 * State can only move forward. Terminal states: succeeded, failed, canceled.
 */

/* ── All valid states ── */
export const STATES = {
  QUEUED:          "queued",
  PREPARING:       "preparing",
  RUNNING:         "running",
  POSTPROCESSING:  "postprocessing",
  SUCCEEDED:       "succeeded",
  FAILED:          "failed",
  CANCELED:        "canceled",
};

/* ── Valid transitions (from → [to...]) ── */
const VALID_TRANSITIONS = {
  queued:          ["preparing", "canceled"],
  preparing:       ["running", "failed", "canceled"],
  running:         ["postprocessing", "failed", "canceled"],
  postprocessing:  ["succeeded", "failed"],
  /* Terminal states — no outgoing transitions */
  succeeded:       [],
  failed:          [],
  canceled:        [],
};

/* ── Active (non-terminal) states ── */
const ACTIVE_STATES = new Set([
  "queued", "preparing", "running", "postprocessing",
]);

/* ── Terminal states ── */
const TERMINAL_STATES = new Set([
  "succeeded", "failed", "canceled",
]);

/* ── State display names ── */
export const STATE_LABELS = {
  queued:          "排队中",
  preparing:       "准备中",
  running:         "生成中",
  postprocessing:  "后处理中",
  succeeded:       "已完成",
  failed:          "失败",
  canceled:        "已取消",
};

/* ═══════════════════════════════════════════════════════════════════
 * transition(currentState, newState) → { allowed, newState, error? }
 * ═══════════════════════════════════════════════════════════════════ */

export function transition(currentState, newState) {
  if (!currentState || !newState) {
    return { allowed: false, newState: null, error: "currentState and newState are required" };
  }

  if (!VALID_TRANSITIONS[currentState]) {
    return { allowed: false, newState: null, error: "Unknown current state: " + currentState };
  }

  if (currentState === newState) {
    /* Idempotent — same state is allowed (no-op) */
    return { allowed: true, newState: currentState };
  }

  const allowed = VALID_TRANSITIONS[currentState];
  if (allowed.indexOf(newState) === -1) {
    return {
      allowed: false,
      newState: null,
      error: "Invalid transition: " + currentState + " → " + newState +
             ". Allowed: " + allowed.join(", "),
    };
  }

  return { allowed: true, newState };
}

/* ═══════════════════════════════════════════════════════════════════
 * isTerminal(state) → boolean
 * ═══════════════════════════════════════════════════════════════════ */

export function isTerminal(state) {
  return TERMINAL_STATES.has(state);
}

/* ═══════════════════════════════════════════════════════════════════
 * isActive(state) → boolean
 * ═══════════════════════════════════════════════════════════════════ */

export function isActive(state) {
  return ACTIVE_STATES.has(state);
}

/* ═══════════════════════════════════════════════════════════════════
 * getProgressRange(state) → { min, max }
 * ═══════════════════════════════════════════════════════════════════ */

export function getProgressRange(state) {
  const ranges = {
    queued:          { min: 0,  max: 10 },
    preparing:       { min: 10, max: 25 },
    running:         { min: 25, max: 90 },
    postprocessing:  { min: 90, max: 99 },
    succeeded:       { min: 100, max: 100 },
    failed:          { min: 0,  max: 0 },
    canceled:        { min: 0,  max: 0 },
  };
  return ranges[state] || { min: 0, max: 0 };
}

export default { STATES, STATE_LABELS, transition, isTerminal, isActive, getProgressRange };
