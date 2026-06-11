/* adapters/comfyui/workflow-bindings.js — Patch API workflow from request data
 *
 * DevList §9 — Phase G3: Workflow Registry And Metadata.
 *
 * Given a resolved workflow variant and a validated PixelOasis request,
 * deep-clones the API workflow JSON and applies:
 *   - uploaded image / mask filenames → LoadImage node inputs
 *   - prompt, negative prompt → text node inputs
 *   - seed, steps, cfg, denoise → sampler node inputs
 *   - sampler, scheduler name → sampler/scheduler node inputs
 *
 * Every binding is validated against the actual node definition in the
 * workflow before patching — missing node IDs or input names throw early
 * with a clear WORKFLOW_BINDING_ERROR.
 */

/* ═══════════════════════════════════════════════════════════════════════
 * Deep clone (JSON round-trip — safe for workflow objects)
 * ═══════════════════════════════════════════════════════════════════════ */

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/* ═══════════════════════════════════════════════════════════════════════
 * Binding errors
 * ═══════════════════════════════════════════════════════════════════════ */

export class WorkflowBindingError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "WorkflowBindingError";
    this.details = details || {};
  }
}

/* ═══════════════════════════════════════════════════════════════════════
 * Node existence & input validation
 * ═══════════════════════════════════════════════════════════════════════ */

function requireNode(workflow, nodeId, bindingName) {
  if (!workflow[nodeId]) {
    throw new WorkflowBindingError(
      "Node '" + nodeId + "' not found in workflow (binding: " + bindingName + ").",
      { nodeId: nodeId, binding: bindingName },
    );
  }
  var node = workflow[nodeId];
  if (!node.inputs || typeof node.inputs !== "object") {
    throw new WorkflowBindingError(
      "Node '" + nodeId + "' has no inputs object (binding: " + bindingName + ").",
      { nodeId: nodeId, binding: bindingName },
    );
  }
  return node;
}

function requireInput(node, nodeId, inputName, bindingName) {
  if (!(inputName in node.inputs)) {
    throw new WorkflowBindingError(
      "Node '" + nodeId + "' has no input '" + inputName + "' (binding: " + bindingName + "). " +
      "Available inputs: " + Object.keys(node.inputs).join(", ") + ".",
      { nodeId: nodeId, input: inputName, binding: bindingName },
    );
  }
}

/* ═══════════════════════════════════════════════════════════════════════
 * Patch helpers
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Patch an image filename into a LoadImage-type node.
 *
 * @param {object} workflow    the API workflow (mutated in place)
 * @param {string} nodeId      e.g. "10"
 * @param {string} inputName   e.g. "image"
 * @param {string} filename    the uploaded filename in ComfyUI's input dir
 * @param {string} bindingName for error messages
 */
function patchImageFilename(workflow, nodeId, inputName, filename, bindingName) {
  var node = requireNode(workflow, nodeId, bindingName);
  requireInput(node, nodeId, inputName, bindingName);

  node.inputs[inputName] = filename;
}

/**
 * Patch a string value into a node input (prompt, negative prompt, sampler name, scheduler name).
 */
function patchString(workflow, nodeId, inputName, value, bindingName) {
  var node = requireNode(workflow, nodeId, bindingName);
  requireInput(node, nodeId, inputName, bindingName);

  node.inputs[inputName] = value;
}

/**
 * Patch a numeric value into a node input (seed, steps, cfg, denoise).
 */
function patchNumber(workflow, nodeId, inputName, value, bindingName) {
  var node = requireNode(workflow, nodeId, bindingName);
  requireInput(node, nodeId, inputName, bindingName);

  node.inputs[inputName] = value;
}

/**
 * Patch the sampler/scheduler name.  Some workflows use separate nodes for
 * sampler selection (e.g. KSamplerSelect), others embed them in the main
 * sampler node.  We try both patterns.
 *
 * @param {object} workflow
 * @param {object} inputs   the variant's inputs metadata
 * @param {object} parameters  from the request (may contain sampler, scheduler)
 */
function patchSamplerScheduler(workflow, inputs, parameters) {
  /* If the metadata explicitly declares sampler/scheduler bindings, use them. */
  if (inputs.sampler && parameters.sampler !== undefined) {
    patchString(
      workflow,
      inputs.sampler.nodeId,
      inputs.sampler.input,
      parameters.sampler,
      "sampler",
    );
  }

  if (inputs.scheduler && parameters.scheduler !== undefined) {
    patchString(
      workflow,
      inputs.scheduler.nodeId,
      inputs.scheduler.input,
      parameters.scheduler,
      "scheduler",
    );
  }
}

