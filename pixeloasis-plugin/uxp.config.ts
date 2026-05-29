import { defineConfig } from "bolt-uxp";

export default defineConfig({
  entrypoints: [
    {
      type: "panel",
      id: "pixeloasis.panel",
      label: {
        default: "PixelOasis",
      },
      minimumSize: {
        width: 320,
        height: 480,
      },
      maximumSize: {
        width: 900,
        height: 1600,
      },
      preferredDockedSize: {
        width: 360,
        height: 580,
      },
      preferredFloatingSize: {
        width: 420,
        height: 680,
      },
    },
  ],
  manifest: {
    id: "com.pixeloasis.plugin",
    name: "PixelOasis",
    version: "0.1.0",
    host: [
      {
        app: "PS",
        minVersion: "25.0.0",
      },
    ],
  },
});
