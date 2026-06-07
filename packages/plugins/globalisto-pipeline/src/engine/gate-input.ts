// Pure gate-input assembler — maps declared gateInputMap entries to artifact
// content so local gates can actually evaluate rather than falling through to
// the logged defer. No IO, no ctx — fully unit-testable in isolation.
//
// Full per-gate gateInputMap fidelity is validated at the live golden run;
// this makes gates evaluate whenever their declared artifacts are present.

/** Shape of a single entry in a gate's gateInputMap. */
interface GateInputEntry {
  /** Artifact filename to read the value from. */
  file?: string;
  /** Dotted key path to extract from a YAML artifact (e.g. "angle_lock.title"). */
  key?: string;
  /** "yaml_dump" or "full_content" → pass the raw artifact string verbatim.
   *  "first_section" → extract the first markdown section. */
  format?: "yaml_dump" | "full_content" | "first_section";
  /** When true, a missing artifact is silently omitted rather than causing the
   *  whole gate to be skipped. */
  optional?: boolean;
  /** Special non-artifact inputs (e.g. "pipeline_dir") — not resolvable from
   *  artifacts, silently skipped. */
  special?: string;
}

/**
 * Extract a value from a YAML-ish string by a dotted key path.
 *
 * Handles the simple flat/nested shapes produced by pipeline steps
 * (e.g. "angle_lock.title" → reads `angle_lock:` block then `title:` within).
 * Returns undefined when the key is not found.
 */
function extractYamlKey(yamlText: string, keyPath: string): unknown {
  // Walk the dotted key path through a minimal YAML parse.
  // We parse each level by scanning for "<key>:" lines and reading the value
  // either inline (scalar) or as an indented block (object/list).
  const parts = keyPath.split(".");
  let text = yamlText;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const isLast = i === parts.length - 1;

    // Match "  <key>: <value>" where leading spaces vary.
    const scalarRe = new RegExp(`^([ \\t]*)${escapeRegex(part)}:[ \\t]*(.+)$`, "m");
    const blockRe = new RegExp(`^([ \\t]*)${escapeRegex(part)}:[ \\t]*$`, "m");

    const scalarMatch = scalarRe.exec(text);
    const blockMatch = blockRe.exec(text);

    if (scalarMatch && (!blockMatch || scalarMatch.index <= blockMatch.index)) {
      if (isLast) {
        // Return the scalar value, stripping surrounding quotes.
        return scalarMatch[2].replace(/^['"]|['"]$/g, "").trim();
      }
      // Scalar at a non-terminal key — can't descend further.
      return undefined;
    }

    if (blockMatch) {
      if (isLast) {
        // Return the whole sub-block as text for the caller.
        const indent = blockMatch[1].length;
        const start = blockMatch.index + blockMatch[0].length + 1; // skip newline
        const lines = text.slice(start).split("\n");
        const blockLines: string[] = [];
        for (const line of lines) {
          if (line.trim() === "") {
            blockLines.push(line);
            continue;
          }
          const lineIndent = line.match(/^([ \t]*)/)?.[1]?.length ?? 0;
          if (lineIndent <= indent && line.trim() !== "") break;
          blockLines.push(line);
        }
        return blockLines.join("\n").trim() || undefined;
      }
      // Descend into the block.
      const indent = blockMatch[1].length;
      const start = blockMatch.index + blockMatch[0].length + 1;
      const lines = text.slice(start).split("\n");
      const blockLines: string[] = [];
      for (const line of lines) {
        if (line.trim() === "") {
          blockLines.push(line);
          continue;
        }
        const lineIndent = line.match(/^([ \t]*)/)?.[1]?.length ?? 0;
        if (lineIndent <= indent && line.trim() !== "") break;
        blockLines.push(line);
      }
      text = blockLines.join("\n");
      continue;
    }

    return undefined;
  }

  return undefined;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Extract the first markdown section (up to the second ## heading). */
function extractFirstSection(content: string): string {
  const m = content.match(/^[\s\S]*?(?=\n##\s|$)/);
  return m ? m[0].trim() : content.trim();
}

/**
 * Assemble a gate input object from a gate's declared gateInputMap and the
 * resolved artifacts map (filename → body string).
 *
 * - For each declared input key:
 *   - If `special` is set: skip (cannot resolve from artifacts).
 *   - If `format` is "yaml_dump" or "full_content": pass the raw artifact string.
 *   - If `format` is "first_section": extract the first markdown section.
 *   - If `key` is set: parse the artifact as YAML and extract by dotted key.
 *   - Otherwise: pass the raw artifact string.
 * - Required inputs whose artifact is missing cause the whole assembled object
 *   to be returned empty (so the caller can log and skip the gate).
 * - Optional inputs whose artifact is missing are simply omitted.
 * - When gateInputMap is undefined or empty, returns {} (gate has no declared inputs).
 */
export function assembleGateInput(
  gateInputMap: Record<string, unknown> | undefined,
  artifacts: Record<string, string>,
): Record<string, unknown> {
  if (!gateInputMap || Object.keys(gateInputMap).length === 0) {
    return {};
  }

  const result: Record<string, unknown> = {};

  for (const [inputKey, rawEntry] of Object.entries(gateInputMap)) {
    const entry = rawEntry as GateInputEntry;

    // Special inputs (e.g. pipeline_dir) cannot be sourced from artifacts.
    if (entry.special) continue;

    const file = entry.file;
    if (!file) continue;

    const artifactBody = artifacts[file];
    if (artifactBody === undefined) {
      if (entry.optional) {
        // Absent optional — skip silently.
        continue;
      }
      // Required artifact missing — signal caller to skip this gate.
      return {};
    }

    const { key, format } = entry;

    if (format === "yaml_dump" || format === "full_content") {
      result[inputKey] = artifactBody;
      continue;
    }

    if (format === "first_section") {
      result[inputKey] = extractFirstSection(artifactBody);
      continue;
    }

    if (key) {
      const extracted = extractYamlKey(artifactBody, key);
      if (extracted === undefined) {
        if (entry.optional) continue;
        // Required key not found in artifact — signal caller to skip.
        return {};
      }
      result[inputKey] = extracted;
      continue;
    }

    // No key, no special format — pass raw artifact body.
    result[inputKey] = artifactBody;
  }

  return result;
}
