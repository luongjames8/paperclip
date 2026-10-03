import esbuild from "esbuild";
import { createPluginBundlerPresets } from "@paperclipai/plugin-sdk/bundlers";

const presets = createPluginBundlerPresets({ uiEntry: "src/ui/index.tsx" });
const watch = process.argv.includes("--watch");

const workerCtx = await esbuild.context({
  ...presets.esbuild.worker,
  packages: "external",
});
// SDK preset has bundle:false, which leaves relative imports like
// `./config/validate.js` unresolved at runtime (dist/config/ never gets emitted).
// Override to bundle the manifest so all its imports are inlined.
const manifestCtx = await esbuild.context({
  ...presets.esbuild.manifest,
  bundle: true,
  packages: "external",
});
const uiCtx = await esbuild.context(presets.esbuild.ui);

if (watch) {
  await Promise.all([workerCtx.watch(), manifestCtx.watch(), uiCtx.watch()]);
  console.log("esbuild watch mode enabled for worker, manifest, and ui");
} else {
  await Promise.all([workerCtx.rebuild(), manifestCtx.rebuild(), uiCtx.rebuild()]);
  await Promise.all([workerCtx.dispose(), manifestCtx.dispose(), uiCtx.dispose()]);
}
