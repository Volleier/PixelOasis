import { createServer } from "node:http";
import { createWriteStream, mkdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import Busboy from "busboy";
import sharp from "sharp";
import config from "./config.js";
import { getCapabilities, getCapability } from "./capabilities.js";
import { emit, finish, getArtifact, getAsset, getJob, id, jobArtifacts, listJobs, putArtifact, putAsset, putJob, subscribe, updateJob } from "./store.js";
import { generateOnline, getUsage } from "./provider.js";

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, X-Client-Id, X-Trace-Id, X-Correlation-Id", "Access-Control-Allow-Methods": "GET,POST,HEAD,DELETE,OPTIONS" });
  res.end(JSON.stringify(data));
}

function clientId(req, url) { return req.headers["x-client-id"] || url.searchParams.get("clientId") || "default"; }

async function bodyJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 1024 * 1024) throw new Error("Request body too large"); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function upload(req, res, owner) {
  const busboy = Busboy({ headers: req.headers, limits: { fileSize: config.maxUploadBytes, files: 1 } });
  const fields = {};
  let fileInfo = null;
  const done = new Promise((resolveDone, reject) => {
    busboy.on("field", (name, value) => { fields[name] = value; });
    busboy.on("file", (name, stream, info) => {
      const tempPath = resolve(config.dataDir, "incoming", id("upload"));
      const writer = createWriteStream(tempPath);
      stream.pipe(writer);
      stream.on("limit", () => reject(new Error("File too large")));
      writer.on("close", () => { fileInfo = { tempPath, filename: info.filename, mime: info.mimeType }; });
      writer.on("error", reject);
    });
    busboy.on("close", resolveDone);
    busboy.on("error", reject);
  });
  req.pipe(busboy);
  await done;
  if (!fileInfo) return json(res, 400, { error: { code: "UPLOAD_FAILED", message: "Image file is required" } });
  const metadata = await sharp(fileInfo.tempPath).metadata();
  const asset = putAsset({ ...fileInfo, clientId: owner, kind: fields.kind || "source", width: metadata.width, height: metadata.height });
  json(res, 201, { assetId: asset.id, sha256: asset.sha256, sizeBytes: asset.sizeBytes, mime: asset.mime, expiresAt: new Date(Date.now() + config.artifactTtlMs).toISOString() });
}

function publicJob(job) {
  return { jobId: job.id, correlationId: job.correlationId, capabilityId: job.capabilityId, state: job.state, progress: job.progress, stages: job.stages, artifacts: jobArtifacts(job.id), error: job.error, createdAt: job.createdAt, updatedAt: job.updatedAt };
}

