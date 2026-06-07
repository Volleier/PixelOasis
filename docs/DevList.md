# PixelOasis DevList

This document defines the full development path for PixelOasis from the current classic UXP shell to the first accepted end-to-end AI generation workflow:

1. user selects an area in Photoshop
2. plugin captures selected image and mask correctly
3. plugin sends request to a local gateway
4. gateway adapts the request to official ComfyUI
5. ComfyUI generates an image
6. plugin places the returned image as a top layer
7. plugin rebuilds a mask aligned to the original selection

The project must follow `docs/dev-guide.md`.

## 0. Confirmed Project Decisions

These decisions are confirmed and should be treated as defaults unless the user explicitly changes them later:

- ComfyUI runs locally.
- Use the official recommended ComfyUI local setup.
- First accepted workflow is `composition.inpaint.basic`.
- First version prioritizes output quality over speed.
- Output must always match the original Photoshop selection size.
- Generation is always one image at a time. Do not design batch generation for the first version.
- Settings are saved per workflow, not only globally.
- Primary model route for local image-to-image/post-production editing is `FLUX.1 Kontext Dev`.
- Fallback model route is `SDXL Inpaint` if local hardware, model availability, or ComfyUI version blocks `FLUX.1 Kontext Dev`.

Model choice rationale:

- `FLUX.1 Kontext Dev` is the preferred route for local high-quality image editing because it is designed for image input plus text-guided editing and is documented by ComfyUI as a native local workflow.
- `SDXL Inpaint` remains the fallback because masked inpainting is mature, predictable, and easier to validate when strict selection-size output is required.
- The first milestone should implement the gateway and plugin in a model-agnostic way, so switching between `FLUX.1 Kontext Dev` and `SDXL Inpaint` does not change Photoshop-side code.

## 1. Core Direction

Use this architecture:

```text
Photoshop UXP Plugin
  -> local PixelOasis model-gateway
    -> official ComfyUI HTTP/WebSocket API
      -> generated PNG result
    -> normalized PixelOasis response
  -> Photoshop layer placement + mask rebuild
```

Recommended ComfyUI access method:

- The plugin should not talk directly to ComfyUI.
- The plugin should call one stable local endpoint, for example `POST http://127.0.0.1:8787/generate`.
- The local gateway owns ComfyUI workflow transformation, model selection, file upload, queue polling, progress tracking, and result retrieval.
- ComfyUI should stay official and unmodified. Do not require custom ComfyUI nodes for the first accepted workflow.
- The default ComfyUI endpoint is `http://127.0.0.1:8188`.
- The default PixelOasis gateway endpoint is `http://127.0.0.1:8787`.

Reason:

- Photoshop UXP should stay focused on Photoshop state and UI.
- ComfyUI workflow JSON and node IDs are unstable implementation details and should not leak into the panel.
- The gateway can validate models, upload files, poll generation status, and normalize errors more reliably than a UXP panel.

## 2. Non-Negotiable Engineering Rules

- Keep the Photoshop plugin in `pixeloasis-plugin`.
- Keep the classic UXP shell stable until the full AI return-layer flow works.
- Do not reintroduce React, Vite, Bolt UXP, or Spectrum Web Components until the end-to-end Photoshop workflow is already validated.
- Keep UI styling close to Photoshop 2024+ native panels: flat dark neutral surfaces, restrained borders, no glossy gradients, no decorative layout.
- Do not treat `npm run build` as runtime proof. Always validate inside Photoshop through UXP Developer Tool.
- Do not use JPEG for formal workflow image or formal workflow mask.
- JPEG is allowed only for UI preview after transparent pixels are composited to an opaque matte.
- Formal image must preserve alpha when the selected region contains transparency.
- Formal mask must remain aligned to the formal image dimensions and original Photoshop selection bounds.
- Tool switching must use recorded `batchPlay` descriptors, not writable `app.currentTool`.
- Avoid top-level `require("photoshop")` initialization. Load Photoshop APIs inside runtime functions.

## 3. Target Directory Shape

Recommended final project shape:

```text
PixelOasis/
  docs/
    dev-guide.md
    DevList.md
    DevList-CN.md
    workflows.md
  pixeloasis-plugin/
    manifest.json
    index.html
    index.js
    panel.css
    package.json
    scripts/
      state.js
      ui-template.js
      ui-status.js
      ui-preview.js
      ui-settings.js
      ui-workflows.js
      ui-parameters.js
      photoshop-selection.js
      photoshop-place-layer.js
      photoshop-tool.js
      gateway-client.js
      actions.js
      vendor/
        png-encoder.js
    dist/
  services/
    model-gateway/
      package.json
      src/
        server.js
        config.js
        routes/
          health.js
          generate.js
          workflows.js
        adapters/
          comfyui/
            client.js
            adapter.js
            workflow-loader.js
            workflow-bindings.js
            result-reader.js
        validation/
          generate-request.js
        utils/
          base64.js
          images.js
          errors.js
      workflows/
        comfyui/
          portrait/
          composition/
          lighting/
          effects/
          quality/
```

Notes:

- `services/server.js` should be replaced by `services/model-gateway`.
- The old root `dist/` should be removed or clearly marked unused. The UDT load target must be `pixeloasis-plugin/dist/manifest.json`.
- Workflow files belong to the gateway, not the plugin.

## 4. Protocol Direction

The current protocol is defined here. Plugin to gateway:

```json
{
  "correlationId": "po-...",
  "presetId": "composition.inpaint.basic",
  "workflowId": "flux-kontext-dev-inpaint-basic",
  "selection": {
    "documentId": "123",
    "bounds": {
      "left": 100,
      "top": 120,
      "width": 512,
      "height": 512
    },
    "imagePngBase64": "BASE64_PNG_WITH_ALPHA",
    "maskPngBase64": "BASE64_GRAYSCALE_OR_ALPHA_MASK",
    "previewJpegBase64": "BASE64_JPEG_PREVIEW_OPTIONAL",
    "colorMode": "RGB",
    "resolution": 72
  },
  "parameters": {
    "prompt": "",
    "negativePrompt": "",
    "seed": -1,
    "steps": 28,
    "cfg": 7,
    "denoise": 0.75,
    "sampler": "dpmpp_2m",
    "scheduler": "karras"
  }
}
```

Gateway to plugin:

```json
{
  "correlationId": "po-...",
  "status": "succeeded",
  "result": {
    "imagePngBase64": "BASE64_RESULT_PNG",
    "mimeType": "image/png",
    "width": 512,
    "height": 512,
    "seed": 123456,
    "metadata": {
      "provider": "comfyui",
      "promptId": "..."
    }
  }
}
```

Rules:

- Rename old `imageBase64` to `imagePngBase64`.
- Rename old `maskBase64` to `maskPngBase64`.
- The response image must match the request selection image size unless the workflow explicitly declares a resize strategy.
- All errors must include `correlationId`, `code`, and `message`.

## 5. ComfyUI Integration Plan

Use official ComfyUI API behavior:

- `POST /upload/image` uploads input PNG files to ComfyUI.
- `POST /prompt` submits an API-format workflow.
- `GET /history/{prompt_id}` reads completed outputs.
- `GET /view?filename=...&subfolder=...&type=output` downloads output images.
- `WS /ws?clientId=...` listens for progress and completion.
- `GET /object_info` can be used to validate available node classes and model option values.

Recommended first implementation:

1. Upload source image PNG through `/upload/image`.
2. Upload mask PNG through `/upload/image` as a normal image file.
3. Use a workflow that loads both files with official image-loading nodes.
4. Convert the uploaded mask image to a mask inside the workflow with official nodes.
5. Submit the patched workflow to `/prompt`.
6. Track progress through WebSocket when available.
7. Fall back to polling `/history/{prompt_id}` if WebSocket fails.
8. Download the output PNG through `/view`.
9. Return the output PNG as base64 to the plugin.

Do not use custom ComfyUI extensions for the first accepted route. Custom nodes can be added later per workflow.

## 6. Workflow File Strategy

