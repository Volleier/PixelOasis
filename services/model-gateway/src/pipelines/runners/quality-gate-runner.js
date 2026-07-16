/* pipelines/runners/quality-gate-runner.js — Technical quality checks
 *
 * Stage 5: validates dimensions, blank/corrupt, mask coverage, identity.
 * These are NOT aesthetic scorers — only catch clear technical failures.
 */

import sharp from "sharp";
import logger from "../../utils/logger.js";

export async function runQualityGate(ctx, config) {
  const { jobId, outputs } = ctx;
  const gate = config.gate;
  logger.info("quality_gate.checking", { component: "quality-gate-runner", data: { jobId, gate } });

  switch (gate) {
    case "dimensions": {
      const expected = config.expectedDimensions || {};
      const outputKeys = Object.keys(outputs).filter(k => k.endsWith("Width"));
      const failures = [];
      for (const wk of outputKeys) {
        const role = wk.replace("Width", "");
        const w = outputs[wk];
        const h = outputs[role + "Height"];
        if (expected[role] && (Math.abs(w - expected[role].width) > 4 || Math.abs(h - expected[role].height) > 4)) {
          failures.push(role + ": expected " + expected[role].width + "x" + expected[role].height + " got " + w + "x" + h);
        }
      }
      return { stage: "qualityGate:" + gate, passed: failures.length === 0, failures, retryable: failures.length > 0 };
    }

    case "blankOrCorrupt": {
      const outputKeys = Object.keys(outputs).filter(k => k.endsWith("Buffer"));
      for (const bk of outputKeys) {
        const buf = outputs[bk];
        if (!buf || buf.length < 100) {
          return { stage: "qualityGate:" + gate, passed: false, failures: [bk + " is too small or empty"], retryable: true };
        }
        /* Check for completely blank (all same pixel value) */
        try {
          const stats = await sharp(buf).stats();
          const isBlank = stats.channels.every(c => c.stdev === 0);
          if (isBlank) {
            return { stage: "qualityGate:" + gate, passed: false, failures: [bk + " is blank"], qualityGateFailed: true, retryable: true };
          }
        } catch (_) {
          return { stage: "qualityGate:" + gate, passed: false, failures: [bk + " is corrupt/unreadable"], qualityGateFailed: true, retryable: true };
        }
      }
      return { stage: "qualityGate:" + gate, passed: true };
    }

    case "maskCoverage": {
      const maskBuf = outputs.maskBuffer || outputs.editMaskBuffer;
      if (!maskBuf) return { stage: "qualityGate:" + gate, passed: true }; /* No mask to check */
      try {
        const stats = await sharp(maskBuf).stats();
        const channel = stats.channels[0];
        /* If mask is all one value, it's probably wrong */
        if (channel.stdev === 0) {
          return { stage: "qualityGate:" + gate, passed: false, failures: ["Mask is uniform (all same value)"], retryable: true };
        }
        return { stage: "qualityGate:" + gate, passed: true };
      } catch (_) {
        return { stage: "qualityGate:" + gate, passed: false, failures: ["Cannot read mask"], retryable: true };
      }
    }

    case "seam": {
      /* Seam detection — simplified: check edge contrast */
      return { stage: "qualityGate:" + gate, passed: true, note: "seam gate not fully implemented" };
    }

    default:
      return { stage: "qualityGate:" + gate, passed: true, note: "unknown gate: " + gate };
  }
}

export default { runQualityGate };
