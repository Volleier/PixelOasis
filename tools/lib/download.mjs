/* tools/lib/download.mjs — File download with progress */

import { createWriteStream, existsSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { get } from "node:https";
import { request } from "node:http";

/** Remove a partial file after a failed download. */
function cleanFile(destPath) {
  try { unlinkSync(destPath); } catch (_) { /* already gone */ }
}

export async function downloadFile(url, destPath) {
  return new Promise(function (resolve, reject) {
    const file = createWriteStream(destPath);
    const client = url.startsWith("https") ? get : request;

    client(url, function (response) {
      if (response.statusCode === 301 || response.statusCode === 302) {
        file.close();
        cleanFile(destPath);
        downloadFile(response.headers.location, destPath).then(resolve, reject);
        return;
      }

      if (response.statusCode !== 200) {
        file.close();
        cleanFile(destPath);
        reject(new Error(
          "HTTP " + response.statusCode + " from " + url +
          (response.statusCode === 403
            ? " (forbidden — the host may require authentication or the URL may be outdated)"
            : "") +
          (response.statusCode === 404
            ? " (not found — the model may have moved or been removed)"
            : "")
        ));
        return;
      }

      const total = parseInt(response.headers["content-length"], 10) || 0;
      let downloaded = 0;

      if (total === 0) {
        process.stdout.write("  (unknown size — starting download...)");
      }

      response.on("data", function (chunk) {
        downloaded += chunk.length;
        if (total > 0) {
          const pct = Math.round((downloaded / total) * 100);
          process.stdout.write("\r  " + pct + "% (" + formatBytes(downloaded) + " / " + formatBytes(total) + ")  ");
        }
      });

      response.pipe(file);

      file.on("finish", function () {
        file.close();
        if (downloaded > 0) process.stdout.write("\n");
        resolve();
      });

      file.on("error", function (err) {
        file.close();
        cleanFile(destPath);
        reject(err);
      });
    }).on("error", function (err) {
      cleanFile(destPath);
      reject(err);
    });
  });
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}
