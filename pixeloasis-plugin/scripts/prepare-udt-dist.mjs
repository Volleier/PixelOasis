import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(scriptDir, "..");
const distDir = resolve(pluginRoot, "dist");

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

for (const filename of ["index.html", "index.js", "panel.css", "manifest.json"]) {
  await copyFile(resolve(pluginRoot, filename), resolve(distDir, filename));
}

const manifestTarget = resolve(distDir, "manifest.json");
const manifestRaw = await readFile(manifestTarget, "utf8");
const manifest = JSON.parse(manifestRaw);
manifest.main = "index.html";

await writeFile(manifestTarget, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log("Prepared classic UXP dist for UXP Developer Tool.");
