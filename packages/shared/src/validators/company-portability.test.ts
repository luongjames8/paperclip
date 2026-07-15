import { describe, expect, it } from "vitest";
import { portabilityRoutineExecutionPolicyParticipantSchema } from "./company-portability.js";

describe("portabilityRoutineExecutionPolicyParticipantSchema", () => {
  it("accepts an agent participant with only agentSlug", () => {
    const parsed = portabilityRoutineExecutionPolicyParticipantSchema.parse({
      type: "agent",
      agentSlug: "ceo",
    });
    expect(parsed).toEqual({ type: "agent", agentSlug: "ceo" });
  });

  it("accepts a user participant with only userId", () => {
    const parsed = portabilityRoutineExecutionPolicyParticipantSchema.parse({
      type: "user",
      userId: "user-1",
    });
    expect(parsed).toEqual({ type: "user", userId: "user-1" });
  });

  it("rejects an agent participant that also sets userId (codex P2: cross-type fields)", () => {
    // Before the fix, superRefine only checked that the field MATCHING `type` was
    // present, so an agent participant carrying a stray userId parsed successfully and
    // translateImportedRoutineExecutionPolicy silently dropped the userId — an
    // ambiguous package would import "successfully" with a policy the author never
    // intended.
    expect(() =>
      portabilityRoutineExecutionPolicyParticipantSchema.parse({
        type: "agent",
        agentSlug: "ceo",
        userId: "user-1",
      })
    ).toThrow(/cannot set userId/);
  });

  it("rejects a user participant that also sets agentSlug (codex P2: cross-type fields)", () => {
    expect(() =>
      portabilityRoutineExecutionPolicyParticipantSchema.parse({
        type: "user",
        userId: "user-1",
        agentSlug: "ceo",
      })
    ).toThrow(/cannot set agentSlug/);
  });

  it("rejects an agent participant missing agentSlug", () => {
    expect(() =>
      portabilityRoutineExecutionPolicyParticipantSchema.parse({ type: "agent" })
    ).toThrow(/require agentSlug/);
  });

  it("rejects a user participant missing userId", () => {
    expect(() =>
      portabilityRoutineExecutionPolicyParticipantSchema.parse({ type: "user" })
    ).toThrow(/require userId/);
  });
});