Use ComfyUI API-format workflow JSON, not the UI workflow format, for execution.

Recommended storage:

```text
services/model-gateway/workflows/comfyui/composition/flux-kontext-dev-inpaint-basic.api.json
services/model-gateway/workflows/comfyui/composition/flux-kontext-dev-inpaint-basic.meta.json
```

The `.api.json` file is the workflow submitted to ComfyUI.

The `.meta.json` file describes how PixelOasis patches it:

```json
{
  "workflowId": "flux-kontext-dev-inpaint-basic",
  "title": "FLUX.1 Kontext Dev Inpaint Basic",
  "category": "composition",
  "requiredModels": [
    {
      "type": "diffusion_model",
      "name": "flux1-dev-kontext_fp8_scaled.safetensors"
    },
    {
      "type": "vae",
      "name": "ae.safetensors"
    },
    {
      "type": "text_encoder",
      "name": "clip_l.safetensors"
    },
    {
      "type": "text_encoder",
      "name": "t5xxl_fp16.safetensors"
    }
  ],
  "bindings": {
    "sourceImage": {
      "nodeId": "12",
      "input": "image"
    },
    "maskImage": {
      "nodeId": "13",
      "input": "image"
    },
    "positivePrompt": {
      "nodeId": "6",
      "input": "text"
    },
    "negativePrompt": {
      "nodeId": "7",
      "input": "text"
    },
    "seed": {
      "nodeId": "3",
      "input": "seed"
    },
    "steps": {
      "nodeId": "3",
      "input": "steps"
    },
    "cfg": {
      "nodeId": "3",
      "input": "cfg"
    },
    "denoise": {
      "nodeId": "3",
      "input": "denoise"
    },
    "output": {
      "nodeId": "99"
    }
  },
  "defaults": {
    "steps": 28,
    "cfg": 7,
    "denoise": 0.75,
    "sampler": "dpmpp_2m",
    "scheduler": "karras"
  }
}
```

Why this format:

- API workflow node IDs stay inside the gateway.
- The plugin only knows `workflowId` and user-facing parameters.
- Multiple workflows per section become easy to add without changing plugin Photoshop logic.

Initial recommended workflow:

- Start with one `FLUX.1 Kontext Dev` image-edit workflow under `composition`.
- Use official ComfyUI nodes only.
- Use source image + mask image inputs when the workflow supports mask conditioning.
- If the selected local workflow does not consume a mask directly, apply the mask in Photoshop after placement and keep the generated image constrained to the selection-sized output.
- Return one PNG with the same dimensions as the selected region.
- Use context padding around the selection when needed, then crop the final result back to the exact selection size.

Reason:

- Inpainting is the central PixelOasis workflow.
- It validates image capture, mask export, ComfyUI execution, returned image handling, and Photoshop layer placement in one route.
- Other categories can reuse the same infrastructure.
- `FLUX.1 Kontext Dev` is the quality-first local route for post-production image editing.
- `SDXL Inpaint` remains available as the fallback if `FLUX.1 Kontext Dev` is too heavy or unavailable.

## 7. Feature Categories And Workflow Growth

Main content area categories:

- `portrait`: 人像精修
- `composition`: 构图工具
- `lighting`: 光影风格
- `effects`: 视觉特效
- `quality`: 画质提升

Each category must support multiple workflows.

Recommended first workflows:

- `portrait.skin-retouch.basic`: skin cleanup using selected region and mask
- `portrait.face-restore.basic`: face detail restoration
- `composition.inpaint.basic`: local inpaint
- `composition.object-remove.basic`: object removal
- `composition.outpaint.basic`: canvas expansion or edge extension
- `lighting.relight.basic`: localized light adjustment
- `lighting.color-grade.basic`: style and tone change
- `effects.style-transfer.basic`: visual style effect
- `effects.background-effect.basic`: selected/background effect replacement
- `quality.upscale.basic`: selected region upscale
- `quality.denoise.basic`: denoise and detail recovery

Implementation order:

