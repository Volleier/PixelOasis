# PixelOasis online model gateway

This service preserves the PixelOasis `/v2` plugin contract while replacing local ComfyUI execution with the feifeimiao OpenAI-compatible `gpt-image-2` image-edit API.

## Start

```powershell
$env:FEIFEIMIAO_API_KEY = "sk-..."
npm install
npm start
```

The gateway listens on `http://127.0.0.1:8790`. The API key remains in the gateway process and is never sent to the Photoshop plugin.

Optional environment variables: `FEIFEIMIAO_BASE_URL`, `FEIFEIMIAO_IMAGE_MODEL`, `FEIFEIMIAO_TIMEOUT_MS`, `PO_ONLINE_HOST`, `PO_ONLINE_PORT`, `PO_ONLINE_DATA_DIR`, and `PO_ONLINE_CONCURRENCY`.

Every existing capability is exposed. Source and optional edit/subject masks are sent to `/v1/images/edits`; the returned image is resized to the captured Photoshop bounds and exposed as a normal PixelOasis artifact.

Runtime state is persisted in SQLite with WAL under `.pixeloasis/online-data/`. Active tasks are recovered after restart, upstream concurrency is bounded, cancellation aborts the active request, and `/v2/jobs/{id}/audit` exposes sanitized request metrics.
