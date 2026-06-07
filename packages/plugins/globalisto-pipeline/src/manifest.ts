import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest: PaperclipPluginManifestV1 = {
  id: "openclaw.plugin-globalisto-pipeline",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Globalisto Content Pipeline",
  description: "Conductor for the globalisto YouTube content pipeline: drives the canonical engine step-by-step via per-model worker agents through the gateway.",
  author: "openclaw-fleet",
  categories: ["automation"],
  capabilities: [
    "events.subscribe",
    "plugin.state.read",
    "plugin.state.write"
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui"
  },
  ui: {
    slots: [
      {
        type: "dashboardWidget",
        id: "health-widget",
        displayName: "Globalisto Content Pipeline Health",
        exportName: "DashboardWidget"
      }
    ]
  }
};

export default manifest;
