// Msteams plugin module implements outbound delivery budgeting.
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isRecord } from "openclaw/plugin-sdk/string-coerce-runtime";

const DEFAULT_TEAMS_ACTIVITY_BUDGET_BYTES = 80 * 1024;
export const DESKTOP_SAFE_TEXT_DIGEST_THRESHOLD_CHARS = 1200;
const DIGEST_SUMMARY_LIMIT = 600;
const DIGEST_TRUNCATED_MARKER = "[Preview truncated; open the full response for complete text]";
const DEFAULT_ARTIFACT_DIR = "/shared/artifacts/msteams-responses";
const ARTIFACT_BASE_URL_ENV = "OPENCLAW_MSTEAMS_ARTIFACT_BASE_URL";
const ARTIFACT_DIR_ENV = "OPENCLAW_MSTEAMS_ARTIFACT_DIR";

export type TeamsDeliveryBudgetMeasurement = {
  serialized: string;
  jsonUtf8Bytes: number;
  jsonUtf16Bytes: number;
  budgetBytes: number;
  overBudget: boolean;
};

export type TeamsDeliveryArtifact = {
  artifactId: string;
  artifactPath: string;
  artifactUrl?: string;
  hash: string;
  runId: string;
  description: string;
  sizeBytes: number;
};

export type TeamsBudgetedActivity =
  | {
      kind: "normal";
      activity: Record<string, unknown>;
      measurement: TeamsDeliveryBudgetMeasurement;
    }
  | {
      kind: "artifact-digest";
      activity: Record<string, unknown>;
      artifact: TeamsDeliveryArtifact;
      originalMeasurement: TeamsDeliveryBudgetMeasurement;
      digestMeasurement: TeamsDeliveryBudgetMeasurement;
    };

function serializeTeamsActivity(activity: unknown): string {
  return JSON.stringify(activity ?? null);
}

export function measureTeamsActivity(
  activity: unknown,
  budgetBytes = DEFAULT_TEAMS_ACTIVITY_BUDGET_BYTES,
): TeamsDeliveryBudgetMeasurement {
  const serialized = serializeTeamsActivity(activity);
  const jsonUtf8Bytes = Buffer.byteLength(serialized, "utf8");
  const jsonUtf16Bytes = serialized.length * 2;
  const accountedBytes = Math.max(jsonUtf8Bytes, jsonUtf16Bytes);
  return {
    serialized,
    jsonUtf8Bytes,
    jsonUtf16Bytes,
    budgetBytes,
    overBudget: accountedBytes > budgetBytes,
  };
}

function isTeamsMessageSizeError(err: unknown): boolean {
  const direct = extractStatusCode(err);
  if (direct === 413) {
    return true;
  }
  const text = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return /\b413\b|payload too large|message size|request entity too large/iu.test(text);
}

export async function budgetTeamsActivity(params: {
  activity: Record<string, unknown>;
  budgetBytes?: number;
  artifactDir?: string;
  artifactBaseUrl?: string;
  runId?: string;
  description?: string;
}): Promise<TeamsBudgetedActivity> {
  const budgetBytes = params.budgetBytes ?? DEFAULT_TEAMS_ACTIVITY_BUDGET_BYTES;
  const originalMeasurement = measureTeamsActivity(params.activity, budgetBytes);
  if (!originalMeasurement.overBudget && !isDesktopUnsafeLongText(params.activity)) {
    return { kind: "normal", activity: params.activity, measurement: originalMeasurement };
  }

  const envelope = await buildArtifactDigestActivity({
    activity: params.activity,
    artifactDir: params.artifactDir,
    artifactBaseUrl: params.artifactBaseUrl,
    budgetBytes,
    runId: params.runId,
    description: params.description,
  });
  return {
    kind: "artifact-digest",
    activity: envelope.activity,
    artifact: envelope.artifact,
    originalMeasurement,
    digestMeasurement: envelope.measurement,
  };
}

export async function sendTeamsActivityWithBudget<T>(params: {
  activity: Record<string, unknown>;
  send: (activity: Record<string, unknown>) => Promise<T>;
  budgetBytes?: number;
  artifactDir?: string;
  artifactBaseUrl?: string;
  runId?: string;
  description?: string;
}): Promise<{ result: T; budgeted: TeamsBudgetedActivity; recoveredFromSizeError: boolean }> {
  const budgeted = await budgetTeamsActivity(params);
  try {
    return {
      result: await params.send(budgeted.activity),
      budgeted,
      recoveredFromSizeError: false,
    };
  } catch (err) {
    if (budgeted.kind === "artifact-digest" || !isTeamsMessageSizeError(err)) {
      throw err;
    }
    const fallback = await buildArtifactDigestActivity({
      activity: params.activity,
      artifactDir: params.artifactDir,
      artifactBaseUrl: params.artifactBaseUrl,
      budgetBytes: params.budgetBytes ?? DEFAULT_TEAMS_ACTIVITY_BUDGET_BYTES,
      runId: params.runId,
      description: params.description,
    });
    return {
      result: await params.send(fallback.activity),
      budgeted: {
        kind: "artifact-digest",
        activity: fallback.activity,
        artifact: fallback.artifact,
        originalMeasurement: budgeted.measurement,
        digestMeasurement: fallback.measurement,
      },
      recoveredFromSizeError: true,
    };
  }
}

