/* tools/download-depth-anything.mjs — Quick download for Depth Anything V2 model
 *
 * Downloads depth_anything_v2_vitl_fp16.safetensors (~680 MB) from the
 * first reachable source.  Tries multiple mirrors in order.
 *
 * The model is required by effects.blackSmokeDust and other depth-aware
 * capabilities.  Without it, the capability stays at missing_models.
 *
 * Usage: node tools/download-depth-anything.mjs
 */

import { createWriteStream, existsSync, mkdirSync, statSync, unlinkSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { get } from "node:https";
import { request } from "node:http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const DEST_DIR = resolve(PROJECT_ROOT, "models", "depthanything");
const DEST_FILE = join(DEST_DIR, "depth_anything_v2_vitl_fp16.safetensors");

const SOURCES = [
  { name: "ModelScope",      url: "https://modelscope.cn/models/damo/Depth-Anything-V2-Large/resolve/main/depth_anything_v2_vitl_fp16.safetensors" },
  { name: "hf-mirror.com",   url: "https://hf-mirror.com/depth-anything/Depth-Anything-V2-Large/resolve/main/depth_anything_v2_vitl_fp16.safetensors" },
  { name: "Hugging Face",    url: "https://huggingface.co/depth-anything/Depth-Anything-V2-Large/resolve/main/depth_anything_v2_vitl_fp16.safetensors" },
  { name: "hf-mirror (Kijai)", url: "https://hf-mirror.com/Kijai/DepthAnythingV2-safetensors/resolve/main/depth_anything_v2_vitl_fp16.safetensors" },
];

console.log("Depth Anything V2 — Model Download\n");
console.log("  Target: " + DEST_FILE);
console.log("  Size:   ~680 MB (FP16 safetensors)\n");

/* Check if already exists */
if (existsSync(DEST_FILE)) {
  const st = statSync(DEST_FILE);
  const expectedSize = 640 * 1024 * 1024; /* ~640 MB */
  if (st.size > expectedSize * 0.95) {
    console.log("  Model already exists! (" + (st.size / 1024 / 1024).toFixed(0) + " MB)");
    console.log("  Path: " + DEST_FILE);
    console.log("\n  Restart the gateway for the change to take effect.\n");
    process.exit(0);
  }
  console.log("  Partial file found (" + (st.size / 1024 / 1024).toFixed(0) + " MB) — restarting download...\n");
}

/* Ensure directory */
if (!existsSync(DEST_DIR)) mkdirSync(DEST_DIR, { recursive: true });

/* Try each source */
for (const src of SOURCES) {
  console.log("  Trying " + src.name + "...");
  console.log("    " + src.url);

  try {
    await downloadFile(src.url, DEST_FILE);
    const st = statSync(DEST_FILE);
    console.log("  ✓ Downloaded " + (st.size / 1024 / 1024).toFixed(0) + " MB to " + DEST_FILE);
    console.log("\n  Done! Restart the gateway for the change to take effect.\n");
    process.exit(0);
  } catch (err) {
    console.error("  ✗ " + src.name + " failed: " + err.message);
    try { if (existsSync(DEST_FILE)) unlinkSync(DEST_FILE); } catch (_) {}
    console.log("");
  }
}

console.error("\n  All sources exhausted. Manual download required:\n");
console.error("  Download from one of:");
for (const src of SOURCES) {
  console.error("    - " + src.name + ": " + src.url);
}
console.error("\n  Save as: " + DEST_FILE);
console.error("\n  Then restart the gateway.\n");
process.exit(1);

/* ── Download helper ── */
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(destPath);
    const client = url.startsWith("https") ? get : request;

    const req = client(url, { timeout: 0 }, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        file.close();
        try { unlinkSync(destPath); } catch (_) {}
        downloadFile(response.headers.location, destPath).then(resolve, reject);
        return;
      }

      if (response.statusCode !== 200) {
        file.close();
        try { unlinkSync(destPath); } catch (_) {}
        reject(new Error("HTTP " + response.statusCode));
        return;
      }

      const total = parseInt(response.headers["content-length"], 10) || 0;
      let downloaded = 0;
      let lastLog = 0;

      response.on("data", (chunk) => {
        downloaded += chunk.length;
        if (total > 0 && Date.now() - lastLog > 1000) {
          lastLog = Date.now();
          const pct = Math.round((downloaded / total) * 100);
          process.stdout.write("\r    " + pct + "% (" + (downloaded / 1024 / 1024).toFixed(0) + " / " + (total / 1024 / 1024).toFixed(0) + " MB)  ");
        }
      });

      response.pipe(file);
      file.on("finish", () => { file.close(); if (downloaded > 0) process.stdout.write("\n"); resolve(); });
      file.on("error", (err) => { file.close(); try { unlinkSync(destPath); } catch (_) {} reject(err); });
    });

    req.on("error", (err) => { try { unlinkSync(destPath); } catch (_) {} reject(err); });
  });
}
