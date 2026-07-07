import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(scriptDir, "..");
const distDir = resolve(pluginRoot, "dist");
const distScriptsDir = resolve(distDir, "scripts");

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });
await mkdir(distScriptsDir, { recursive: true });

/* Root-level files */
const rootFiles = ["index.html", "index.js", "panel.css", "manifest.json"];
for (const filename of rootFiles) {
  await copyFile(resolve(pluginRoot, filename), resolve(distDir, filename));
}

/* Icons */
const distIconsDir = resolve(distDir, "icons");
await mkdir(distIconsDir, { recursive: true });
const iconFiles = ["icon.png", "icon@1x.png", "icon@2x.png"];
for (const filename of iconFiles) {
  await copyFile(resolve(pluginRoot, "icons", filename), resolve(distIconsDir, filename));
}

/* Script modules */
const scriptFiles = [
  "ui-text.js",
  "state.js",
  "logger.js",
  "ui-template.js",
  "ui-workflows.js",
  "photoshop.js",
  "gateway-client.js",
  "photoshop-place-layer.js",
  "ui-status.js",
  "ui-preview.js",
  "ui-settings.js",
  "ui-parameters.js",
  "actions.js",
];

for (const filename of scriptFiles) {
  await copyFile(
    resolve(scriptDir, filename),
    resolve(distScriptsDir, filename),
  );
}

/* Vendor modules */
const distVendorDir = resolve(distDir, "scripts", "vendor");
await mkdir(distVendorDir, { recursive: true });
const vendorFiles = ["png-encoder.js"];

for (const filename of vendorFiles) {
  await copyFile(
    resolve(scriptDir, "vendor", filename),
    resolve(distVendorDir, filename),
  );
}

/* Patch manifest — set main to index.html */
const manifestTarget = resolve(distDir, "manifest.json");
const manifestRaw = await readFile(manifestTarget, "utf8");
const manifest = JSON.parse(manifestRaw);
manifest.main = "index.html";

await writeFile(manifestTarget, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log("Prepared classic UXP dist for UXP Developer Tool.");
console.log(`  Root:    index.html, index.js, panel.css, manifest.json`);
console.log(`  Scripts: ${scriptFiles.map(f => `scripts/${f}`).join(", ")}`);
console.log(`  Vendor:  ${vendorFiles.map(f => `scripts/vendor/${f}`).join(", ")}`);
