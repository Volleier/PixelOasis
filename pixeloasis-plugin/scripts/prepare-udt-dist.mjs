/* PixelOasis v2 — Classic UXP dist build
 *
 * Uses script-manifest.mjs as the single source of truth for file lists.
 * Supports subdirectory structure: api/, capabilities/, ui/, vendor/, etc.
 */

import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(scriptDir, "..");
const distDir = resolve(pluginRoot, "dist");
const distScriptsDir = resolve(distDir, "scripts");

/* Import manifest (file:// URL required on Windows) */
const manifestPath = resolve(scriptDir, "script-manifest.mjs");
const manifestUrl = new URL("file:///" + manifestPath.replace(/\\/g, "/")).href;
const manifest = await import(manifestUrl);
const sourceScripts = manifest.sourceScripts || [];
const vendorScripts = manifest.vendorScripts || [];
const rootFiles = manifest.rootFiles || ["index.html", "index.js", "panel.css", "manifest.json"];
const legacyScripts = manifest.legacyScripts || [];

/* All scripts to copy (source + legacy) */
const allScripts = [...new Set([...sourceScripts, ...legacyScripts])];

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

/* ── Root-level files ── */
for (const filename of rootFiles) {
  try {
    await copyFile(resolve(pluginRoot, filename), resolve(distDir, basename(filename)));
  } catch (e) {
    console.warn(`Warning: root file not found: ${filename}`);
  }
}

/* Also copy index.html directly (in case it's already listed as rootFiles) */
const indexPath = resolve(pluginRoot, "index.html");
const distIndexPath = resolve(distDir, "index.html");
try {
  await copyFile(indexPath, distIndexPath);
} catch (e) {
  console.error("Error: index.html not found — build failed");
  process.exit(1);
}

/* ── Icons ── */
const distIconsDir = resolve(distDir, "icons");
await mkdir(distIconsDir, { recursive: true });
const iconFiles = ["icon.png", "icon@1x.png", "icon@2x.png"];
for (const filename of iconFiles) {
  try {
    await copyFile(resolve(pluginRoot, "icons", filename), resolve(distIconsDir, filename));
  } catch (e) {
    console.warn(`Warning: icon file not found: ${filename}`);
  }
}

/* ── Script files (handle subdirectories) ── */
for (const scriptRel of allScripts) {
  const srcPath = resolve(pluginRoot, scriptRel);
  const destPath = resolve(distDir, scriptRel);
  const destSubdir = dirname(destPath);

  await mkdir(destSubdir, { recursive: true });

  try {
    await copyFile(srcPath, destPath);
  } catch (e) {
    console.warn(`Warning: script not found: ${scriptRel}`);
  }
}

/* ── Patch manifest: set main to index.html ── */
const distManifestPath = resolve(distDir, "manifest.json");
try {
  const manifestRaw = await readFile(distManifestPath, "utf8");
  const manifestJson = JSON.parse(manifestRaw);
  manifestJson.main = "index.html";
  await writeFile(distManifestPath, `${JSON.stringify(manifestJson, null, 2)}\n`, "utf8");
} catch (e) {
  console.warn("Warning: could not patch manifest.json");
}

/* ── Validate: ensure index.html script src matches manifest order ── */
const builtIndex = await readFile(distIndexPath, "utf8");
const scriptSrcMatches = [...builtIndex.matchAll(/<script\s+src="([^"]+)"/g)];
const actualOrder = scriptSrcMatches.map(m => m[1].replace(/^\//, ""));

/* Build expected order from manifest */
const expectedOrder = [];
for (const s of sourceScripts) {
  if (s === "index.js") {
    expectedOrder.push("./index.js");
  } else if (s.startsWith("scripts/")) {
    expectedOrder.push("./" + s);
  } else {
    expectedOrder.push("./scripts/" + s);
  }
}

/* Check that expected scripts exist in actual */
let orderOk = true;
for (let i = 0; i < expectedOrder.length; i++) {
  const idx = actualOrder.indexOf(expectedOrder[i]);
  if (idx === -1) {
    console.warn(`Warning: script missing from index.html: ${expectedOrder[i]}`);
    orderOk = false;
  }
}

/* Check relative order */
let lastIdx = -1;
for (let i = 0; i < expectedOrder.length; i++) {
  const idx = actualOrder.indexOf(expectedOrder[i]);
  if (idx !== -1) {
    if (idx < lastIdx) {
      console.warn(`Warning: script order violation: ${expectedOrder[i]} loaded before expected`);
      orderOk = false;
    }
    lastIdx = idx;
  }
}

if (orderOk) {
  console.log("✓ Script loading order validated against manifest");
} else {
  console.warn("⚠ Script loading order has discrepancies — review index.html");
}

console.log("Prepared classic UXP dist for UXP Developer Tool.");
console.log(`  Root:    ${rootFiles.join(", ")}`);
console.log(`  Scripts: ${sourceScripts.length} modules`);
console.log(`  Icons:   ${iconFiles.join(", ")}`);
