// Msteams tests cover outbound delivery budgeting.
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  budgetTeamsActivity,
  DESKTOP_SAFE_TEXT_DIGEST_THRESHOLD_CHARS,
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

function expectVisibleDigestTextClean(
  text: unknown,
  artifact: { artifactId: string; artifactPath: string; hash: string; runId: string },
): void {
  const visibleText = String(text);
  expect(visibleText).not.toContain("Run id:");
  expect(visibleText).not.toContain("Artifact:");
  expect(visibleText).not.toContain("Artifact id:");
  expect(visibleText).not.toContain("Content hash:");
  expect(visibleText).not.toContain(artifact.runId);
  expect(visibleText).not.toContain(artifact.artifactId);
  expect(visibleText).not.toContain(artifact.artifactPath);
  expect(visibleText).not.toContain(artifact.hash);
}

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
    expect(budgeted.activity.text).toContain("The full response was too long to show in Teams");
    expect(budgeted.activity.text).toContain("[preview truncated; see artifact for full response]");
    expectVisibleDigestTextClean(budgeted.activity.text, budgeted.artifact);
    expect(String(budgeted.activity.text)).not.toMatch(/\.\.\.$/u);
    expect(await readFile(budgeted.artifact.artifactPath, "utf8")).toBe(text);
    expect(
      (budgeted.activity.channelData as { openclawDeliveryEnvelope?: { hash?: string } })
        .openclawDeliveryEnvelope?.hash,
    ).toBe(`sha256:${budgeted.artifact.hash}`);
  });

  it("falls desktop-unsafe long text back to an artifact digest before Teams UI truncation", async () => {
    const text = [
      "Desktop Teams does not reliably expose See More for long bot messages.",
      "A".repeat(DESKTOP_SAFE_TEXT_DIGEST_THRESHOLD_CHARS + 50),
      "END OF FULL RESPONSE",
    ].join("\n");

    const budgeted = await budgetTeamsActivity({
      activity: { type: "message", text },
      artifactDir,
      runId: "run-desktop-unsafe",
    });

    expect(measureTeamsActivity({ type: "message", text }).overBudget).toBe(false);
    expect(budgeted.kind).toBe("artifact-digest");
    if (budgeted.kind !== "artifact-digest") {
      throw new Error("expected artifact digest");
    }
    expect(budgeted.activity.text).toContain("The full response was too long to show in Teams");
    expect(budgeted.activity.text).toContain("[preview truncated; see artifact for full response]");
    expectVisibleDigestTextClean(budgeted.activity.text, budgeted.artifact);
    expect(String(budgeted.activity.text)).not.toContain("END OF FULL RESPONSE");
    expect(String(budgeted.activity.text).length).toBeLessThan(DESKTOP_SAFE_TEXT_DIGEST_THRESHOLD_CHARS);
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
    const originalText = "413 fallback response.\n".repeat(20);
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
      budgetBytes: 80 * 1024 * 4,
      runId: "run-413",
    });

    expect(delivered.recoveredFromSizeError).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    expect(sent[0]?.text).toBe(originalText);
    expect(sent[1]?.text).not.toBe(originalText);
    expect(delivered.budgeted.kind).toBe("artifact-digest");
    if (delivered.budgeted.kind !== "artifact-digest") {
      throw new Error("expected artifact digest");
    }
    expect(String(sent[1]?.text)).toContain("The full response was too long to show in Teams");
    expectVisibleDigestTextClean(sent[1]?.text, delivered.budgeted.artifact);
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
    expect(String(digest.text)).toContain("The full response was too long to show in Teams");
    expect(String(digest.text)).toContain("Here is a short preview:");
    expect(String(digest.text)).toContain("[preview truncated; see artifact for full response]");
    expect(String(digest.text)).not.toMatch(/\.\.\.$/u);
    expect(delivered.budgeted.kind).toBe("artifact-digest");
    if (delivered.budgeted.kind !== "artifact-digest") {
      throw new Error("expected artifact digest");
    }
    expectVisibleDigestTextClean(digest.text, delivered.budgeted.artifact);
    const artifactText = await readFile(delivered.budgeted.artifact.artifactPath, "utf8");
    const artifactHash = createHash("sha256").update(artifactText).digest("hex");
    expect(artifactText).toBe(fixture);
    expect(artifactHash).toBe(delivered.budgeted.artifact.hash);
    expect(
      (digest.channelData as { openclawDeliveryEnvelope?: { hash?: string } })
        .openclawDeliveryEnvelope?.hash,
    ).toBe(`sha256:${artifactHash}`);
  });
});