async function run(job, capability) {
  try {
    updateJob(job.id, "preparing", 10);
    const source = getAsset(job.payload.source.assetId, job.clientId);
    const maskId = job.payload.inputs?.editMaskAssetId || job.payload.inputs?.subjectMaskAssetId;
    const mask = maskId ? getAsset(maskId, job.clientId) : null;
    if (!source) throw Object.assign(new Error("Source asset is unavailable"), { code: "ASSET_NOT_FOUND" });
    updateJob(job.id, "running", 35);
    const width = Math.max(1, Math.round(job.payload.source.bounds?.width || source.width || 1024));
    const height = Math.max(1, Math.round(job.payload.source.bounds?.height || source.height || 1024));
    const bytes = await generateOnline({ capability, source, mask, parameters: job.payload.parameters, width, height });
    if (getJob(job.id, job.clientId)?.state === "canceled") return;
    updateJob(job.id, "postprocessing", 90);
    const artDef = capability.outputSchema?.artifacts?.find(item => item.previewOnly !== true) || { layerName: capability.title, blendMode: "normal", opacity: 100 };
    putArtifact(job, bytes, { width, height, placement: { layerName: artDef.layerName || capability.title, groupName: "PixelOasis/" + capability.title, blendMode: artDef.blendMode || "normal", opacity: artDef.opacity || 100, bounds: job.payload.source.bounds || null, createSmartObject: true, order: 10 } });
    updateJob(job.id, "succeeded", 100);
  } catch (error) {
    updateJob(job.id, "failed", 0, { error: { code: error.code || "ONLINE_GENERATION_FAILED", message: error.message, retryable: error.status === 429 || error.status >= 500 } });
  } finally { finish(job.id); }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const owner = clientId(req, url);
  if (req.method === "OPTIONS") return json(res, 204, null);
  try {
    if (req.method === "GET" && url.pathname === "/v2/health") {
      let usage = null;
      if (url.searchParams.get("depth") === "full") try { usage = await getUsage(); } catch (error) { usage = { configured: true, valid: false, error: error.code || error.message }; }
      return json(res, 200, { status: "ok", gateway: "ok", mode: "online", provider: "feifeimiao", model: config.upstream.model, upstream: config.upstream.apiKey ? (usage?.valid === false ? "error" : "configured") : "not_configured", usage, timestamp: new Date().toISOString() });
    }
    if (req.method === "GET" && url.pathname === "/v2/usage") return json(res, 200, await getUsage());
    if (req.method === "GET" && url.pathname === "/v2/capabilities") return json(res, 200, { schemaVersion: "2.0", revision: "online-gpt-image-2", capabilities: getCapabilities() });
    const capabilityMatch = url.pathname.match(/^\/v2\/capabilities\/([^/]+)$/);
    if (req.method === "GET" && capabilityMatch) { const capability = getCapability(decodeURIComponent(capabilityMatch[1])); return capability ? json(res, 200, capability) : json(res, 404, { error: { code: "CAPABILITY_NOT_FOUND", message: "Capability not found" } }); }
    if (req.method === "POST" && url.pathname === "/v2/assets") return await upload(req, res, owner);
    const assetMatch = url.pathname.match(/^\/v2\/assets\/([^/]+)$/);
    if (req.method === "HEAD" && assetMatch) { const asset = getAsset(assetMatch[1], owner); res.statusCode = asset ? 200 : 404; if (asset) { res.setHeader("Content-Type", asset.mime); res.setHeader("Content-Length", asset.sizeBytes); } return res.end(); }
    if (req.method === "POST" && url.pathname === "/v2/jobs") {
      const payload = await bodyJson(req);
      const capability = getCapability(payload.capabilityId);
      if (!capability) return json(res, 404, { error: { code: "CAPABILITY_NOT_FOUND", message: "Capability not found" } });
      if (!payload.source?.assetId) return json(res, 400, { error: { code: "REQUEST_SCHEMA_INVALID", message: "source.assetId is required" } });
      if (!getAsset(payload.source.assetId, owner)) return json(res, 422, { error: { code: "ASSET_NOT_FOUND", message: "Source asset not found" } });
      const created = putJob(payload, owner);
      if (!created.existing) setTimeout(() => run(created.job, capability), 0);
      return json(res, created.existing ? 200 : 202, publicJob(created.job));
    }
    if (req.method === "GET" && url.pathname === "/v2/jobs") return json(res, 200, listJobs(owner).map(publicJob));
    const eventMatch = url.pathname.match(/^\/v2\/jobs\/([^/]+)\/events$/);
    if (req.method === "GET" && eventMatch) {
      const job = getJob(eventMatch[1], owner); if (!job) return json(res, 404, { error: { code: "JOB_NOT_FOUND", message: "Job not found" } });
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "Access-Control-Allow-Origin": "*" });
      const send = (type, data) => res.write("event: " + type + "\ndata: " + JSON.stringify(data) + "\n\n");
      send("state", { state: job.state, progress: job.progress });
      const unsubscribe = subscribe(job.id, send); const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15000);
      req.on("close", () => { unsubscribe(); clearInterval(heartbeat); }); return;
    }
    const clientEventMatch = url.pathname.match(/^\/v2\/jobs\/([^/]+)\/client-events$/);
    if (req.method === "POST" && clientEventMatch) { const job = getJob(clientEventMatch[1], owner); if (!job) return json(res, 404, { error: { code: "JOB_NOT_FOUND", message: "Job not found" } }); const event = await bodyJson(req); emit(job.id, event.event || "client_event", event.data || {}); return json(res, 201, { acknowledged: true, event: event.event }); }
    const retryMatch = url.pathname.match(/^\/v2\/jobs\/([^/]+)\/retry$/);
    if (req.method === "POST" && retryMatch) return json(res, 409, { error: { code: "RETRY_REQUIRES_RESUBMIT", message: "Retry requires submitting source assets again" } });
    const jobMatch = url.pathname.match(/^\/v2\/jobs\/([^/]+)$/);
    if (jobMatch) {
      const job = getJob(jobMatch[1], owner); if (!job) return json(res, 404, { error: { code: "JOB_NOT_FOUND", message: "Job not found" } });
      if (req.method === "GET") return json(res, 200, publicJob(job));
      if (req.method === "DELETE") { if (["succeeded", "failed", "canceled"].includes(job.state)) return json(res, 409, { error: { code: "JOB_ALREADY_TERMINAL", message: "Job already terminal" } }); updateJob(job.id, "canceled", 0); finish(job.id); return json(res, 200, { jobId: job.id, state: "canceled" }); }
    }
    const artifactMatch = url.pathname.match(/^\/v2\/artifacts\/([^/]+)$/);
    if (req.method === "GET" && artifactMatch) { const artifact = getArtifact(artifactMatch[1], owner); if (!artifact) return json(res, 404, { error: { code: "ARTIFACT_NOT_FOUND", message: "Artifact not found" } }); const stats = statSync(artifact.path); res.writeHead(200, { "Content-Type": artifact.mimeType, "Content-Length": stats.size, ETag: '"' + artifact.sha256 + '"', "Access-Control-Allow-Origin": "*" }); return (await import("node:fs")).createReadStream(artifact.path).pipe(res); }
    json(res, 404, { error: { code: "NOT_FOUND", message: "Endpoint not found" } });
  } catch (error) { json(res, error.status || 500, { error: { code: error.code || "INTERNAL_ERROR", message: error.message, retryable: true } }); }
});

server.listen(config.port, config.host, () => console.log("PixelOasis online gateway listening at http://" + config.host + ":" + config.port));

export { server };
