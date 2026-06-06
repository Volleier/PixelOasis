/* DEPRECATED — replaced by services/model-gateway/ (G0 milestone).
 * This file is kept for reference only.  Use `npm run dev` inside
 * services/model-gateway/ to start the current gateway. */

import { createServer } from "node:http";

const registry = {
  echo: {
    async execute(request) {
      const imagePngBase64 =
        request.selection?.imagePngBase64 ||
        request.selection?.imageBase64 ||
        "";

      if (!imagePngBase64) {
        throw new Error("Missing selection.imagePngBase64.");
      }

      return {
        correlationId: request.correlationId,
        status: "succeeded",
        result: {
          imagePngBase64,
          mimeType: "image/png",
          metadata: {
            echoed: true,
            provider: "echo",
          },
        },
      };
    },
  },
};

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const payload = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(payload);
}

function writeJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload, null, 2));
}

function resolveAdapter(request) {
  const provider = request.adapter?.provider || "echo";
  const adapter = registry[provider];
  if (!adapter) {
    throw new Error(`No adapter registered for provider "${provider}".`);
  }
  return adapter;
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/health") {
      writeJson(response, 200, {
        status: "ok",
        service: "model-gateway",
      });
      return;
    }

    if (request.method === "POST" && request.url === "/generate") {
      const body = await readJson(request);
      const adapter = resolveAdapter(body);
      const result = await adapter.execute(body);
      writeJson(response, 200, result);
      return;
    }

    writeJson(response, 404, {
      error: "Not found",
    });
  } catch (error) {
    writeJson(response, 500, {
      error: error instanceof Error ? error.message : "Unexpected error",
    });
  }
});

server.listen(8787, "127.0.0.1", () => {
  console.log("PixelOasis model gateway listening at http://127.0.0.1:8787");
});
