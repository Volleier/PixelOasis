import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(scriptDir, "..");
const distDir = resolve(pluginRoot, "dist");
const manifestSource = resolve(pluginRoot, "manifest.json");
const manifestTarget = resolve(distDir, "manifest.json");

await mkdir(distDir, { recursive: true });
await copyFile(manifestSource, manifestTarget);

const manifestRaw = await readFile(manifestTarget, "utf8");
const manifest = JSON.parse(manifestRaw);
manifest.main = "index.html";

await writeFile(manifestTarget, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log("Prepared dist for UXP Developer Tool.");
