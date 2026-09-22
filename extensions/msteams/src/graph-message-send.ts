// Msteams plugin module builds dry-run Graph native text message descriptors.
import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { mutateGraphJson } from "./graph.js";

export const GRAPH_NATIVE_TEXT_RECOMMENDED_MAX_BYTES = 80 * 1024;
export const GRAPH_NATIVE_TEXT_LIVE_MIN_INTERVAL_MS = 1000;

export type GraphNativeTextRoute =
  | { type: "chat"; chatId: string }
  | { type: "channel-root"; teamId: string; channelId: string }
  | { type: "channel-reply"; teamId: string; channelId: string; messageId: string };

export type GraphNativeTextContentType = "text" | "html";

export type GraphNativeTextRequestDescriptor = {
  method: "POST";
  url: string;
  endpoint: string;
  routeType: GraphNativeTextRoute["type"];
  headers: { "Content-Type": "application/json" };
  body: {
    body: {
      contentType: GraphNativeTextContentType;
      content: string;
    };
  };
  payloadBytes: number;
  chunkIndex: number;
  chunkCount: number;
  chunkHash: string;
};

export type GraphNativeTextDryRunManifest = {
  mode: "dry-run";
  dryRun: true;
  method: "POST";
  routeType: GraphNativeTextRoute["type"];
  endpoint: string;
  endpoints: string[];
  requestCount: number;
  chunkCount: number;
  chunkHashes: string[];
  chunks: Array<{
    index: number;
    endpoint: string;
    bytes: number;
    hash: string;
  }>;
  payloadBytes: number;
  totalPayloadBytes: number;
  contentBytes: number;
  sourceBytes: number;
  sourceHash: string;
  reconstructedHash: string;
  contentType: GraphNativeTextContentType;
  requests: GraphNativeTextRequestDescriptor[];
  rateLimitPlan: {
    minIntervalMs: number;
    scope: "per-chat-channel-user";
    note: string;
  };
  liveValidation: {
    minDelayMsPerConversationAndUser: number;
    rateLimitPlan: string;
    identityWarning: string;
  };
  identityWarning: string;
  fallbackPolicy: "native-text-only-no-artifact-card-file-link-fallback";
  noNetwork: true;
};

export type GraphNativeTextLiveSendResult = {
  messageIds: string[];
  responses: Array<{
    chunkIndex: number;
    chunkCount: number;
    messageId?: string;
    createdDateTime?: string;
    payloadBytes: number;
    chunkHash: string;
  }>;
};

export async function sendGraphNativeTextLive(
  params: BuildGraphNativeTextDryRunParams & {
    token: string;
    minIntervalMs?: number;
  },
): Promise<GraphNativeTextLiveSendResult> {
  const requests = buildGraphNativeTextRequestDescriptors(params);
  const minIntervalMs = Math.max(
    0,
    Math.floor(params.minIntervalMs ?? GRAPH_NATIVE_TEXT_LIVE_MIN_INTERVAL_MS),
  );
  const responses: GraphNativeTextLiveSendResult["responses"] = [];

  for (const request of requests) {
    if (responses.length > 0 && minIntervalMs > 0) {
      await sleep(minIntervalMs);
    }
    const response = await mutateGraphJson<{ id?: string; createdDateTime?: string }>({
      token: params.token,
      path: request.endpoint,
      method: "POST",
      body: request.body,
    });
    responses.push({
      chunkIndex: request.chunkIndex,
      chunkCount: request.chunkCount,
      ...(typeof response.id === "string" ? { messageId: response.id } : {}),
      ...(typeof response.createdDateTime === "string"
        ? { createdDateTime: response.createdDateTime }
        : {}),
      payloadBytes: request.payloadBytes,
      chunkHash: request.chunkHash,
    });
  }

  return {
    messageIds: responses.flatMap((response) =>
      response.messageId && response.messageId.trim() ? [response.messageId] : [],
    ),
    responses,
  };
}

