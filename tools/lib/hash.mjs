/* tools/lib/hash.mjs — SHA-256 file verification */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export function hashFile(filePath) {
  return new Promise(function (resolve, reject) {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);

    stream.on("data", function (data) { hash.update(data); });
    stream.on("end", function () { resolve(hash.digest("hex")); });
    stream.on("error", reject);
  });
}

export function verifyHash(filePath, expectedHash) {
  if (!expectedHash || expectedHash.trim() === "") {
    console.warn("  Warning: no hash provided, skipping verification.");
    return true;
  }

  const actual = hashFile(filePath);
  if (actual !== expectedHash.toLowerCase()) {
    console.error("  Hash mismatch!");
    console.error("  Expected: " + expectedHash.toLowerCase());
    console.error("  Actual:   " + actual);
    return false;
  }

  console.log("  Hash verified.");
  return true;
}
