# PixelOasis

Photoshop UXP plugin with a local Node.js model gateway for ComfyUI workflows.

## Repository layout

- `pixeloasis-plugin/` — Photoshop UXP plugin source and its distributable build.
- `services/model-gateway/` — local API gateway, capability definitions, workflows, and tests.
- `ComfyUI/custom_nodes/pixeloasis_effects/` — project-owned custom nodes to install into ComfyUI.
- `tools/` — environment verification, deployment, gateway startup, and model utilities.
- `docs/` — architecture, project overview, and technical designs.
- `.pixeloasis/` — default local runtime data; generated and ignored by Git.

## Local setup

1. Copy `config.example.yaml` to `config.local.yaml` and update local paths.
2. Install dependencies in `services/model-gateway/` and `pixeloasis-plugin/`.
3. Run `node tools/verify-env.mjs`, then `node tools/start-gateway.mjs`.

`config.local.yaml`, legacy `config.yaml`, generated plugin builds, logs, and runtime data are intentionally not tracked. Environment variables take precedence over configuration files; see `docs/README.md` for details.
