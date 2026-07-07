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
- The ComfyUI endpoint depends on the local distribution: ComfyUI Desktop is currently `http://127.0.0.1:8000` on this machine, while manual/portable ComfyUI commonly uses `http://127.0.0.1:8188`.
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

Gateway development can continue now. The current repository already has the service skeleton, request validation, an echo adapter, and plugin-side gateway calls. The remaining work is the real ComfyUI path: discover the local ComfyUI endpoint, build/import an executable workflow, register that workflow in the gateway, and run it without Photoshop before attempting the full UXP route.

Important runtime note for ComfyUI Desktop:

- ComfyUI Desktop manages and launches a local ComfyUI instance. In the current local environment it listens at `http://127.0.0.1:8000`, not `http://127.0.0.1:8188`.
- Manual/portable ComfyUI commonly uses `http://127.0.0.1:8188`.
- The gateway must support `COMFYUI_URL` and should later auto-detect candidates in this order: explicit env var, `http://127.0.0.1:8000`, then `http://127.0.0.1:8188`.
- The Photoshop plugin gateway URL remains `http://127.0.0.1:8787`. Do not point the plugin directly at ComfyUI.

### Phase G0: Gateway Runtime Hardening

Current status: mostly implemented. Harden it before adding the real adapter.

Implementation details:

- Keep `services/model-gateway` as the only gateway service.
- Keep routes:
  - `GET /health`
  - `GET /workflows`
  - `POST /generate`
- Add explicit ComfyUI upstream configuration:
  - `COMFYUI_URL=http://127.0.0.1:8000` for ComfyUI Desktop on this machine.
  - fallback candidates for manual/portable ComfyUI.
- Extend `GET /health` so it can optionally report upstream ComfyUI status:
  - gateway process status
  - configured ComfyUI base URL
  - result of `GET /system_stats`
  - result of `GET /object_info` only when a deeper check is requested
- Keep structured errors shaped for the plugin:
  - `correlationId`
  - `error.code`
  - `error.message`
  - optional `error.details` for developer diagnostics
- Keep the echo adapter available for Photoshop-side testing and make the active provider explicit in config:
  - `PO_MODEL_PROVIDER=echo`
  - `PO_MODEL_PROVIDER=comfyui`

Acceptance:

- `npm run dev` starts the gateway on `127.0.0.1:8787`.
- `GET /health` works when ComfyUI is offline.
- `GET /health?upstream=1` reports a clear offline/online status for ComfyUI.
- With ComfyUI Desktop running, the gateway can reach `http://127.0.0.1:8000/system_stats`.
- Existing echo generation still works after the config changes.

### Phase G1: Request Validation Completion

Current status: partially implemented. Complete it before forwarding any request to ComfyUI.

Implementation details:

- Validate the public plugin request shape:
  - `correlationId`
  - `workflowId`
  - `selection.bounds`
  - `selection.imagePngBase64`
  - `selection.maskPngBase64`
  - `parameters`
- Treat `workflowId` as the public PixelOasis workflow ID, for example `composition.inpaint.basic`.
- Do not expose the ComfyUI API workflow filename or node IDs to the plugin.
- Support an internal workflow variant in metadata, for example:
  - public `workflowId`: `composition.inpaint.basic`
  - internal `variantId`: `sdxl-inpaint-basic`
  - internal API file: `sdxl-inpaint-basic.api.json`
- Validate formal image and mask as PNG only.
- Reject JPEG for formal image/mask even if a preview JPEG exists.
- Validate bounds:
  - positive width and height
  - finite numeric left/top
  - max pixel count
  - max payload bytes
- Validate parameter ranges:
  - `steps` 1-100
  - `cfg` 1-30
  - `denoise` 0-1
  - `seed` finite number or `-1`
  - `sampler` and `scheduler` from allowed lists or workflow metadata
- Normalize optional fields before adapter execution:
  - missing prompt -> `""`
  - missing negative prompt -> `""`
  - seed `-1` -> gateway-generated integer seed

Acceptance:

- Invalid requests fail before touching ComfyUI.
- Validation errors are readable in the plugin status area.
- The same validation path works for both echo and ComfyUI providers.
- Public workflow IDs and internal ComfyUI workflow variants are not conflated.

### Phase G2: ComfyUI Client

Implement the low-level ComfyUI client before building the workflow registry. Keep this module independent of PixelOasis request details.

Target file:

```text
services/model-gateway/src/adapters/comfyui/client.js
```

Client functions:

- `getSystemStats()`: calls `GET /system_stats`.
- `getObjectInfo()`: calls `GET /object_info`.
- `getQueue()`: calls `GET /queue`.
- `uploadImage({ bytes, filename, overwrite })`: posts `multipart/form-data` to `/upload/image`.
- `submitPrompt({ workflow, clientId })`: posts `{ prompt, client_id }` to `/prompt`.
- `getHistory(promptId)`: calls `GET /history/{prompt_id}`.
- `downloadView({ filename, subfolder, type })`: calls `GET /view?...` and returns PNG bytes.
- `waitForPrompt(promptId, options)`: polls history until output is available, timeout is reached, or an error appears.
- Optional later: `connectWebSocket(clientId)` for `/ws?clientId=...` progress events.

Implementation rules:

- Use Node 18+ built-in `fetch`, `FormData`, `Blob`, and `AbortController` where possible.
- Keep timeouts explicit:
  - health/object info: 5-10 seconds
  - upload: 30 seconds
  - generation: configurable, default 10 minutes for local models
- On `/prompt` validation errors, preserve ComfyUI `error` and `node_errors` in `error.details`.
- WebSocket progress is useful but not required for the first real milestone; polling `/history/{prompt_id}` is acceptable as the first reliable path.
- Do not depend on custom ComfyUI nodes in the first route.

Acceptance:

- A local script or temporary route can call `getSystemStats()` against ComfyUI Desktop at `8000`.
- The client can upload a PNG and receive a ComfyUI upload response.
- The client can submit a small known API-format workflow and receive a `prompt_id`.
- The client can poll history and download the final output image.
- Errors distinguish ComfyUI offline, workflow validation failure, timeout, and missing output.

### Phase G3: Workflow Registry And Metadata

Create a file-backed registry. Workflow files belong to the gateway, not the plugin.

Directory shape:

```text
services/model-gateway/workflows/comfyui/
  composition/
    sdxl-inpaint-basic.api.json
    sdxl-inpaint-basic.meta.json
    flux-kontext-dev-inpaint-basic.api.json
    flux-kontext-dev-inpaint-basic.meta.json
```

Metadata schema:

```json
{
  "workflowId": "composition.inpaint.basic",
  "variantId": "sdxl-inpaint-basic",
  "title": "SDXL Inpaint Basic",
  "category": "composition",
  "provider": "comfyui",
  "apiWorkflowFile": "sdxl-inpaint-basic.api.json",
  "enabled": true,
  "priority": 20,
  "requiredModels": [
    {
      "folder": "checkpoints",
      "name": "sd_xl_base_1.0.safetensors"
    }
  ],
  "inputs": {
    "sourceImage": {
      "nodeId": "10",
      "input": "image"
    },
    "maskImage": {
      "nodeId": "11",
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
    }
  },
  "outputs": {
    "images": {
      "nodeId": "99"
    }
  },
  "defaults": {
    "prompt": "",
    "negativePrompt": "",
    "seed": -1,
    "steps": 28,
    "cfg": 7,
    "denoise": 0.75,
    "sampler": "dpmpp_2m",
    "scheduler": "karras"
  },
  "sizePolicy": {
    "mode": "matchSelection",
    "allowResize": false
  }
}
```

Implementation details:

- Add `workflow-loader.js`:
  - recursively finds `*.meta.json`
  - validates metadata shape
  - loads matching `.api.json`
  - indexes by public `workflowId`
  - supports choosing the best enabled variant by priority