export async function sendTeamsTurnActivityWithBudget<T>(params: {
  activity: unknown;
  send: (activity: Record<string, unknown>) => Promise<T>;
  budgetBytes?: number;
  artifactDir?: string;
  artifactBaseUrl?: string;
  runId?: string;
  description?: string;
}): Promise<{ result: T; budgeted: TeamsBudgetedActivity; recoveredFromSizeError: boolean }> {
  return await sendTeamsActivityWithBudget({
    ...params,
    activity: normalizeTeamsActivityRecord(params.activity),
  });
}

export async function updateTeamsTurnActivityWithBudget<T>(params: {
  activity: unknown;
  update: (activity: Record<string, unknown>) => Promise<T>;
  budgetBytes?: number;
  artifactDir?: string;
  artifactBaseUrl?: string;
  runId?: string;
  description?: string;
}): Promise<T> {
  const budgeted = await budgetTeamsActivity({
    activity: normalizeTeamsActivityRecord(params.activity),
    budgetBytes: params.budgetBytes,
    artifactDir: params.artifactDir,
    artifactBaseUrl: params.artifactBaseUrl,
    runId: params.runId,
    description: params.description,
  });
  return await params.update(budgeted.activity);
}

export function normalizeTeamsActivityRecord(activity: unknown): Record<string, unknown> {
  if (typeof activity === "string") {
    return { type: "message", text: activity };
  }
  if (activity && typeof activity === "object" && !Array.isArray(activity)) {
    return activity as Record<string, unknown>;
  }
  return { type: "message", text: activity == null ? "" : String(activity) };
}

async function buildArtifactDigestActivity(params: {
  activity: Record<string, unknown>;
  artifactDir?: string;
  artifactBaseUrl?: string;
  budgetBytes: number;
  runId?: string;
  description?: string;
}): Promise<{
  activity: Record<string, unknown>;
  artifact: TeamsDeliveryArtifact;
  measurement: TeamsDeliveryBudgetMeasurement;
}> {
  const content = extractArtifactContent(params.activity);
  const hash = createHash("sha256").update(content).digest("hex");
  const runId =
    params.runId?.trim() || extractRunId(params.activity) || `msteams-run-${hash.slice(0, 12)}`;
  const artifactId = `${runId}-${hash.slice(0, 16)}.md`;
  const artifactDir =
    params.artifactDir ?? process.env[ARTIFACT_DIR_ENV]?.trim() ?? DEFAULT_ARTIFACT_DIR;
  await mkdir(artifactDir, { recursive: true });
  const artifactPath = join(artifactDir, artifactId);
  await writeFile(artifactPath, content, "utf8");
  const artifactUrl = buildArtifactUrl({
    artifactId,
    baseUrl: params.artifactBaseUrl ?? process.env[ARTIFACT_BASE_URL_ENV],
  });

  const artifact: TeamsDeliveryArtifact = {
    artifactId,
    artifactPath,
    ...(artifactUrl ? { artifactUrl } : {}),
    hash,
    runId,
    description: params.description ?? describeActivity(params.activity),
    sizeBytes: Buffer.byteLength(content, "utf8"),
  };
  const activity = buildDigestActivity({
    source: params.activity,
    artifact,
    budgetBytes: params.budgetBytes,
  });
  return { activity, artifact, measurement: measureTeamsActivity(activity, params.budgetBytes) };
}

