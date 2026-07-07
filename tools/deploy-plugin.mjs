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

const scriptFiles = [
  "scripts/ui-text.js",
  "scripts/state.js",
  "scripts/logger.js",
  "scripts/ui-template.js",
  "scripts/ui-workflows.js",
  "scripts/vendor/png-encoder.js",
  "scripts/gateway-client.js",
  "scripts/photoshop.js",
  "scripts/photoshop-place-layer.js",
  "scripts/placement-engine.js",
  "scripts/ui-status.js",
  "scripts/ui-preview.js",
  "scripts/ui-settings.js",
  "scripts/ui-parameters.js",
  "scripts/actions.js",
  "index.js",
];

await rm(deployDir, { recursive: true, force: true });
await rm(legacyDeployDir, { recursive: true, force: true });
await mkdir(deployDir, { recursive: true });
await mkdir(resolve(deployDir, "icons"), { recursive: true });

const chunks = [];
for (const filename of scriptFiles) {
  const content = await readFile(resolve(pluginRoot, filename), "utf8");
  chunks.push(`\n/* ===== ${filename} ===== */\n${content}\n`);
}

await writeFile(resolve(deployDir, "main.js"), chunks.join("\n"), "utf8");
await copyFile(resolve(pluginRoot, "panel.css"), resolve(deployDir, "panel.css"));

for (const icon of ["icon.png", "icon@1x.png", "icon@2x.png"]) {
  await copyFile(resolve(pluginRoot, "icons", icon), resolve(deployDir, "icons", icon));
}

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

const manifest = {
  manifestVersion: 6,
  id: "com.pixeloasis.plugin",
  name: "PixelOasis",
  version: "0.1.0",
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

await writeFile(resolve(deployDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

import { cp } from "node:fs/promises";

console.log("Prepared deployable Photoshop plugin.");
console.log(`  Directory: ${deployDir}`);
console.log(`  Host minVersion: ${psMinHostVersion}`);
console.log("  Files: manifest.json, index.html, main.js, panel.css, icons/");

/* P2-2: Detect placeholder paths */
function isPlaceholderPath(p) {
  if (!p || typeof p !== "string") return true;
  var trimmed = p.trim();
  if (trimmed.length === 0) return true;
  if (/Your[\/\\]Path[\/\\]To/i.test(trimmed)) return true;
  return false;
}

/* P2-1: Auto-deploy to photoshop.plugin_path */
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
