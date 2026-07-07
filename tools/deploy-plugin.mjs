import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = resolve(projectRoot, "pixeloasis-plugin");
const deployDir = resolve(projectRoot, "PixelOasis");
const legacyDeployDir = resolve(projectRoot, "com.pixeloasis.plugin");

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
    minVersion: "23.0.0",
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

console.log("Prepared deployable Photoshop plugin.");
console.log(`  Directory: ${deployDir}`);
console.log("  Files: manifest.json, index.html, main.js, panel.css, icons/");
