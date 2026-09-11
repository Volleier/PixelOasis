import assert from "node:assert/strict";
import { getCapabilities, getCapability } from "../src/capabilities.js";

import config from "../src/config.js";

const capabilities = getCapabilities();
assert.equal(capabilities.length, 27, "online gateway exposes all 27 capabilities");
assert.equal(getCapability("effects.blackSmokeDust").availability.profile, "online");
assert.equal(getCapability("cleanup.removeSupport").input.editMask, "required");
assert.ok(capabilities.every(capability => capability.online.provider === "online" && capability.online.model === config.upstream.model));
assert.deepEqual(config.upstream.supportedModels, [
  "gpt-image-2",
  "gpt-image-2-vip",
  "nano-banana-2",
  "nano-banana-2-lite",
  "nano-banana-pro",
]);
console.log("Online gateway contract OK: " + capabilities.length + " capabilities and " + config.upstream.supportedModels.length + " models");



