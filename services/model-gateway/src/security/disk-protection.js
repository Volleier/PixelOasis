/* security/disk-protection.js — Disk space monitoring
 *
 * Stage 8: warns on low disk space (<20GB), rejects new jobs below 5GB.
 * Per GatewayOrchestrationDesign §11.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import config from "../config.js";
import logger from "../utils/logger.js";

const WARN_THRESHOLD_GB = 20;
const REJECT_THRESHOLD_GB = 5;

export function checkDiskSpace() {
  const dataDir = config.dataDir || "E:/PixelOasisData";
  if (!existsSync(dataDir)) return { ok: true, freeGb: 100 };

  try {
    let freeGb = 0;

    if (process.platform === "win32") {
      const drive = dataDir.substring(0, 2);
      const out = execSync("wmic logicaldisk where DeviceID='" + drive + "' get FreeSpace /value", { timeout: 5000 }).toString();
      const match = out.match(/FreeSpace=(\d+)/);
      if (match) freeGb = Math.round(parseInt(match[1]) / 1024 / 1024 / 1024);
    }

    if (freeGb < REJECT_THRESHOLD_GB) {
      logger.error("disk.critical", { component: "disk-protection", data: { freeGb } });
      return { ok: false, freeGb, reason: "磁盘空间不足 5GB，拒绝新任务" };
    }

    if (freeGb < WARN_THRESHOLD_GB) {
      logger.warn("disk.warning", { component: "disk-protection", data: { freeGb } });
      return { ok: true, freeGb, warning: "磁盘空间低于 20GB" };
    }

    return { ok: true, freeGb };
  } catch (e) {
    logger.warn("disk.check_failed", { component: "disk-protection", error: e });
    return { ok: true, freeGb: 50 }; /* Assume OK if check fails */
  }
}

export default { checkDiskSpace };
