/* PixelOasis v2 — Deploy single-file Photoshop plugin
 *
 * Uses script-manifest.mjs as the single source of truth.
 * Concatenates all scripts into main.js in load order.
 * Handles subdirectories: api/, capabilities/, ui/, vendor/, etc.
 */

import { copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = resolve(projectRoot, "pixeloasis-plugin");
const deployDir = resolve(projectRoot, "PixelOasis");
const legacyDeployDir = resolve(projectRoot, "com.pixeloasis.plugin");

/* ── Read config.yaml ── */
let config = {};
const configPath = resolve(projectRoot, "config.yaml");
if (existsSync(configPath)) {
  try {
    const raw = readFileSync(configPath, "utf-8");
    config = parseYaml(raw) || {};
  } catch (err) {
    console.warn("Warning: failed to parse config.yaml:", err.message);
  }
} else {
  console.warn("Warning: config.yaml not found — using defaults.");
}

const psMinHostVersion = config.photoshop?.min_host_version || "27.0.0";
const psPluginPath = config.photoshop?.plugin_path || "";

/* ── Import manifest ── */
const manifestPath = resolve(pluginRoot, "scripts", "script-manifest.mjs");
const manifestUrl = new URL("file:///" + manifestPath.replace(/\\/g, "/")).href;
const manifest = await import(manifestUrl);
const sourceScripts = manifest.sourceScripts || [];
const legacyScripts = manifest.legacyScripts || [];

/* Build ordered script list: source + legacy (deduplicated) */
const seen = new Set();
const allScripts = [];
for (const s of [...sourceScripts, ...legacyScripts]) {
  if (!seen.has(s)) {
    seen.add(s);
    allScripts.push(s);
  }
}

await rm(deployDir, { recursive: true, force: true });
await rm(legacyDeployDir, { recursive: true, force: true });
await mkdir(deployDir, { recursive: true });
await mkdir(resolve(deployDir, "icons"), { recursive: true });

/* ── Concatenate all scripts in manifest order ── */
const chunks = [];
for (const filename of allScripts) {
  try {
    const content = await readFile(resolve(pluginRoot, filename), "utf8");
    chunks.push(`\n/* ===== ${filename} ===== */\n${content}\n`);
  } catch (e) {
    console.warn(`Warning: script not found, skipping: ${filename}`);
  }
}

await writeFile(resolve(deployDir, "main.js"), chunks.join("\n"), "utf8");
await copyFile(resolve(pluginRoot, "panel.css"), resolve(deployDir, "panel.css"));

for (const icon of ["icon.png", "icon@1x.png", "icon@2x.png"]) {
  try {
    await copyFile(resolve(pluginRoot, "icons", icon), resolve(deployDir, "icons", icon));
  } catch (e) {
    console.warn(`Warning: icon not found: ${icon}`);
  }
}

/* ── Minimal index.html for single-file deployment ── */
const indexHtml = `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>PixelOasis</title>
    <link rel="stylesheet" href="./panel.css" />
  </head>
  <body>
    <div id="app"></div>
    <script src="./main.js"></script>
  </body>
</html>
`;

await writeFile(resolve(deployDir, "index.html"), indexHtml, "utf8");

/* ── manifest v6 for direct deployment ── */
const manifestV6 = {
  manifestVersion: 6,
  id: "com.pixeloasis.plugin",
  name: "PixelOasis",
  version: "0.2.0",
  main: "index.html",
  icons: [
    { width: 32, height: 32, path: "icons/icon@1x.png" },
    { width: 64, height: 64, path: "icons/icon@2x.png" },
  ],
  host: {
    app: "PS",
    minVersion: psMinHostVersion,
  },
  entrypoints: [
    {
      type: "panel",
      id: "pixeloasis.panel",
      label: {
        default: "PixelOasis",
      },
      minimumSize: {
        width: 300,
        height: 480,
      },
      maximumSize: {
        width: 900,
        height: 1600,
      },
      preferredDockedSize: {
        width: 340,
        height: 560,
      },
      preferredFloatingSize: {
        width: 420,
        height: 680,
      },
    },
  ],
  requiredPermissions: {
    localFileSystem: "fullAccess",
    launchProcess: {
      schemes: ["https", "http", "file", "ws"],
      extensions: [".png", ".jpg", ".jpeg", ".jsonl"],
    },
    network: {
      domains: "all",
    },
    clipboard: "readAndWrite",
    webview: {
      allow: "yes",
      domains: "all",
      enableMessageBridge: "localAndRemote",
    },
    ipc: {
      enablePluginCommunication: true,
    },
    allowCodeGenerationFromStrings: true,
  },
};

await writeFile(resolve(deployDir, "manifest.json"), `${JSON.stringify(manifestV6, null, 2)}\n`, "utf8");

console.log("Prepared deployable Photoshop plugin.");
console.log(`  Directory: ${deployDir}`);
console.log(`  Host minVersion: ${psMinHostVersion}`);
console.log(`  Scripts bundled: ${allScripts.length} modules`);
console.log("  Files: manifest.json, index.html, main.js, panel.css, icons/");

/* ── Detect placeholder paths ── */
function isPlaceholderPath(p) {
  if (!p || typeof p !== "string") return true;
  var trimmed = p.trim();
  if (trimmed.length === 0) return true;
  if (/Your[\/\\]Path[\/\\]To/i.test(trimmed)) return true;
  return false;
}

/* ── Auto-deploy to photoshop.plugin_path ── */
if (psPluginPath) {
  if (isPlaceholderPath(psPluginPath)) {
    console.warn("\nWarning: photoshop.plugin_path appears to be a placeholder value.");
    console.warn("  Update config.yaml with your real Photoshop Plug-ins path.");
  } else {
    var targetDir = resolve(psPluginPath, "PixelOasis");
    console.log(`\nDeploying to: ${targetDir}`);

    try {
      if (!existsSync(psPluginPath)) {
        console.warn("  Target directory does not exist — creating it.");
        mkdirSync(psPluginPath, { recursive: true });
      }
      await cp(deployDir, targetDir, { recursive: true, force: true });
      console.log("  Deployment complete.");
    } catch (err) {
      console.error("  Deployment failed:", err.message);
      console.error("  Please manually copy PixelOasis/ to your Photoshop Plug-ins directory.");
    }
  }
} else {
  console.warn("\nWarning: photoshop.plugin_path is not set in config.yaml.");
  console.warn("  Set it to enable automatic plugin deployment.");
}