1. `composition.inpaint.basic`
2. `composition.object-remove.basic`
3. `quality.upscale.basic`
4. `portrait.skin-retouch.basic`
5. `lighting.relight.basic`
6. Remaining workflows after the end-to-end route is stable

## 8. Plugin Development Phases

### Phase P0: Clean Baseline

Tasks:

- Keep only the classic UXP path.
- Remove stale references to deleted `src/` files from docs.
- Confirm `npm run build` produces `pixeloasis-plugin/dist`.
- Confirm UDT loads `pixeloasis-plugin/dist/manifest.json`.
- Confirm five main sections, fixed preview area, bottom status bar, and settings surface display correctly.

Acceptance:

- Plugin opens in Photoshop.
- All five sections are visible.
- Settings opens and closes without hiding required controls.
- Status bar updates.
- No old root `dist/` is used for UDT loading.

### Phase P1: Correct Selection Capture

Tasks:

- Read active document and active selection bounds through `batchPlay`.
- Capture selected pixels.
- Capture selection mask.
- Preserve original selection bounds.
- Ensure formal image and formal mask dimensions match.
- If `getPixels` trims transparent regions, pad the pixel buffer back to the original selection rectangle.
- Use PNG for formal image.
- Use PNG for formal mask.
- Use JPEG only for UI preview after alpha compositing.

Important correction:

- Do not rely on `imaging.encodeImageData` as the formal PNG encoder.
- Add a UXP-compatible PNG encoder for formal image and mask, or implement another verified Photoshop export route that produces real PNG bytes.
- Keep this encoder isolated under `scripts/vendor/` or a dedicated image utility module.

Acceptance:

- Selecting an opaque region produces preview JPEG, formal PNG image, and formal PNG mask.
- Selecting a region with transparent pixels does not throw JPEG alpha errors.
- Selecting a region with transparent pixels preserves transparency in formal PNG.
- Formal image and mask dimensions match the original selection width and height.
- The preview area displays the JPEG thumbnail.

### Phase P2: Parameter Page UI

Tasks:

- Clicking a workflow button opens a parameter page.
- The parameter page overlays the main section without destroying shell layout.
- The bottom bar remains stable.
- The page supports:
  - prompt
  - negative prompt
  - seed
  - random seed toggle
  - steps
  - cfg
  - denoise/strength
  - sampler
  - scheduler
  - model/workflow display
  - run button
  - cancel/back button
- Use Photoshop-like compact controls.
- Persist parameter edits per workflow.
- Do not apply one workflow's settings to another workflow unless the parameter is explicitly global, such as gateway URL.

Acceptance:

- Each workflow button can open its own parameter page.
- Parameter defaults come from workflow metadata.
- Edited parameters are passed to request assembly.
- Returning to the main section does not lose current preview capture.
- Reopening the same workflow restores its saved settings.
- Opening another workflow uses that workflow's own saved settings or defaults.

### Phase P3: Gateway Client In Plugin

Tasks:

- Add a plugin-side gateway client module.
- Read gateway URL from settings.
- Default to `http://127.0.0.1:8787`.
- Send `POST /generate`.
- Show progress state in bottom bar and parameter page.
- Handle failed gateway health check.
- Handle generation timeout.
- Keep request assembly independent from UI rendering.

Acceptance:

- Plugin can call `GET /health`.
- Plugin can send a generate request to a mock gateway.
- Plugin can receive a PNG result.
- UI shows success or structured error.

### Phase P4: Photoshop Result Placement

Tasks:

- Convert returned PNG base64 to a UXP temp file.
- Place the temp PNG as a new top layer.
- Position the layer at original selection bounds.
- Scale only if response dimensions differ and workflow declares resize.
- Rebuild a layer mask from the original selection bounds and mask.
- Name the layer with workflow title and timestamp.
- Keep the original document selection state predictable after placement.

Acceptance:

- Returned image appears as the top layer.
- Layer aligns with the original selection rectangle.
- Mask aligns to the original selection.
- Transparent and soft-edge selections remain visually correct.

## 9. Gateway Development Phases

### Phase G0: Service Skeleton

Tasks:

- Replace current placeholder service with `services/model-gateway`.
- Add `package.json`.
- Add server start script.
- Add config for ComfyUI base URL.
- Add routes:
  - `GET /health`
  - `GET /workflows`
  - `POST /generate`
- Add structured error responses.

Acceptance:

- `npm install` works inside `services/model-gateway`.
- `npm run dev` starts the service.
- `GET /health` returns JSON.

### Phase G1: Request Validation

Tasks:

- Validate request shape.
- Validate required PNG fields.
- Validate bounds.
- Validate workflowId.
- Validate parameter ranges.
- Reject JPEG as formal image or formal mask.
- Enforce payload size limits.

Acceptance:

- Invalid requests fail before touching ComfyUI.
- Errors are readable in the plugin status area.

### Phase G2: ComfyUI Client

Tasks:

- Implement ComfyUI HTTP client.
- Implement image upload.
- Implement prompt submission.
- Implement WebSocket progress listener.
- Implement history polling fallback.
- Implement output download.
- Implement timeout and cancellation strategy.

Acceptance:

- Gateway can submit a hardcoded API-format workflow.
- Gateway can retrieve the generated output PNG.
- Gateway returns normalized PixelOasis response.

### Phase G3: Workflow Registry

Tasks:

- Load workflow metadata at startup.
- Load API workflow JSON by `workflowId`.
- Patch workflow node inputs from request.
- Validate required model names through ComfyUI object info when possible.
- Return workflow list to plugin.

Acceptance:

- `GET /workflows` returns categories and workflow metadata.
- `POST /generate` can run by `workflowId`.
- Missing workflow or missing model produces clear error.

### Phase G4: First Real ComfyUI Workflow

Tasks:

- Build `composition.inpaint.basic`.
- Export API-format workflow JSON from ComfyUI.
- Add workflow metadata and node bindings.
- Test with source PNG and mask PNG.
- Ensure output PNG dimensions match input selection dimensions.
- Implement `FLUX.1 Kontext Dev` first when local hardware and ComfyUI version support it.
- Add `SDXL Inpaint` as the fallback workflow if `FLUX.1 Kontext Dev` cannot meet the first milestone quickly.

Acceptance:

- Gateway can run the inpaint workflow without Photoshop.
- A test request with local PNG and mask returns a valid PNG.
- The workflow returns exactly one output image.
- The output image dimensions match the input selection dimensions.

## 10. End-To-End Acceptance Path

The first accepted full route is:

1. Start official ComfyUI locally.
2. Start PixelOasis model-gateway.
3. Open Photoshop.
4. Load `pixeloasis-plugin/dist/manifest.json` in UXP Developer Tool.
5. Open a document.
6. Create a rectangular selection.
7. Click `composition.inpaint.basic`.
8. Open parameter page.
9. Confirm or edit parameters.
10. Run generation.
11. Plugin captures formal PNG image and PNG mask.
12. Plugin sends request to gateway.
13. Gateway uploads images to ComfyUI.
14. Gateway submits workflow.
15. Gateway retrieves output PNG.
16. Plugin places returned PNG as a top layer.
17. Plugin applies mask aligned to the original selection.

Acceptance:

- No JPEG is used for formal image or mask.
- Preview JPEG displays correctly.
- ComfyUI receives valid input image and mask.
- Generated image returns to Photoshop.
- New layer appears above existing layers.
- New layer is positioned at the original selection.
- New layer mask matches the original selection.
- Status bar shows each major state:
  - captured
  - uploading
  - queued
  - generating
  - downloading
  - placing layer
  - done

## 11. Testing Plan

Plugin tests inside Photoshop:

- No document open.
- Document open but no selection.
- Small opaque selection.
- Large opaque selection.
- Selection containing transparent pixels.
- Selection partly outside visible painted pixels.
- Soft-edged selection.
- Layer with transparency.
- Multiple documents open.
- Non-RGB document if Photoshop allows capture.

Gateway tests:

- Health check.
- Invalid JSON.
- Missing workflowId.
- Missing formal PNG image.
- Missing formal PNG mask.
- Invalid base64.
- ComfyUI offline.
- ComfyUI missing model.
- ComfyUI timeout.
- Successful mock workflow.
- Successful real workflow.

End-to-end tests:

- One inpaint workflow returns a layer.
- Repeated generation does not corrupt previous layers.
- Reloading the plugin does not lose core settings.
- Photoshop restart and UDT reload still load correct dist.

## 12. Documentation To Add Or Update

Protocol is defined in §4 of this document (plugin ↔ gateway request/response schema).

Add `docs/workflows.md` when the workflow registry grows beyond the in-memory list:

- Explain workflow metadata format.
- Explain API-format workflow export.
- Explain node binding rules.
- Explain required model declaration.

Update `docs/dev-guide.md` if a new pitfall is discovered:

- PNG encoder behavior.
- ComfyUI workflow binding mistakes.
- Photoshop placement and mask alignment pitfalls.

## 13. Recommended Build Order

Use this exact order to avoid repeating previous drift:

1. Fix documentation and protocol names.
2. Stabilize plugin shell and settings overlay behavior.
3. Implement correct PNG image/mask capture.
4. Implement result placement with a local test PNG before ComfyUI.
5. Create gateway skeleton.
6. Add mock gateway response.
7. Connect plugin to mock gateway.
8. Add ComfyUI client.
9. Add first API-format inpaint workflow.
10. Run gateway-to-ComfyUI without Photoshop.
11. Run full Photoshop-to-ComfyUI-to-Photoshop flow.
12. Add parameter pages.
13. Add more workflows per category.

## 14. Confirmed Assumptions And Remaining User Information

Confirmed:

- ComfyUI runs locally.
- Use official recommended ComfyUI local setup.
- Primary model route is `FLUX.1 Kontext Dev`.
- Fallback model route is `SDXL Inpaint`.
- First accepted feature is `composition.inpaint.basic`.
- Quality has priority over speed.
- Output must always equal the Photoshop selection dimensions.
- First version generates one result at a time.
- Workflow settings persist per workflow.

Still useful to know before model download and workflow tuning:

- GPU model and VRAM amount.
- Available disk space for models.
- Whether the machine can run `FLUX.1 Kontext Dev` comfortably.
- Whether prompts should be written in English only, or whether the plugin should later add prompt translation.

Default runtime assumptions:

- ComfyUI runs locally at `http://127.0.0.1:8188`.
- Gateway runs locally at `http://127.0.0.1:8787`.
- First workflow is `FLUX.1 Kontext Dev Inpaint Basic`.
- Fallback workflow is `SDXL Inpaint Basic`.

## 15. Definition Of Done For First Milestone

The first milestone is complete only when:

- Photoshop plugin loads through UDT.
- User can create a selection.
- User can run `composition.inpaint.basic`.
- Plugin captures PNG image and PNG mask correctly.
- Gateway submits the matching `FLUX.1 Kontext Dev` or fallback `SDXL Inpaint` workflow to official ComfyUI.
- ComfyUI returns a PNG.
- Plugin places the PNG as a new top layer.
- Plugin creates a mask aligned to the original selection.
- A transparent-pixel selection does not break preview or formal upload.
- The full route works after rebuilding and reloading `pixeloasis-plugin/dist/manifest.json`.

## 16. References

- Official ComfyUI server routes: https://docs.comfy.org/development/comfyui-server/comms_routes
- Official ComfyUI Cloud API overview, useful for route naming and file/workflow concepts: https://docs.comfy.org/api-reference/cloud/overview
- Official ComfyUI local system requirements: https://docs.comfy.org/installation/system_requirements/
- Official ComfyUI FLUX.1 Kontext Dev native workflow: https://docs.comfy.org/tutorials/flux/flux-1-kontext-dev
- Official ComfyUI inpainting workflow guide: https://docs.comfy.org/tutorials/basic/inpaint
- Official Adobe Photoshop UXP Imaging API reference, important for `getPixels` and `encodeImageData` limitations: https://developer.adobe.com/photoshop/uxp/2022/ps-reference/media/imaging/
