import { createHash } from "node:crypto";
import { measureTeamsActivity, type TeamsDeliveryBudgetMeasurement } from "./delivery-budget.js";
import { buildMSTeamsMessageActivity } from "./message-activity.js";

const DEFAULT_TEXT_CHUNK_MAX_CHARS = 1200;
const DEFAULT_TEXT_CHUNK_MAX_BYTES = 24 * 1024;
const TEXT_CHUNK_MAX_CHARS_ENV = "OPENCLAW_MSTEAMS_TEXT_CHUNK_MAX_CHARS";
const TEXT_CHUNK_MAX_BYTES_ENV = "OPENCLAW_MSTEAMS_TEXT_CHUNK_MAX_BYTES";
const MIN_TEXT_CHUNK_MAX_CHARS = 240;
const HEADER_RESERVE_CHARS = 48;

export type TeamsTextWindowChunk = {
  index: number;
  total: number;
  body: string;
  text: string;
  measurement: TeamsDeliveryBudgetMeasurement;
};

export type TeamsTextWindowPlan = {
  kind: "text-window";
  chunks: TeamsTextWindowChunk[];
  sourceText: string;
  sourceHash: string;
  reconstructedHash: string;
  maxChars: number;
  maxBytes: number;
};

export type TeamsTextWindowPlannerOptions = {
  maxChars?: number;
  maxBytes?: number;
};

export function resolveTeamsTextWindowPlannerOptions(
  options: TeamsTextWindowPlannerOptions = {},
): Required<TeamsTextWindowPlannerOptions> {
  return {
    maxChars: normalizePositiveInteger(
      options.maxChars,
      process.env[TEXT_CHUNK_MAX_CHARS_ENV],
      DEFAULT_TEXT_CHUNK_MAX_CHARS,
    ),
    maxBytes: normalizePositiveInteger(
      options.maxBytes,
      process.env[TEXT_CHUNK_MAX_BYTES_ENV],
      DEFAULT_TEXT_CHUNK_MAX_BYTES,
    ),
  };
}

export function planTeamsTextWindowChunks(
  text: string,
  options: TeamsTextWindowPlannerOptions = {},
): TeamsTextWindowPlan {
  const resolved = resolveTeamsTextWindowPlannerOptions(options);
  const sourceText = text ?? "";
  const maxBodyChars = Math.max(MIN_TEXT_CHUNK_MAX_CHARS, resolved.maxChars - HEADER_RESERVE_CHARS);
  const bodies = splitTextForTeamsTextWindow(sourceText, {
    maxBodyChars,
    maxBytes: resolved.maxBytes,
  });
  const total = Math.max(1, bodies.length);
  const chunks = bodies.map((body, index) => {
    const chunk = buildTeamsTextWindowChunkText({ body, index: index + 1, total });
    return {
      index: index + 1,
      total,
      body,
      text: chunk,
      measurement: measureTeamsActivity(buildMSTeamsMessageActivity(chunk), resolved.maxBytes),
    };
  });
  const reconstructed = reconstructTeamsTextWindowChunks(chunks.map((chunk) => chunk.text));
  return {
    kind: "text-window",
    chunks,
    sourceText,
    sourceHash: sha256(sourceText),
    reconstructedHash: sha256(reconstructed),
    maxChars: resolved.maxChars,
    maxBytes: resolved.maxBytes,
  };
}

export function shouldUseTeamsTextWindowPlan(
  activity: Record<string, unknown>,
  options: TeamsTextWindowPlannerOptions = {},
): activity is Record<string, unknown> & { text: string } {
  if (!isTextOnlyTeamsActivity(activity)) {
    return false;
  }
  const text = activity.text;
  if (!text.trim()) {
    return false;
  }
  const resolved = resolveTeamsTextWindowPlannerOptions(options);
  return (
    text.length > resolved.maxChars || measureTeamsActivity(activity, resolved.maxBytes).overBudget
  );
}

