/* adapters/echo/adapter.js — Echo adapter (returns the input image unchanged)
 *
 * Used for end-to-end testing: the plugin sends an image, the echo adapter
 * returns it.  This validates the full request → response pipeline without
 * requiring ComfyUI.
 */

export default {
  id: "echo",

  async execute(request) {
    var selection = request.selection;
    var image = selection.imagePngBase64 || selection.imageBase64 || "";

    if (!image) {
      throw new Error("Missing selection image (imagePngBase64 or imageBase64).");
    }

    /* Derive dimensions from the payload if possible, fall back to bounds */
    var width = 512;
    var height = 512;
    if (selection.bounds && typeof selection.bounds.width === "number") {
      width = selection.bounds.width;
      height = selection.bounds.height;
    }

    return {
      correlationId: request.correlationId,
      status: "succeeded",
      result: {
        imagePngBase64: image,
        mimeType: "image/png",
        width: width,
        height: height,
        seed: request.parameters && request.parameters.seed ? request.parameters.seed : -1,
        metadata: {
          provider: "echo",
          workflowId: request.workflowId || "",
        },
      },
    };
  },
};
