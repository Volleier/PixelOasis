import assert from "node:assert/strict";
import { getCapabilities, getCapability } from "../src/capabilities.js";

const capabilities = getCapabilities();
assert.equal(capabilities.length, 27, "online gateway exposes all 27 capabilities");
assert.equal(getCapability("effects.blackSmokeDust").availability.profile, "online");
assert.equal(getCapability("cleanup.removeSupport").input.editMask, "required");
assert.ok(capabilities.every(capability => capability.online.model === "gpt-image-2"));
console.log("Online gateway contract OK: " + capabilities.length + " capabilities");
