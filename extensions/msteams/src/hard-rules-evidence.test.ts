import { describe, expect, it } from "vitest";
import { buildMSTeamsHardRulesDeliveryEvidence } from "./hard-rules-evidence.js";
import { planTeamsTextWindowChunks } from "./text-window-planner.js";

describe("MSTeams hard-rules delivery evidence", () => {
  it("marks actual-sent reconstruction successful only when sent chunks match the source", () => {
    const source = "Native Teams actual sent manifest evidence. ".repeat(90);
    const plan = planTeamsTextWindowChunks(source);
    const messageIds = plan.chunks.map((_, index) => `chunk-${index + 1}`);

    const evidence = buildMSTeamsHardRulesDeliveryEvidence({
      conversationId: "conv",
      sourceText: source,
      messageIds,
      sentChunkTexts: plan.chunks.map((chunk) => chunk.text),
    });

    expect(evidence.messageIds).toEqual(messageIds);
    expect(evidence.chunkCount).toBe(plan.chunks.length);
    expect(evidence.hashesMatch).toBe(true);
    expect(evidence.nativeTextChunksOnly).toBe(true);
    expect(evidence.deliverySuccess).toBe(true);
  });

  it("fails delivery evidence when actual sent chunk bodies do not reconstruct the source", () => {
    const source = "Native Teams actual sent manifest mutation guard. ".repeat(90);
    const plan = planTeamsTextWindowChunks(source);
    const sentChunkTexts = plan.chunks.map((chunk) => chunk.text);
    sentChunkTexts[0] = sentChunkTexts[0]!.replace("Native", "Mutated");

    const evidence = buildMSTeamsHardRulesDeliveryEvidence({
      conversationId: "conv",
      sourceText: source,
      messageIds: plan.chunks.map((_, index) => `chunk-${index + 1}`),
      sentChunkTexts,
    });

    expect(evidence.hashesMatch).toBe(false);
    expect(evidence.nativeTextChunksOnly).toBe(false);
    expect(evidence.deliverySuccess).toBe(false);
  });
});