- Add `workflow-bindings.js`:
  - deep-clones the API workflow
  - patches uploaded image filenames into `LoadImage`-style nodes
  - patches prompt, negative prompt, seed, steps, cfg, denoise, sampler, scheduler
  - validates that each configured node ID and input exists before submit
- Add model validation:
  - use `/models` and `/models/{folder}` when available
  - use `/object_info` as a fallback for node class availability
  - fail early with `MISSING_MODEL` when required model files are absent
- Update `GET /workflows`:
  - returns public workflows and selected variant metadata
  - omits internal node IDs from plugin-facing response unless debug mode is enabled

Acceptance:

- `GET /workflows` returns file-backed workflow metadata.
- Missing `.api.json`, invalid `.meta.json`, and broken bindings produce startup or request-time errors with clear messages.
- `POST /generate` can resolve `composition.inpaint.basic` to one ComfyUI API workflow variant.
- The plugin does not need to know whether the selected variant is FLUX or SDXL.

### Phase G4: Create And Import The First ComfyUI Workflow

Because the current ComfyUI Desktop install has no PixelOasis workflow configured, build the workflow in ComfyUI first, then export and register it.

Recommended practical order:

1. Build `SDXL Inpaint Basic` first as the fallback milestone workflow.
2. Build `FLUX.1 Kontext Dev Inpaint Basic` after the SDXL route proves the gateway path.
3. Keep both variants behind the same public PixelOasis workflow: `composition.inpaint.basic`.

Why SDXL first:

- It uses a mature inpainting path.
- It is easier to validate mask alignment and exact output dimensions.
- It reduces the number of moving parts while developing the gateway.
- It gives PixelOasis an end-to-end fallback even if FLUX is too heavy locally.

ComfyUI Desktop workflow authoring steps:

1. Start ComfyUI Desktop and confirm the API base:
   - open `http://127.0.0.1:8000/`
   - check `http://127.0.0.1:8000/system_stats`
   - check `http://127.0.0.1:8000/object_info`
2. Install or confirm required models in the ComfyUI model folders.
3. In ComfyUI, create a workflow that accepts:
   - a source image loaded from an uploaded PNG
   - a mask image loaded from an uploaded PNG
   - positive prompt
   - negative prompt
   - seed
   - steps
   - cfg
   - denoise
4. Use official nodes only for the first accepted workflow.
5. Save a normal UI workflow copy for human editing under:
   - `services/model-gateway/workflows/comfyui/composition/sdxl-inpaint-basic.ui.json`
6. Export the workflow in API format and save it under:
   - `services/model-gateway/workflows/comfyui/composition/sdxl-inpaint-basic.api.json`
7. Create the matching metadata file:
   - `services/model-gateway/workflows/comfyui/composition/sdxl-inpaint-basic.meta.json`
8. Fill metadata bindings by inspecting the API workflow node IDs.
9. Run the workflow manually inside ComfyUI with test images before calling it from PixelOasis.
10. Run the workflow through the gateway with local PNG files before involving Photoshop.

Workflow constraints:

- Output exactly one image.
- Output PNG dimensions must match the requested Photoshop selection dimensions.
- If the ComfyUI workflow internally resizes or pads, it must crop or resize back before `SaveImage`.
- The mask polarity must be documented in metadata:
  - white means editable/generated area
  - black means preserved area
- The gateway must invert the mask only if metadata explicitly declares `maskPolicy.invertBeforeUpload`.
- The output node must be a known image-producing node, typically `SaveImage`.

Acceptance:

- The workflow runs manually inside ComfyUI Desktop.
- The API-format workflow can be submitted through `POST /prompt`.
- The gateway can upload source and mask PNG files, patch the workflow, submit it, poll completion, and download one PNG.
- The downloaded PNG has the same width and height as the input selection image.
- The same public request can switch between SDXL and FLUX variants by metadata/config, not by Photoshop code changes.

### Phase G5: ComfyUI Adapter Integration

Replace the current ComfyUI adapter stub with the complete gateway execution path.

Target file:

```text
services/model-gateway/src/adapters/comfyui/adapter.js
```

Execution flow:

