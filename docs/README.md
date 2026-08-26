# Documentation guide

- `Overview.md` describes the current product state, capabilities, and known gaps.
- `Architecture.md` documents module boundaries, request flow, and runtime components.
- `Scheme/` contains feature-level technical designs.

## Runtime conventions

- Copy `config.example.yaml` to `config.local.yaml`; do not commit either local configuration or machine-specific paths.
- Configuration precedence is environment variables, then `config.local.yaml`, then legacy `config.yaml`, then built-in defaults.
- The default gateway runtime directory is `.pixeloasis/data/`. Override it with `PO_DATA_DIR` or `model_gateway.data_dir` when data must live elsewhere.
- `PixelOasisData/` is a legacy runtime directory. It remains ignored for compatibility but is not part of the source tree.

## Validation

- Plugin build: `npm run build:check` from `pixeloasis-plugin/`.
- Gateway lifecycle test: `npm run test:lifecycle` from `services/model-gateway/`.
- Environment check: `node tools/verify-env.mjs` from the repository root.