function buildDigestActivity(params: {
  source: Record<string, unknown>;
  artifact: TeamsDeliveryArtifact;
  budgetBytes: number;
}): Record<string, unknown> {
  const summary = summarizeContent(extractArtifactContent(params.source));
  const openLine = params.artifact.artifactUrl
    ? "Open the full response using the button below."
    : "Full response is stored in the artifact store; an operator must provide an access link.";
  const base = {
    type: "message",
    text: [
      "Full response is available as an artifact because it is too long for reliable Teams desktop rendering.",
      "",
      openLine,
      "",
      "Summary:",
      summary,
    ].join("\n"),
    ...(params.artifact.artifactUrl
      ? {
          attachments: [
            {
              contentType: "application/vnd.microsoft.card.adaptive",
              content: buildOpenArtifactCard({ artifact: params.artifact, summary }),
            },
          ],
        }
      : {}),
    channelData: {
      ...(isRecord(params.source.channelData) ? params.source.channelData : {}),
      openclawDeliveryEnvelope: {
        runId: params.artifact.runId,
        artifactId: params.artifact.artifactId,
        artifactPath: params.artifact.artifactPath,
        ...(params.artifact.artifactUrl ? { artifactUrl: params.artifact.artifactUrl } : {}),
        hash: `sha256:${params.artifact.hash}`,
        budgetBytes: params.budgetBytes,
      },
    },
  };
  if (!measureTeamsActivity(base, params.budgetBytes).overBudget) {
    return base;
  }
  return {
    ...base,
    text: [
      "Full response is available as an artifact because it is too long for reliable Teams desktop rendering.",
      params.artifact.artifactUrl
        ? `Open full response: ${params.artifact.artifactUrl}`
        : "Full response is stored in the artifact store; an operator must provide an access link.",
      "Summary: response omitted from Teams due to size.",
    ].join("\n"),
  };
}

function buildArtifactUrl(params: { baseUrl?: string; artifactId: string }): string | undefined {
  const raw = params.baseUrl?.trim();
  if (!raw) {
    return undefined;
  }
  let base: URL;
  try {
    base = new URL(raw.endsWith("/") ? raw : `${raw}/`);
  } catch {
    return undefined;
  }
  if (base.protocol !== "https:" && base.protocol !== "http:") {
    return undefined;
  }
  return new URL(encodeURIComponent(params.artifactId), base).href;
}

function buildOpenArtifactCard(params: {
  artifact: TeamsDeliveryArtifact;
  summary: string;
}): Record<string, unknown> {
  return {
    type: "AdaptiveCard",
    version: "1.4",
    body: [
      {
        type: "TextBlock",
        text: "Full response available",
        weight: "Bolder",
        wrap: true,
      },
      {
        type: "TextBlock",
        text: params.summary,
        wrap: true,
      },
    ],
    actions: params.artifact.artifactUrl
      ? [
          {
            type: "Action.OpenUrl",
            title: "Open full response",
            url: params.artifact.artifactUrl,
          },
        ]
      : [],
  };
}

function extractArtifactContent(activity: Record<string, unknown>): string {
  if (typeof activity.text === "string" && activity.text.trim()) {
    return activity.text;
  }
  const attachments = Array.isArray(activity.attachments) ? activity.attachments : [];
  if (attachments.length > 0) {
    return JSON.stringify({ attachments }, null, 2);
  }
  return JSON.stringify(activity, null, 2);
}

function isDesktopUnsafeLongText(activity: Record<string, unknown>): boolean {
  if (typeof activity.text !== "string") {
    return false;
  }
  const attachments = Array.isArray(activity.attachments) ? activity.attachments : [];
  return (
    attachments.length === 0 && activity.text.length > DESKTOP_SAFE_TEXT_DIGEST_THRESHOLD_CHARS
  );
}

function describeActivity(activity: Record<string, unknown>): string {
  if (typeof activity.text === "string" && activity.text.trim()) {
    return "Full Teams text response.";
  }
  const attachments = Array.isArray(activity.attachments) ? activity.attachments : [];
  if (
    attachments.some(
      (attachment) =>
        isRecord(attachment) && String(attachment.contentType ?? "").includes("adaptive"),
    )
  ) {
    return "Full Teams Adaptive Card payload.";
  }
  return "Full Teams outbound activity payload.";
}

function summarizeContent(content: string): string {
  const compact = content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
  return compact.length > DIGEST_SUMMARY_LIMIT
    ? `${compact.slice(0, DIGEST_SUMMARY_LIMIT).trimEnd()}\n${DIGEST_TRUNCATED_MARKER}`
    : compact || "No text summary available; see artifact.";
}

function extractRunId(activity: Record<string, unknown>): string | undefined {
  const channelData = isRecord(activity.channelData) ? activity.channelData : undefined;
  const openclaw = isRecord(channelData?.openclaw) ? channelData.openclaw : undefined;
  const candidates = [openclaw?.runId, channelData?.runId, activity.id];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return undefined;
}

function extractStatusCode(err: unknown): number | null {
  if (!isRecord(err)) {
    return null;
  }
  const direct = err.statusCode ?? err.status;
  if (typeof direct === "number" && Number.isInteger(direct)) {
    return direct;
  }
  if (typeof direct === "string" && /^\d{3}$/u.test(direct.trim())) {
    return Number(direct);
  }
  const response = isRecord(err.response) ? err.response : undefined;
  const responseStatus = response?.status;
  if (typeof responseStatus === "number" && Number.isInteger(responseStatus)) {
    return responseStatus;
  }
  if (typeof responseStatus === "string" && /^\d{3}$/u.test(responseStatus.trim())) {
    return Number(responseStatus);
  }
  return null;
}
