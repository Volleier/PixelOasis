/* pipelines/registry.js — Pipeline definition registry
 *
 * Stage 5: registers named pipeline definitions (ordered stages).
 * Each stage declares a runner type + config.
 */

const _definitions = {};

export function definePipeline(name, stages) {
  if (_definitions[name]) {
    throw new Error("Duplicate pipeline definition: " + name);
  }
  _definitions[name] = { name, stages };
}

export function getPipeline(name) {
  return _definitions[name] || null;
}

export function listPipelines() {
  return Object.keys(_definitions);
}

export default { definePipeline, getPipeline, listPipelines };
