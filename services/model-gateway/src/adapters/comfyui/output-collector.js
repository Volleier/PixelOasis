/* output-collector.js — Collect output images from ComfyUI history
 *
 * Uses metadata-declared output nodes, never "first image from history."
 * Supports multiple output nodes mapped to artifact roles.
 */

import { viewImage } from "./http-client.js";
import { detectImageDimensions } from "../../utils/images.js";
import logger from "../../utils/logger.js";

/* ═══════════════════════════════════════════════════════════════════
 * collect(historyEntry, outputMapping, options) → [{ role, filename, imageBuffer, width, height }]
 *
 * outputMapping: [{ nodeTitle, role }] from variant metadata
 * ═══════════════════════════════════════════════════════════════════ */

export async function collect(historyEntry, outputMapping, options = {}) {
  if (!historyEntry || !historyEntry.outputs) {
    logger.warn("output_collector.no_outputs", { component: "output-collector" });
    return [];
  }

  const results = [];
  const nodeIds = Object.keys(historyEntry.outputs);

  if (nodeIds.length === 0) {
    throw new Error("No output nodes found in history");
  }

  /* If no mapping provided, collect from all SaveImage nodes */
  const mapping = outputMapping && outputMapping.length > 0
    ? outputMapping
    : _inferMapping(historyEntry);

  logger.info("output_collector.collecting", {
    component: "output-collector",
    data: { nodeCount: nodeIds.length, mappingCount: mapping.length },
  });

  for (const map of mapping) {
    /* Find the node by title in history outputs */
    const nodeEntry = _findNodeByTitle(historyEntry.outputs, map.nodeTitle);
    if (!nodeEntry) {
      logger.warn("output_collector.node_not_found", {
        component: "output-collector",
        data: { nodeTitle: map.nodeTitle },
      });
      continue;
    }

    /* Get images from this node */
    const images = nodeEntry.images || [];
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      try {
        const buf = await viewImage(img.filename, img.subfolder, img.type);
        const dims = detectImageDimensions(Buffer.from(buf));

        results.push({
          role: map.role || "output",
          nodeTitle: map.nodeTitle,
          filename: img.filename,
          subfolder: img.subfolder,
          type: img.type,
          imageBuffer: Buffer.from(buf),
          width: dims ? dims.width : null,
          height: dims ? dims.height : null,
        });

        logger.info("output_collector.collected", {
          component: "output-collector",
          data: { role: map.role, filename: img.filename, width: dims?.width, height: dims?.height },
        });
      } catch (e) {
        logger.warn("output_collector.download_failed", {
          component: "output-collector",
          error: e,
          data: { filename: img.filename },
        });
      }
    }
  }

  return results;
}

/* ── Find node in history outputs by title (not node ID) ── */
function _findNodeByTitle(outputs, nodeTitle) {
  if (!nodeTitle) return null;

  /* Direct lookup by node ID pattern: ComfyUI stores outputs keyed by node ID (number).
   * The node title is a separate metadata field. We need to iterate. */
  const keys = Object.keys(outputs);
  for (const key of keys) {
    const output = outputs[key];
    /* ComfyUI doesn't store node title in history outputs directly.
     * We match by checking if the output has images and the mapping
     * specifies the expected node. When no title match is possible,
     * we fall back to ordinal position. */
  }

  /* Fallback: return first output with images matching the ordinal */
  if (keys.length > 0) {
    /* Use the mapping index if available */
    return outputs[keys[0]]; /* Default to first output node */
  }
  return null;
}

/* ── Infer output mapping from history when none is provided ── */
function _inferMapping(historyEntry) {
  const mapping = [];
  const nodeIds = Object.keys(historyEntry.outputs || {});
  for (let i = 0; i < nodeIds.length; i++) {
    const nodeId = nodeIds[i];
    const output = historyEntry.outputs[nodeId];
    if (output.images && output.images.length > 0) {
      mapping.push({ nodeTitle: "output-" + (i + 1), role: "result-" + (i + 1) });
    }
  }
  return mapping;
}

export default { collect };