1. Receive validated PixelOasis request.
2. Resolve public `workflowId` to selected workflow metadata and API JSON.
3. Decode `selection.imagePngBase64` and `selection.maskPngBase64`.
4. Upload source PNG to ComfyUI.
5. Upload mask PNG to ComfyUI.
6. Patch the API workflow using metadata bindings.
7. Submit the workflow to `/prompt`.
8. Poll `/history/{prompt_id}` until completion.
9. Read output image references from the configured output node.
10. Download output PNG through `/view`.
11. Verify PNG dimensions against `selection.bounds`.
12. Return normalized PixelOasis response:

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
      "workflowId": "composition.inpaint.basic",
      "variantId": "sdxl-inpaint-basic",
      "promptId": "..."
    }
  }
}
```

Failure behavior:

- `COMFYUI_OFFLINE`: cannot reach configured ComfyUI URL.
- `WORKFLOW_NOT_FOUND`: no metadata for public workflow ID.
- `WORKFLOW_BINDING_ERROR`: metadata points to missing node/input.
- `MISSING_MODEL`: required model file is not available.
- `COMFYUI_VALIDATION_ERROR`: `/prompt` rejects the API workflow.
- `COMFYUI_TIMEOUT`: no result before timeout.
- `NO_OUTPUT_IMAGE`: history completed but no configured output image exists.
- `OUTPUT_SIZE_MISMATCH`: result dimensions do not match selection and no resize policy allows it.

Acceptance:

- `PO_MODEL_PROVIDER=comfyui npm run dev` runs the real adapter.
- A standalone gateway test can generate from local PNG and mask files without Photoshop.
- The adapter returns the normalized response shape consumed by the existing plugin.
- ComfyUI errors are preserved enough to debug node and model issues.

## 10. End-To-End Acceptance Path

Run the first accepted route in three layers: ComfyUI only, gateway only, then Photoshop end to end.

### Layer 1: ComfyUI Desktop Manual Verification

1. Start ComfyUI Desktop.
2. Confirm `http://127.0.0.1:8000/system_stats` responds.
3. Open the PixelOasis UI workflow in ComfyUI.
4. Load a local source PNG and mask PNG.
5. Run the workflow manually.
6. Confirm it produces exactly one PNG.
7. Confirm the output dimensions match the source dimensions.

### Layer 2: Gateway To ComfyUI Without Photoshop

1. Start the gateway:

```powershell
cd E:\PixelOasis\services\model-gateway
$env:COMFYUI_URL="http://127.0.0.1:8000"
$env:PO_MODEL_PROVIDER="comfyui"
npm run dev
```

2. Call `GET http://127.0.0.1:8787/health?upstream=1`.
3. Call `GET http://127.0.0.1:8787/workflows`.
4. Submit a test `POST /generate` using local fixture PNG and mask data.
5. Confirm the gateway response contains `status: "succeeded"` and `result.imagePngBase64`.
6. Decode the returned PNG and confirm dimensions.

### Layer 3: Full Photoshop Route

1. Build the plugin:

```powershell
cd E:\PixelOasis\pixeloasis-plugin
npm run build
```

2. Open Photoshop.
3. Load `pixeloasis-plugin/dist/manifest.json` in UXP Developer Tool.
4. Open a document.
5. Create a rectangular selection.
6. Click `composition.inpaint.basic`.
7. Open the parameter page.
8. Confirm or edit prompt and generation parameters.
9. Run generation.
10. Plugin captures formal PNG image and PNG mask.
11. Plugin sends request to the gateway.
12. Gateway uploads images to ComfyUI.
13. Gateway submits the selected API workflow.
14. Gateway retrieves output PNG.
15. Plugin places returned PNG as a top layer.
16. Plugin applies the original selection mask.

Acceptance:

- No JPEG is used for formal image or formal mask.
- Preview JPEG displays correctly.
- ComfyUI receives valid source and mask PNG files.
- The generated image returns to Photoshop.
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

### Gateway Unit And Integration Tests

