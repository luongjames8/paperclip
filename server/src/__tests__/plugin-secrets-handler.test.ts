import { describe, it, expect } from "vitest";
import { extractSecretRefsFromConfig } from "../services/plugin-secrets-handler.js";

const UUID1 = "f0c8b331-b583-4e35-9c67-079d97b41c55";
const UUID2 = "a1b2c3d4-e5f6-4789-abcd-ef0123456789";

describe("extractSecretRefsFromConfig — ${secret:UUID} interpolation tokens", () => {
  it("extracts UUID from embedded ${secret:UUID} token", () => {
    const refs = extractSecretRefsFromConfig({ x: `\${secret:${UUID1}}` });
    expect(refs).toEqual(new Set([UUID1]));
  });

  it("returns empty set for plain string with no secrets", () => {
    const refs = extractSecretRefsFromConfig({ x: "no secret here" });
    expect(refs.size).toBe(0);
  });

  it("ignores ${secret:...} with invalid UUID shape (not 36 hex-with-dashes)", () => {
    const refs = extractSecretRefsFromConfig({ x: "${secret:invalid-uuid-shape}" });
    expect(refs.size).toBe(0);
  });

  it("extracts multiple UUIDs from one string with multiple tokens", () => {
    const refs = extractSecretRefsFromConfig({
      nested: { x: `prefix \${secret:${UUID1}} middle \${secret:${UUID2}} suffix` },
    });
    expect(refs).toEqual(new Set([UUID1, UUID2]));
  });

  it("still extracts bare UUID strings (backwards compat)", () => {
    const refs = extractSecretRefsFromConfig({ key: UUID1 });
    expect(refs).toEqual(new Set([UUID1]));
  });

  it("extracts from array items containing ${secret:UUID}", () => {
    const refs = extractSecretRefsFromConfig({ items: [`\${secret:${UUID1}}`, "plain"] });
    expect(refs).toEqual(new Set([UUID1]));
  });

  it("extracts ${secret:UUID} when schema has format:secret-ref on the path", () => {
    const schema = {
      type: "object",
      properties: {
        apiKey: { type: "string", format: "secret-ref" },
      },
    };
    const refs = extractSecretRefsFromConfig({ apiKey: `\${secret:${UUID1}}` }, schema);
    expect(refs).toEqual(new Set([UUID1]));
  });

  it("schema-driven path also handles bare UUID (existing behaviour preserved)", () => {
    const schema = {
      type: "object",
      properties: {
        apiKey: { type: "string", format: "secret-ref" },
      },
    };
    const refs = extractSecretRefsFromConfig({ apiKey: UUID1 }, schema);
    expect(refs).toEqual(new Set([UUID1]));
  });
});