export type BuildGraphNativeTextDryRunParams = {
  route: GraphNativeTextRoute;
  text: string;
  contentType?: GraphNativeTextContentType;
  maxPayloadBytes?: number;
  allowHtml?: boolean;
  htmlJustification?: string;
  attachments?: unknown[];
  cards?: unknown[];
  files?: unknown[];
  links?: unknown[];
  forbiddenFallbacks?: {
    artifact?: unknown;
    card?: unknown;
    file?: unknown;
    link?: unknown;
  };
};

export function buildGraphNativeTextRequestDescriptors(
  params: BuildGraphNativeTextDryRunParams,
): GraphNativeTextRequestDescriptor[] {
  assertNativeTextOnly(params);
  const contentType = resolveContentType(params);
  const endpoint = graphNativeTextEndpoint(params.route);
  const maxPayloadBytes = resolveMaxPayloadBytes(params.maxPayloadBytes);
  const chunks = splitTextByGraphPayloadBytes({
    text: params.text,
    contentType,
    maxPayloadBytes,
  });
  return chunks.map((chunk, index) => {
    const body = graphNativeTextBody(contentType, chunk);
    const endpoint = graphNativeTextEndpoint(params.route);
    return {
      method: "POST",
      url: `https://graph.microsoft.com/v1.0${endpoint}`,
      endpoint,
      routeType: params.route.type,
      headers: { "Content-Type": "application/json" },
      body,
      payloadBytes: byteLength(JSON.stringify(body)),
      chunkIndex: index + 1,
      chunkCount: chunks.length,
      chunkHash: sha256(chunk),
    };
  });
}

export function buildGraphNativeTextDryRunManifest(
  params: BuildGraphNativeTextDryRunParams,
): GraphNativeTextDryRunManifest {
  const requests = buildGraphNativeTextRequestDescriptors(params);
  const reconstructedText = requests.map((request) => request.body.body.content).join("");
  const totalPayloadBytes = requests.reduce((total, request) => total + request.payloadBytes, 0);
  const identityWarning =
    "Delegated Microsoft Graph sends may appear as the signed-in user, not the OpenClaw bot.";
  return {
    mode: "dry-run",
    dryRun: true,
    method: "POST",
    routeType: params.route.type,
    endpoint: requests[0]?.endpoint ?? graphNativeTextEndpoint(params.route),
    endpoints: [...new Set(requests.map((request) => request.endpoint))],
    requestCount: requests.length,
    chunkCount: requests.length,
    chunkHashes: requests.map((request) => request.chunkHash),
    chunks: requests.map((request) => ({
      index: request.chunkIndex,
      endpoint: request.endpoint,
      bytes: request.payloadBytes,
      hash: request.chunkHash,
    })),
    payloadBytes: totalPayloadBytes,
    totalPayloadBytes,
    contentBytes: byteLength(params.text),
    sourceBytes: byteLength(params.text),
    sourceHash: sha256(params.text),
    reconstructedHash: sha256(reconstructedText),
    contentType: requests[0]?.body.body.contentType ?? resolveContentType(params),
    requests,
    rateLimitPlan: {
      minIntervalMs: GRAPH_NATIVE_TEXT_LIVE_MIN_INTERVAL_MS,
      scope: "per-chat-channel-user",
      note: "For live validation, send no faster than 1 request/sec per chat/channel/user.",
    },
    liveValidation: {
      minDelayMsPerConversationAndUser: GRAPH_NATIVE_TEXT_LIVE_MIN_INTERVAL_MS,
      rateLimitPlan: "Send no faster than 1 request/sec per chat/channel/user.",
      identityWarning,
    },
    identityWarning,
    fallbackPolicy: "native-text-only-no-artifact-card-file-link-fallback",
    noNetwork: true,
  };
}

export function buildGraphNativeTextEndpoint(route: GraphNativeTextRoute): string {
  return graphNativeTextEndpoint(route);
}

