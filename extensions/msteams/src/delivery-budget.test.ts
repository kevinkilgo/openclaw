// Msteams tests cover outbound delivery budgeting.
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  budgetTeamsActivity,
  DEFAULT_TEAMS_ACTIVITY_BUDGET_BYTES,
  measureTeamsActivity,
  sendTeamsActivityWithBudget,
} from "./delivery-budget.js";

let artifactDir: string;

beforeEach(async () => {
  artifactDir = await mkdtemp(join(tmpdir(), "msteams-delivery-budget-"));
});

afterEach(async () => {
  await rm(artifactDir, { force: true, recursive: true });
});

describe("TeamsDeliveryBudgeter", () => {
  it("accounts for UTF-16 JSON payload size as well as UTF-8 bytes", () => {
    const measured = measureTeamsActivity({ type: "message", text: "ASCII \u{1f680}" }, 1);

    expect(measured.jsonUtf8Bytes).toBe(Buffer.byteLength(measured.serialized, "utf8"));
    expect(measured.jsonUtf16Bytes).toBe(measured.serialized.length * 2);
    expect(Math.max(measured.jsonUtf8Bytes, measured.jsonUtf16Bytes)).toBeGreaterThan(
      measured.jsonUtf8Bytes,
    );
    expect(measured.overBudget).toBe(true);
  });

  it("leaves normal short answers unchanged", async () => {
    const activity = { type: "message", text: "Short answer." };

    const budgeted = await budgetTeamsActivity({ activity, artifactDir });

    expect(budgeted.kind).toBe("normal");
    expect(budgeted.activity).toEqual(activity);
  });

  it("falls oversized final responses back to an artifact digest", async () => {
    const text = "Final response line.\n".repeat(9000);

    const budgeted = await budgetTeamsActivity({
      activity: { type: "message", text },
      artifactDir,
      runId: "run-final-oversized",
    });

    expect(budgeted.kind).toBe("artifact-digest");
    if (budgeted.kind !== "artifact-digest") {
      throw new Error("expected artifact digest");
    }
    expect(budgeted.digestMeasurement.overBudget).toBe(false);
    expect(budgeted.activity.text).toContain("Run id: run-final-oversized");
    expect(budgeted.activity.text).toContain(`Content hash: sha256:${budgeted.artifact.hash}`);
    expect(budgeted.activity.text).toContain("[preview truncated; see artifact for full response]");
    expect(String(budgeted.activity.text)).not.toMatch(/\.\.\.$/u);
    expect(await readFile(budgeted.artifact.artifactPath, "utf8")).toBe(text);
  });

  it("falls oversized Adaptive Cards back to an artifact digest", async () => {
    const card = {
      type: "AdaptiveCard",
      version: "1.5",
      body: Array.from({ length: 1400 }, (_, index) => ({
        type: "TextBlock",
        text: `Large card row ${index}: ${"details ".repeat(10)}`,
      })),
    };

    const budgeted = await budgetTeamsActivity({
      activity: {
        type: "message",
        attachments: [
          {
            contentType: "application/vnd.microsoft.card.adaptive",
            content: card,
          },
        ],
      },
      artifactDir,
      runId: "run-card-oversized",
    });

    expect(budgeted.kind).toBe("artifact-digest");
    if (budgeted.kind !== "artifact-digest") {
      throw new Error("expected artifact digest");
    }
    expect(budgeted.activity.text).toContain("Full Teams Adaptive Card payload");
    expect(await readFile(budgeted.artifact.artifactPath, "utf8")).toContain("Large card row");
  });

  it("uses artifact fallback after a simulated 413 without retrying the same oversized payload", async () => {
    const originalText = "413 fallback response.\n".repeat(5000);
    const sent: Array<Record<string, unknown>> = [];
    const send = vi.fn(async (activity: Record<string, unknown>) => {
      sent.push(activity);
      if (sent.length === 1) {
        const error = new Error("HTTP 413 Payload Too Large") as Error & { statusCode: number };
        error.statusCode = 413;
        throw error;
      }
      return { id: "digest-message" };
    });

    const delivered = await sendTeamsActivityWithBudget({
      activity: { type: "message", text: originalText },
      send,
      artifactDir,
      budgetBytes: DEFAULT_TEAMS_ACTIVITY_BUDGET_BYTES * 4,
      runId: "run-413",
    });

    expect(delivered.recoveredFromSizeError).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    expect(sent[0]?.text).toBe(originalText);
    expect(sent[1]?.text).not.toBe(originalText);
    expect(String(sent[1]?.text)).toContain("Run id: run-413");
    expect(delivered.budgeted.kind).toBe("artifact-digest");
    if (delivered.budgeted.kind !== "artifact-digest") {
      throw new Error("expected artifact digest");
    }
    expect(await readFile(delivered.budgeted.artifact.artifactPath, "utf8")).toBe(originalText);
  });

  it("sends one concise digest and artifact for the mandatory 200 KB fixture", async () => {
    const fixture = "200KB acceptance fixture line with enough content for hashing.\n".repeat(3400);
    expect(Buffer.byteLength(fixture, "utf8")).toBeGreaterThan(200_000);
    const sent: Array<Record<string, unknown>> = [];

    const delivered = await sendTeamsActivityWithBudget({
      activity: {
        type: "message",
        text: fixture,
        channelData: { openclaw: { runId: "run-200kb-fixture" } },
      },
      send: async (activity) => {
        sent.push(activity);
        return { id: "teams-digest-1" };
      },
      artifactDir,
    });

    expect(sent).toHaveLength(1);
    const digest = sent[0]!;
    const digestMeasurement = measureTeamsActivity(digest);
    expect(digestMeasurement.overBudget).toBe(false);
    expect(String(digest.text)).toContain("Summary:");
    expect(String(digest.text)).toContain("Run id: run-200kb-fixture");
    expect(String(digest.text)).toContain("Artifact:");
    expect(String(digest.text)).toContain("Content hash: sha256:");
    expect(String(digest.text)).toContain("[preview truncated; see artifact for full response]");
    expect(String(digest.text)).not.toMatch(/\.\.\.$/u);
    expect(delivered.budgeted.kind).toBe("artifact-digest");
    if (delivered.budgeted.kind !== "artifact-digest") {
      throw new Error("expected artifact digest");
    }
    const artifactText = await readFile(delivered.budgeted.artifact.artifactPath, "utf8");
    const artifactHash = createHash("sha256").update(artifactText).digest("hex");
    expect(artifactText).toBe(fixture);
    expect(artifactHash).toBe(delivered.budgeted.artifact.hash);
    expect(String(digest.text)).toContain(`sha256:${artifactHash}`);
  });
});