export function isTextOnlyTeamsActivity(
  activity: Record<string, unknown>,
): activity is Record<string, unknown> & { text: string } {
  if (typeof activity.text !== "string") {
    return false;
  }
  const attachments = Array.isArray(activity.attachments) ? activity.attachments : [];
  return attachments.length === 0;
}

export function reconstructTeamsTextWindowChunks(chunks: readonly string[]): string {
  return chunks.map(stripTeamsTextWindowChunkChrome).join("");
}

export function stripTeamsTextWindowChunkChrome(text: string): string {
  return text.replace(/^Part \d+\/\d+\n\n/u, "");
}

function splitTextForTeamsTextWindow(
  text: string,
  options: { maxBodyChars: number; maxBytes: number },
): string[] {
  if (!text) {
    return [""];
  }
  const out: string[] = [];
  let remaining = text;
  while (remaining.length > options.maxBodyChars) {
    const splitAt = findFittingSplitIndex(remaining, options);
    out.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }
  while (
    measureTeamsActivity(buildMSTeamsMessageActivity(remaining), options.maxBytes).overBudget &&
    remaining.length > MIN_TEXT_CHUNK_MAX_CHARS
  ) {
    const splitAt = findFittingSplitIndex(remaining, options);
    out.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }
  out.push(remaining);
  return out;
}

function findFittingSplitIndex(
  text: string,
  options: { maxBodyChars: number; maxBytes: number },
): number {
  let upper = Math.min(options.maxBodyChars, text.length);
  let splitAt = findSemanticSplitIndex(text, upper);
  while (
    splitAt > MIN_TEXT_CHUNK_MAX_CHARS &&
    measureTeamsActivity(buildMSTeamsMessageActivity(text.slice(0, splitAt)), options.maxBytes)
      .overBudget
  ) {
    upper = Math.max(MIN_TEXT_CHUNK_MAX_CHARS, Math.floor(splitAt * 0.8));
    splitAt = findSemanticSplitIndex(text, upper);
  }
  return splitAt;
}

function findSemanticSplitIndex(text: string, maxBodyChars: number): number {
  const capped = text.slice(0, maxBodyChars + 1);
  const paragraph = Math.max(capped.lastIndexOf("\n\n"), capped.lastIndexOf("\r\n\r\n"));
  if (paragraph >= MIN_TEXT_CHUNK_MAX_CHARS) {
    return paragraph + (capped.startsWith("\r\n", paragraph) ? 4 : 2);
  }

  const bullet = lastBoundaryMatch(capped, /\n(?=(?:[-*+]|\d+[.)])\s+)/gu);
  if (bullet >= MIN_TEXT_CHUNK_MAX_CHARS) {
    return bullet + 1;
  }

  const sentence = lastBoundaryMatch(capped, /[.!?]["')\]]?\s+/gu);
  if (sentence >= MIN_TEXT_CHUNK_MAX_CHARS) {
    return sentence;
  }

  const whitespace = lastBoundaryMatch(capped, /\s+/gu);
  if (whitespace >= MIN_TEXT_CHUNK_MAX_CHARS) {
    return whitespace;
  }

  return maxBodyChars;
}

function lastBoundaryMatch(text: string, pattern: RegExp): number {
  let last = -1;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? -1;
    if (index >= 0) {
      last = index + match[0].length;
    }
  }
  return last;
}

function buildTeamsTextWindowChunkText(params: {
  body: string;
  index: number;
  total: number;
}): string {
  if (params.total <= 1) {
    return params.body;
  }
  return `Part ${params.index}/${params.total}\n\n${params.body}`;
}

function normalizePositiveInteger(
  explicit: number | undefined,
  envValue: string | undefined,
  fallback: number,
): number {
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit > 0) {
    return Math.floor(explicit);
  }
  const parsed = envValue?.trim() ? Number(envValue) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