- Config:
  - `COMFYUI_URL` explicitly set to Desktop `8000`.
  - `COMFYUI_URL` explicitly set to unavailable URL.
  - fallback candidate detection when env var is not set.
- Health:
  - gateway online with ComfyUI offline.
  - gateway online with ComfyUI online.
  - upstream deep check can call `/object_info`.
- Validation:
  - invalid JSON.
  - missing `correlationId`.
  - missing `workflowId`.
  - unknown public workflow ID.
  - missing formal PNG image.
  - missing formal PNG mask.
  - JPEG submitted as formal image or mask.
  - invalid base64.
  - bounds width/height too small, too large, or non-finite.
  - parameter ranges outside allowed limits.
- Workflow registry:
  - missing metadata file.
  - missing API workflow file.
  - duplicate public workflow IDs with priorities.
  - binding points to missing node ID.
  - binding points to missing node input.
  - missing required model.
- ComfyUI client:
  - upload image success.
  - `/prompt` validation error.
  - history polling success.
  - history polling timeout.
  - output download success.
  - missing output image.

### Workflow Tests

- Manual ComfyUI run with an opaque source image and rectangular mask.
- Manual ComfyUI run with transparent pixels in the source PNG.
- Manual ComfyUI run with soft mask edges.
- Gateway run with the same fixtures.
- Output dimensions match input dimensions.
- Mask polarity matches PixelOasis expectation.
- Re-running with the same seed is deterministic enough for debugging.
- Seed `-1` is replaced by a concrete seed and returned in metadata.

### Plugin Tests Inside Photoshop

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
- Gateway offline.
- ComfyUI offline while gateway is online.
- ComfyUI workflow validation failure surfaced in UI.

### End-To-End Tests

- One inpaint workflow returns one layer.
- Repeated generation creates additional layers without corrupting previous layers.
- Reloading the plugin does not lose core settings.
- Photoshop restart and UDT reload still load the correct `pixeloasis-plugin/dist`.
- Switching workflow variant from SDXL to FLUX does not require Photoshop-side code changes.

## 12. Documentation To Add Or Update

Add `docs/workflows.md` before adding the second real workflow variant. It must explain:

- Public PixelOasis `workflowId` versus internal ComfyUI `variantId`.
- Metadata file format.
- API workflow export steps from ComfyUI Desktop.
- How to identify node IDs and input names in API-format JSON.
- Binding rules for source image, mask image, prompts, seed, steps, cfg, denoise, sampler, scheduler, and output image.
- Required model declaration and validation.
- Mask polarity and whether inversion is required.
- Size policy and exact selection-size output requirements.

Update `docs/dev-guide.md` whenever a new runtime pitfall is discovered:

- ComfyUI Desktop port and instance behavior.
- PNG encoder behavior.
- ComfyUI workflow binding mistakes.
- ComfyUI `/prompt` validation error interpretation.
- Photoshop placement and mask alignment pitfalls.
- Model file location differences between Desktop, portable, and manual ComfyUI installs.

Update `README.md` once the gateway can run a real workflow:

- How to start ComfyUI Desktop.
- How to start the gateway with `COMFYUI_URL`.
- How to build and load the UXP plugin.
- Minimal troubleshooting checklist.

## 13. Recommended Build Order From This Point

Use this order from the current repository state:

1. Confirm ComfyUI Desktop API base at `http://127.0.0.1:8000`.
2. Update gateway config to support `COMFYUI_URL` and Desktop/manual fallback candidates.
3. Extend `GET /health` with optional upstream ComfyUI status.
4. Keep echo adapter green as the Photoshop-side safety test.
5. Implement the ComfyUI client functions in `client.js`.
6. Build `SDXL Inpaint Basic` manually in ComfyUI Desktop.
7. Save both UI workflow JSON and API workflow JSON into `services/model-gateway/workflows/comfyui/composition/`.
8. Create `sdxl-inpaint-basic.meta.json` with node bindings.
9. Implement file-backed workflow loading and metadata validation.
10. Implement workflow patching from request data.
11. Implement ComfyUI adapter execution.
12. Add a gateway-only test request that uses local PNG fixtures.
13. Run gateway-to-ComfyUI without Photoshop.
14. Run Photoshop-to-gateway-to-ComfyUI-to-Photoshop with `composition.inpaint.basic`.
15. Add `FLUX.1 Kontext Dev` as a second variant after SDXL proves the route.
16. Promote the preferred variant by metadata priority/config.
17. Add more workflow categories only after this route is stable.

