import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import config from "./config.js";

const assets = new Map();
const jobs = new Map();
const artifacts = new Map();
const listeners = new Map();

for (const subdir of ["assets", "incoming", "artifacts"]) mkdirSync(resolve(config.dataDir, subdir), { recursive: true });

export function id(prefix) { return prefix + "_" + randomUUID().replaceAll("-", ""); }

export function putAsset({ tempPath, clientId, kind, mime, filename, width, height }) {
  const assetId = id("ast");
  const path = resolve(config.dataDir, "assets", assetId);
  renameSync(tempPath, path);
  const bytes = readFileSync(path);
  const asset = { id: assetId, clientId, kind, mime, filename, width, height, path, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), createdAt: Date.now() };
  assets.set(assetId, asset);
  return asset;
}

export function getAsset(assetId, clientId) {
  const asset = assets.get(assetId);
  return asset && (!clientId || asset.clientId === clientId) && existsSync(asset.path) ? asset : null;
}

export function putJob(payload, clientId) {
  const existing = [...jobs.values()].find(job => job.clientId === clientId && job.idempotencyKey === payload.idempotencyKey);
  if (existing) return { job: existing, existing: true };
  const now = new Date().toISOString();
  const job = { id: id("job"), clientId, correlationId: payload.correlationId || "", traceId: payload.traceId || payload.correlationId || "", idempotencyKey: payload.idempotencyKey, capabilityId: payload.capabilityId, payload, state: "queued", progress: 0, stages: [], createdAt: now, updatedAt: now, error: null };
  jobs.set(job.id, job);
  emit(job.id, "state", { state: job.state, progress: 0 });
  return { job, existing: false };
}

export function getJob(jobId, clientId) {
  const job = jobs.get(jobId);
  return job && (!clientId || job.clientId === clientId) ? job : null;
}

export function listJobs(clientId) { return [...jobs.values()].filter(job => job.clientId === clientId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }

export function updateJob(jobId, state, progress, extra = {}) {
  const job = jobs.get(jobId);
  if (!job) return null;
  Object.assign(job, extra, { state, progress, updatedAt: new Date().toISOString() });
  job.stages.push({ name: state, state: state === "failed" ? "failed" : "completed", progress, at: job.updatedAt });
  emit(jobId, "state_change", { newState: state, state, progress, message: extra.error?.message });
  return job;
}

export function putArtifact(job, bytes, metadata) {
  const artifactId = id("art");
  const path = resolve(config.dataDir, "artifacts", artifactId + ".png");
  writeFileSync(path, bytes);
  const artifact = { id: artifactId, jobId: job.id, clientId: job.clientId, role: "result", path, mimeType: "image/png", sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), width: metadata.width, height: metadata.height, placement: metadata.placement, createdAt: Date.now() };
  artifacts.set(artifactId, artifact);
  return artifact;
}

export function getArtifact(artifactId, clientId) {
  const artifact = artifacts.get(artifactId);
  return artifact && artifact.clientId === clientId && existsSync(artifact.path) ? artifact : null;
}

export function jobArtifacts(jobId) {
  return [...artifacts.values()].filter(artifact => artifact.jobId === jobId).map(artifact => ({ id: artifact.id, role: artifact.role, mimeType: artifact.mimeType, sha256: artifact.sha256, sizeBytes: artifact.sizeBytes, width: artifact.width, height: artifact.height, downloadUrl: "/v2/artifacts/" + artifact.id, placement: artifact.placement, previewOnly: false }));
}

export function subscribe(jobId, listener) {
  if (!listeners.has(jobId)) listeners.set(jobId, new Set());
  listeners.get(jobId).add(listener);
  return () => listeners.get(jobId)?.delete(listener);
}

export function emit(jobId, type, data) { for (const listener of listeners.get(jobId) || []) listener(type, data); }
export function finish(jobId) { const job = jobs.get(jobId); emit(jobId, "complete", { state: job.state, artifacts: jobArtifacts(jobId) }); }