/* ═══════════════════════════════════════════════════════════════════════
 * Main entry point
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Patch an API workflow with values from a PixelOasis request.
 *
 * @param {object} variant      resolved workflow variant (with .inputs metadata)
 * @param {object} request      validated PixelOasis generate request
 * @param {object} uploadRefs   { sourceImageFilename, maskImageFilename }
 * @returns {object}            patched API-format workflow ready for /prompt
 */
export function patchWorkflow(variant, request, uploadRefs) {
  var inputs = variant.inputs;
  var parameters = request.parameters || {};
  var selection = request.selection;

  /* Deep clone the API workflow so we never mutate the original */
  var workflow = deepClone(variant.apiWorkflow);

  /* ── Source image ── */
  if (inputs.sourceImage && uploadRefs && uploadRefs.sourceImageFilename) {
    patchImageFilename(
      workflow,
      inputs.sourceImage.nodeId,
      inputs.sourceImage.input,
      uploadRefs.sourceImageFilename,
      "sourceImage",
    );
  }

  /* ── Mask image (optional — not all workflows use masks) ── */
  if (inputs.maskImage && uploadRefs && uploadRefs.maskImageFilename) {
    patchImageFilename(
      workflow,
      inputs.maskImage.nodeId,
      inputs.maskImage.input,
      uploadRefs.maskImageFilename,
      "maskImage",
    );
  }

  /* ── Positive prompt ── */
  if (inputs.positivePrompt && parameters.prompt !== undefined) {
    patchString(
      workflow,
      inputs.positivePrompt.nodeId,
      inputs.positivePrompt.input,
      parameters.prompt,
      "positivePrompt",
    );
  }

  /* ── Negative prompt ── */
  if (inputs.negativePrompt && parameters.negativePrompt !== undefined) {
    patchString(
      workflow,
      inputs.negativePrompt.nodeId,
      inputs.negativePrompt.input,
      parameters.negativePrompt,
      "negativePrompt",
    );
  }

  /* ── Seed ── */
  if (inputs.seed && parameters.seed !== undefined) {
    patchNumber(
      workflow,
      inputs.seed.nodeId,
      inputs.seed.input,
      parameters.seed,
      "seed",
    );
  }

  /* ── Steps ── */
  if (inputs.steps && parameters.steps !== undefined) {
    patchNumber(
      workflow,
      inputs.steps.nodeId,
      inputs.steps.input,
      parameters.steps,
      "steps",
    );
  }

  /* ── CFG ── */
  if (inputs.cfg && parameters.cfg !== undefined) {
    patchNumber(
      workflow,
      inputs.cfg.nodeId,
      inputs.cfg.input,
      parameters.cfg,
      "cfg",
    );
  }

  /* ── Denoise ── */
  if (inputs.denoise && parameters.denoise !== undefined) {
    patchNumber(
      workflow,
      inputs.denoise.nodeId,
      inputs.denoise.input,
      parameters.denoise,
      "denoise",
    );
  }

  /* ── Sampler / Scheduler ── */
  patchSamplerScheduler(workflow, inputs, parameters);

  return workflow;
}

/**
 * Validate that all configured bindings point to real nodes in the workflow.
 * Call this during load or before first use to catch configuration errors.
 *
 * @param {object} variant  a workflow variant with .inputs and .apiWorkflow
 * @returns {object}  { valid: boolean, errors: string[] }
 */
export function validateBindings(variant) {
  var errors = [];
  var workflow = variant.apiWorkflow;
  var inputs = variant.inputs;
  var outputs = variant.outputs;

  if (!workflow) {
    errors.push("No API workflow loaded.");
    return { valid: false, errors: errors };
  }

  /* Check each input binding */
  var inputKeys = Object.keys(inputs);
  for (var i = 0; i < inputKeys.length; i++) {
    var key = inputKeys[i];
    var binding = inputs[key];

    if (!workflow[binding.nodeId]) {
      errors.push(
        "inputs." + key + ": node '" + binding.nodeId + "' not found in workflow."
      );
    } else if (!(binding.input in workflow[binding.nodeId].inputs)) {
      errors.push(
        "inputs." + key + ": input '" + binding.input +
        "' not found on node '" + binding.nodeId + "'."
      );
    }
  }

  /* Check output node */
  if (outputs && outputs.images && outputs.images.nodeId) {
    if (!workflow[outputs.images.nodeId]) {
      errors.push(
        "outputs.images: node '" + outputs.images.nodeId + "' not found in workflow."
      );
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors: errors };
  }

  return { valid: true, errors: [] };
}
