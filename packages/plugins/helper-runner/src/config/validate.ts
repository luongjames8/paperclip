import path from "node:path";
import type { HelperConfig, PluginConfig } from "./schema.js";

export function validateConfig(config: PluginConfig): void {
  const seen = new Set<string>();
  for (const helper of config.helpers) {
    validateHelper(helper);
    const triggerKey =
      helper.trigger.kind === "routine"
        ? `routine:${helper.trigger.routineId}`
        : helper.trigger.kind === "approval"
        ? `approval:${helper.trigger.approvalType ?? "*"}:${helper.trigger.requireStatus ?? "approved"}`
        : `issue:${helper.trigger.event ?? "updated"}:${helper.trigger.statusFilter ?? "*"}:${helper.trigger.assigneeAgentId ?? "*"}`;
    const key = `${triggerKey}:${helper.name}`;
    if (seen.has(key)) {
      throw new Error(
        `Duplicate helper: name "${helper.name}" + trigger "${triggerKey}" appears more than once`
      );
    }
    seen.add(key);
  }
}

function validateHelper(helper: HelperConfig): void {
  if (!path.isAbsolute(helper.exec.command)) {
    throw new Error(
      `Helper "${helper.name}": exec.command must be an absolute path, got "${helper.exec.command}"`
    );
  }
}
