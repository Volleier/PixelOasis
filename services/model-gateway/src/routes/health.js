/* routes/health.js — GET /health */

import { writeJson } from "../utils/errors.js";

export function handleHealth(request, response) {
  writeJson(response, 200, {
    status: "ok",
    service: "pixeloasis-model-gateway",
    version: "0.1.0",
  });
}