## 14. Confirmed Assumptions And Remaining User Information

Confirmed:

- ComfyUI Desktop is installed locally.
- On the current machine, ComfyUI Desktop responds at `http://127.0.0.1:8000`.
- PixelOasis gateway runs locally at `http://127.0.0.1:8787`.
- The plugin must call the gateway, not ComfyUI directly.
- The first accepted feature is `composition.inpaint.basic`.
- Quality has priority over speed.
- Output must always equal the Photoshop selection dimensions.
- First version generates one result at a time.
- Workflow settings persist per workflow.
- No PixelOasis ComfyUI workflow is configured yet; it must be authored, exported, and registered.

Still useful to know before model download and workflow tuning:

- GPU model and VRAM amount.
- Available disk space for models.
- Whether the machine can run `FLUX.1 Kontext Dev` comfortably.
- Which SDXL inpaint checkpoint is already installed or preferred.
- Whether prompts should be written in English only, or whether the plugin should later add prompt translation.

Default runtime assumptions:

- ComfyUI Desktop URL on this machine: `http://127.0.0.1:8000`.
- Manual/portable ComfyUI fallback URL: `http://127.0.0.1:8188`.
- Gateway URL: `http://127.0.0.1:8787`.
- First public workflow: `composition.inpaint.basic`.
- First implementation variant: `SDXL Inpaint Basic`.
- Preferred later variant: `FLUX.1 Kontext Dev Inpaint Basic`.

## 15. Definition Of Done For First Milestone

The first milestone is complete only when:

- ComfyUI Desktop is running and reachable from the gateway.
- At least one PixelOasis inpaint workflow has been authored in ComfyUI.
- The workflow has both UI JSON and API-format JSON saved in the gateway workflow directory.
- The workflow has a valid `.meta.json` with complete bindings.
- Gateway `GET /workflows` lists `composition.inpaint.basic`.
- Gateway `POST /generate` runs `composition.inpaint.basic` through ComfyUI without Photoshop.
- The gateway uploads source PNG and mask PNG to ComfyUI.
- ComfyUI returns exactly one PNG.
- The returned PNG dimensions match the requested selection dimensions.
- Photoshop plugin loads through UDT.
- User can create a selection.
- User can run `composition.inpaint.basic`.
- Plugin captures PNG image and PNG mask correctly.
- Plugin sends the request to the gateway.
- Gateway submits the selected SDXL or FLUX workflow to official ComfyUI.
- Plugin places the returned PNG as a new top layer.
- Plugin creates a mask aligned to the original selection.
- Transparent-pixel selections do not break preview or formal upload.
- The full route works after rebuilding and reloading `pixeloasis-plugin/dist/manifest.json`.

## 16. References

- Official ComfyUI server routes: https://docs.comfy.org/development/comfyui-server/comms_routes
- Official ComfyUI Desktop overview: https://docs.comfy.org/installation/desktop/overview
- Official ComfyUI Cloud API overview, useful for route naming and file/workflow concepts: https://docs.comfy.org/api-reference/cloud/overview
- Official ComfyUI local system requirements: https://docs.comfy.org/installation/system_requirements/
- Official ComfyUI FLUX.1 Kontext Dev native workflow: https://docs.comfy.org/tutorials/flux/flux-1-kontext-dev
- Official ComfyUI inpainting workflow guide: https://docs.comfy.org/tutorials/basic/inpaint
- Official Adobe Photoshop UXP Imaging API reference, important for `getPixels` and `encodeImageData` limitations: https://developer.adobe.com/photoshop/uxp/2022/ps-reference/media/imaging/
