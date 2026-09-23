import { describe, expect, it } from "vitest";
import { measureTeamsActivity } from "./delivery-budget.js";
import { buildMSTeamsMessageActivity } from "./message-activity.js";
import {
  planTeamsTextWindowChunks,
  reconstructTeamsTextWindowChunks,
} from "./text-window-planner.js";

describe("TeamsTextWindowPlanner", () => {
  it("reconstructs semantically split chunk text exactly after deterministic chrome is removed", () => {
    const source = [
      "Opening paragraph with enough text to force planning. ".repeat(14),
      "",
      "- First bullet keeps its own line and content. ".repeat(10),
      "- Second bullet also remains readable. ".repeat(10),
      "",
      "Final sentence block has multiple sentences. It should split before hard fallback. Done.",
    ].join("\n");

    const plan = planTeamsTextWindowChunks(source, { maxChars: 420, maxBytes: 12 * 1024 });

    expect(plan.chunks.length).toBeGreaterThan(1);
    expect(plan.chunks.every((chunk) => chunk.text.length <= plan.maxChars)).toBe(true);
    expect(reconstructTeamsTextWindowChunks(plan.chunks.map((chunk) => chunk.text))).toBe(source);
    expect(plan.reconstructedHash).toBe(plan.sourceHash);
  });

  it("plans a mandatory 200 KB fixture into safe Teams text-window chunks", () => {
    const fixture = Array.from({ length: 3600 }, (_, index) => {
      const bullet = index % 5 === 0 ? "- " : "";
      return `${bullet}200KB text-window acceptance fixture line ${index}: ${"content ".repeat(8)}`;
    }).join("\n");
    expect(Buffer.byteLength(fixture, "utf8")).toBeGreaterThan(200_000);

    const plan = planTeamsTextWindowChunks(fixture);

    expect(plan.chunks.length).toBeGreaterThan(100);
    expect(reconstructTeamsTextWindowChunks(plan.chunks.map((chunk) => chunk.text))).toBe(fixture);
    expect(plan.reconstructedHash).toBe(plan.sourceHash);
    for (const chunk of plan.chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(plan.maxChars);
      expect(
        measureTeamsActivity(buildMSTeamsMessageActivity(chunk.text), plan.maxBytes).overBudget,
      ).toBe(false);
      expect(chunk.measurement.overBudget).toBe(false);
    }
  });

  it("shrinks chunks until multibyte activity payloads fit the byte budget", () => {
    const source = "🚀 multibyte Teams text ".repeat(220);

    const plan = planTeamsTextWindowChunks(source, { maxChars: 1000, maxBytes: 900 });

    expect(plan.chunks.length).toBeGreaterThan(1);
    expect(reconstructTeamsTextWindowChunks(plan.chunks.map((chunk) => chunk.text))).toBe(source);
    for (const chunk of plan.chunks) {
      expect(
        measureTeamsActivity(buildMSTeamsMessageActivity(chunk.text), plan.maxBytes).overBudget,
      ).toBe(false);
    }
  });
});
