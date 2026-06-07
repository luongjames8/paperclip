import type { ModelProfile } from "./types.js";

export const PROFILES: Record<string, ModelProfile> = {
  "all-glm5": {
    opus: "globalisto-worker-glm5",
    sonnet: "globalisto-worker-glm5",
    deepseek: "globalisto-worker-glm5",
  },
  "mixed": {
    opus: "globalisto-worker-glm5",
    sonnet: "globalisto-worker-qwen37",
    deepseek: "globalisto-worker-glm5",
  },
};