export function buildGraphNativeTextSendRequest(
  params: BuildGraphNativeTextDryRunParams,
): GraphNativeTextRequestDescriptor {
  const [request] = buildGraphNativeTextRequestDescriptors(params);
  if (!request) {
    throw new Error("Graph native text lane produced no request descriptor");
  }
  return request;
}

export function graphNativeTextEndpoint(route: GraphNativeTextRoute): string {
  switch (route.type) {
    case "chat":
      return `/chats/${encodeURIComponent(route.chatId)}/messages`;
    case "channel-root":
      return `/teams/${encodeURIComponent(route.teamId)}/channels/${encodeURIComponent(
        route.channelId,
      )}/messages`;
    case "channel-reply":
      return `/teams/${encodeURIComponent(route.teamId)}/channels/${encodeURIComponent(
        route.channelId,
      )}/messages/${encodeURIComponent(route.messageId)}/replies`;
  }
}

function assertNativeTextOnly(params: BuildGraphNativeTextDryRunParams): void {
  const forbiddenFallbacks = params.forbiddenFallbacks;
  if (
    forbiddenFallbacks?.artifact !== undefined ||
    forbiddenFallbacks?.card !== undefined ||
    forbiddenFallbacks?.file !== undefined ||
    forbiddenFallbacks?.link !== undefined
  ) {
    throw new Error("Graph native text lane rejects non-native fallback inputs");
  }
  if (params.attachments?.length) {
    throw new Error("Graph native text lane rejects non-native fallback inputs");
  }
  if (params.cards?.length) {
    throw new Error("Graph native text lane rejects non-native fallback inputs");
  }
  if (params.files?.length) {
    throw new Error("Graph native text lane rejects non-native fallback inputs");
  }
  if (params.links?.length) {
    throw new Error("Graph native text lane rejects non-native fallback inputs");
  }
}

function resolveContentType(params: BuildGraphNativeTextDryRunParams): GraphNativeTextContentType {
  const contentType = params.contentType ?? "text";
  if (contentType === "text") {
    return contentType;
  }
  if (contentType !== "html") {
    throw new Error(`Unsupported Graph native text contentType: ${String(contentType)}`);
  }
  if (!params.allowHtml || !params.htmlJustification?.trim()) {
    throw new Error("Graph native text lane requires explicit justification before HTML dry-runs");
  }
  return contentType;
}

function splitTextByGraphPayloadBytes(params: {
  text: string;
  contentType: GraphNativeTextContentType;
  maxPayloadBytes: number;
}): string[] {
  if (!params.text) {
    return [""];
  }

  const chunks: string[] = [];
  let offset = 0;
  while (offset < params.text.length) {
    const length = findFittingChunkLength(params.text.slice(offset), params);
    chunks.push(params.text.slice(offset, offset + length));
    offset += length;
  }
  return chunks;
}

function findFittingChunkLength(
  remaining: string,
  params: {
    contentType: GraphNativeTextContentType;
    maxPayloadBytes: number;
  },
): number {
  let low = 1;
  let high = remaining.length;
  let best = 0;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = remaining.slice(0, mid);
    const bytes = byteLength(JSON.stringify(graphNativeTextBody(params.contentType, candidate)));
    if (bytes <= params.maxPayloadBytes) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  if (best <= 0) {
    throw new Error(
      `Graph native text lane cannot fit a single character within ${params.maxPayloadBytes} bytes`,
    );
  }
  return best;
}

function graphNativeTextBody(contentType: GraphNativeTextContentType, content: string) {
  return {
    body: {
      contentType,
      content,
    },
  };
}

function resolveMaxPayloadBytes(value: number | undefined): number {
  if (value === undefined) {
    return GRAPH_NATIVE_TEXT_RECOMMENDED_MAX_BYTES;
  }
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Graph native text maxPayloadBytes must be a positive number");
  }
  return Math.floor(value);
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}
