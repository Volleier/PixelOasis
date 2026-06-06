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
for (const filename of ["index.html", "index.js", "panel.css", "manifest.json"]) {
  await copyFile(resolve(pluginRoot, filename), resolve(distDir, filename));
}

/* Script modules */
const scriptFiles = [
  "ui-text.js",
  "state.js",
  "ui-template.js",
  "photoshop.js",
  "ui-status.js",
  "ui-preview.js",
  "ui-settings.js",
  "actions.js",
];

for (const filename of scriptFiles) {
  await copyFile(
    resolve(scriptDir, filename),
    resolve(distScriptsDir, filename),
  );
}

/* Patch manifest — set main to index.html */
const manifestTarget = resolve(distDir, "manifest.json");
const manifestRaw = await readFile(manifestTarget, "utf8");
const manifest = JSON.parse(manifestRaw);
manifest.main = "index.html";

await writeFile(manifestTarget, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log("Prepared classic UXP dist for UXP Developer Tool.");
console.log(`  Root:   index.html, index.js, panel.css, manifest.json`);
console.log(`  Scripts: ${scriptFiles.map(f => `scripts/${f}`).join(", ")}`);
