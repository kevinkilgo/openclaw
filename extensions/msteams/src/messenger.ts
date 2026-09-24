import { readFile, writeFile } from "node:fs/promises";
import { PlatformMessageNotDispatchedError } from "openclaw/plugin-sdk/error-runtime";
import { isFutureDateTimestampMs } from "openclaw/plugin-sdk/number-runtime";
// Msteams plugin module implements messenger behavior.
import {
  isSilentReplyText,
  SILENT_REPLY_TOKEN,
  type ChunkMode,
} from "openclaw/plugin-sdk/reply-chunking";
import {
  resolveSendableOutboundReplyParts,
  type ReplyPayload,
} from "openclaw/plugin-sdk/reply-payload";
import { retryAsync } from "openclaw/plugin-sdk/retry-runtime";
import { sleepWithAbort } from "openclaw/plugin-sdk/runtime-env";
import { normalizeOptionalLowercaseString } from "openclaw/plugin-sdk/string-coerce-runtime";
import { loadWebMedia } from "openclaw/plugin-sdk/web-media";
import type {
  MarkdownTableMode,
  MSTeamsConfig,
  MSTeamsReplyStyle,
  OpenClawConfig,
} from "../runtime-api.js";
import type { MSTeamsAccessTokenProvider } from "./attachments/types.js";
import type { MSTeamsSdkCloudOptions } from "./cloud.js";
import type { StoredConversationReference } from "./conversation-store.js";
import { sendTeamsDeliveryArtifactActivity } from "./delivery-artifact.js";
import { sendTeamsActivityWithBudget } from "./delivery-budget.js";
import { classifyMSTeamsSendError } from "./errors.js";
import { prepareFileConsentActivity, requiresFileConsent } from "./file-consent-helpers.js";
import { formatMSTeamsMarkdown } from "./format.js";
import { buildTeamsFileInfoCard } from "./graph-chat.js";
import { sendGraphNativeTextLive } from "./graph-message-send.js";
import {
  getDriveItemProperties,
  requireMSTeamsSharePointSiteId,
  uploadAndShareSharePoint,
} from "./graph-upload.js";
import { extractFilename, extractMessageId, getMimeType, isLocalPath } from "./media-helpers.js";
import { buildMSTeamsMessageActivity } from "./message-activity.js";
import { refreshMSTeamsDelegatedTokens } from "./oauth.token.js";
import { setPendingUploadActivityId } from "./pending-uploads.js";
import { withRevokedProxyFallback } from "./revoked-context.js";
import { getMSTeamsRuntime } from "./runtime.js";
import { sendMSTeamsActivityWithReference } from "./sdk-proactive.js";
import type { MSTeamsActivityLike } from "./sdk-types.js";
import type { MSTeamsApp } from "./sdk.js";
import { resolveDelegatedAccessToken, resolveMSTeamsCredentials } from "./token.js";

/**
 * MSTeams-specific media size limit (100MB).
 * Higher than the default to support Teams file-consent and SharePoint uploads.
 */
const MSTEAMS_MAX_MEDIA_BYTES = 100 * 1024 * 1024;

/**
 * Threshold for large files that require FileConsentCard flow in personal chats.
 * Files >= 4MB use consent flow; smaller images can use inline base64.
 */
const FILE_CONSENT_THRESHOLD_BYTES = 4 * 1024 * 1024;

type MSTeamsConversationReference = {
  activityId?: string;
  user?: { id?: string; name?: string; aadObjectId?: string };
  agent?: { id?: string; name?: string; aadObjectId?: string } | null;
  conversation: { id: string; conversationType?: string; tenantId?: string };
  channelId: string;
  serviceUrl?: string;
  locale?: string;
  /**
   * Top-level tenant ID echoed onto the Bot Framework connector request. Included
   * alongside `conversation.tenantId` so the connector can route proactive sends
   * to the correct Azure AD tenant. Missing it causes HTTP 403 on proactive
   * (bot-initiated) messages.
   */
  tenantId?: string;
  /**
   * Azure AD object ID of the target user, forwarded on proactive sends so
   * Bot Framework can resolve the personal DM recipient on the connector side.
   */
  aadObjectId?: string;
};

type MSTeamsReplyRenderOptions = {
  textChunkLimit: number;
  chunkText?: boolean;
  mediaMode?: "split" | "inline";
  tableMode?: MarkdownTableMode;
  chunkMode?: ChunkMode;
};

/**
 * A rendered message that preserves media vs text distinction.
 * When mediaUrl is present, it will be sent as a Bot Framework attachment.
 */
export type MSTeamsRenderedMessage = {
  text?: string;
  mediaUrl?: string;
};

type MSTeamsSendRetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
};

type MSTeamsSendRetryEvent = {
  messageIndex: number;
  messageCount: number;
  nextAttempt: number;
  maxAttempts: number;
  delayMs: number;
  classification: ReturnType<typeof classifyMSTeamsSendError>;
};

type GraphNativeLongTextSettings = {
  enabled: boolean;
  allowedConversationIds: Set<string>;
  chatIdByConversationId: Map<string, string>;
  minTextBytes: number;
  maxPayloadBytes: number;
  tokenFile?: string;
};

type GraphNativeTokenFile = {
  accessToken?: string;
  access_token?: string;
  expiresAt?: number;
  expires_at?: number;
  refreshToken?: string;
  refresh_token?: string;
  scope?: string;
  scopes?: string[];
};

function envFlagEnabled(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

function splitEnvList(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[\n,]/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function resolveEnvNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseGraphNativeChatMap(value: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!value?.trim()) {
    return out;
  }
  try {
    // SAFETY: JSON.parse returns unknown; runtime shape guards below reject non-object maps.
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      // SAFETY: The parsed object shape is validated entry-by-entry before use.
      for (const [conversationId, chatId] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof chatId === "string" && conversationId.trim() && chatId.trim()) {
          out.set(conversationId.trim(), chatId.trim());
        }
      }
    }
  } catch {
    for (const entry of splitEnvList(value)) {
      const [conversationId, ...chatIdParts] = entry.split("=");
      const chatId = chatIdParts.join("=");
      if (conversationId?.trim() && chatId.trim()) {
        out.set(conversationId.trim(), chatId.trim());
      }
    }
  }
  return out;
}

function resolveGraphNativeLongTextSettings(env = process.env): GraphNativeLongTextSettings {
  return {
    enabled: envFlagEnabled(env.OPENCLAW_MSTEAMS_GRAPH_NATIVE_LONG_TEXT_ENABLED),
    allowedConversationIds: new Set(
      splitEnvList(env.OPENCLAW_MSTEAMS_GRAPH_NATIVE_LONG_TEXT_ALLOWED_CONVERSATION_IDS),
    ),
    chatIdByConversationId: parseGraphNativeChatMap(
      env.OPENCLAW_MSTEAMS_GRAPH_NATIVE_LONG_TEXT_CHAT_MAP,
    ),
    minTextBytes: resolveEnvNumber(
      env.OPENCLAW_MSTEAMS_GRAPH_NATIVE_LONG_TEXT_MIN_BYTES,
      80 * 1024,
    ),
    maxPayloadBytes: resolveEnvNumber(
      env.OPENCLAW_MSTEAMS_GRAPH_NATIVE_LONG_TEXT_MAX_PAYLOAD_BYTES,
      90 * 1024,
    ),
    tokenFile: env.OPENCLAW_MSTEAMS_GRAPH_NATIVE_TOKEN_FILE?.trim() || undefined,
  };
}

function resolveGraphNativeTokenFileExpiresAtMs(parsed: GraphNativeTokenFile): number | undefined {
  const expiresAt = parsed.expiresAt;
  if (Number.isFinite(expiresAt)) {
    return expiresAt;
  }
  const expiresAtSeconds = parsed.expires_at;
  if (Number.isFinite(expiresAtSeconds)) {
    return expiresAtSeconds * 1000;
  }
  return undefined;
}

function resolveGraphNativeTokenFileScopes(parsed: GraphNativeTokenFile): string[] | undefined {
  if (Array.isArray(parsed.scopes) && parsed.scopes.every((scope) => typeof scope === "string")) {
    return parsed.scopes;
  }
  if (typeof parsed.scope === "string" && parsed.scope.trim()) {
    return parsed.scope.split(/\s+/u).filter(Boolean);
  }
  return undefined;
}

async function readGraphNativeTokenFile(params: {
  path: string | undefined;
  credentials?: Extract<ReturnType<typeof resolveMSTeamsCredentials>, { type: "secret" }>;
}): Promise<string | undefined> {
  const path = params.path;
  if (!path) {
    return undefined;
  }
  const raw = await readFile(path, "utf8");
  // SAFETY: Token-file fields are read as optional strings and validated before return.
  const parsed = JSON.parse(raw) as GraphNativeTokenFile;
  const token = parsed.accessToken ?? parsed.access_token;
  const expiresAtMs = resolveGraphNativeTokenFileExpiresAtMs(parsed);
  if (typeof token === "string" && token.trim() && isFutureDateTimestampMs(expiresAtMs)) {
    return token.trim();
  }

  const refreshToken = parsed.refreshToken ?? parsed.refresh_token;
  if (!params.credentials || typeof refreshToken !== "string" || !refreshToken.trim()) {
    return typeof token === "string" && token.trim() ? token.trim() : undefined;
  }

  const refreshed = await refreshMSTeamsDelegatedTokens({
    tenantId: params.credentials.tenantId,
    clientId: params.credentials.appId,
    refreshToken: refreshToken.trim(),
    scopes: resolveGraphNativeTokenFileScopes(parsed),
  });
  const nextPayload = {
    ...parsed,
    accessToken: refreshed.accessToken,
    access_token: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    refresh_token: refreshed.refreshToken,
    expiresAt: refreshed.expiresAt,
    expires_at: Math.floor(refreshed.expiresAt / 1000),
    scope: refreshed.scopes.join(" "),
    scopes: refreshed.scopes,
  };
  await writeFile(path, `${JSON.stringify(nextPayload, null, 2)}\n`, "utf8");
  return refreshed.accessToken;
}

async function resolveGraphNativeDelegatedToken(params: {
  msteamsConfig?: MSTeamsConfig;
  settings: GraphNativeLongTextSettings;
}): Promise<string | undefined> {
  const creds = resolveMSTeamsCredentials(params.msteamsConfig);
  if (params.settings.tokenFile) {
    const token = await readGraphNativeTokenFile({
      path: params.settings.tokenFile,
      credentials: creds?.type === "secret" ? creds : undefined,
    });
    if (token) {
      return token;
    }
  }
  if (creds?.type === "secret") {
    const token = await resolveDelegatedAccessToken({
      tenantId: creds.tenantId,
      clientId: creds.appId,
      clientSecret: creds.appPassword,
    });
    if (token) {
      return token;
    }
  }
  return undefined;
}

function shouldUseGraphNativeLongText(params: {
  settings: GraphNativeLongTextSettings;
  conversationId: string;
  conversationType?: string;
  message: MSTeamsRenderedMessage;
}): { graphChatId: string } | undefined {
  if (!params.settings.enabled || params.message.mediaUrl || !params.message.text) {
    return undefined;
  }
  if (normalizeOptionalLowercaseString(params.conversationType) !== "personal") {
    return undefined;
  }
  if (!params.settings.allowedConversationIds.has(params.conversationId)) {
    return undefined;
  }
  if (Buffer.byteLength(params.message.text, "utf8") < params.settings.minTextBytes) {
    return undefined;
  }
  const graphChatId = params.settings.chatIdByConversationId.get(params.conversationId);
  return graphChatId ? { graphChatId } : undefined;
}

function normalizeConversationId(rawId: string): string {
  return rawId.split(";")[0] ?? rawId;
}

export function buildConversationReference(
  ref: StoredConversationReference,
): MSTeamsConversationReference {
  const conversationId = ref.conversation?.id?.trim();
  if (!conversationId) {
    throw new Error("Invalid stored reference: missing conversation.id");
  }
  // Legacy imported rows may only carry `bot`; see StoredConversationReference.bot.
  const agent = ref.agent ?? ref.bot ?? undefined;
  if (agent == null || !agent.id) {
    throw new Error("Invalid stored reference: missing agent.id");
  }
  const user = ref.user;
  if (!user?.id) {
    throw new Error("Invalid stored reference: missing user.id");
  }
  // Bot Framework proactive sends require `tenantId` on the outbound activity
  // so the connector routes to the correct Azure AD tenant; otherwise it rejects
  // with HTTP 403. Prefer the explicit top-level `ref.tenantId` (captured from
  // `channelData.tenant.id` inbound) and fall back to `conversation.tenantId`.
  const tenantId = ref.tenantId ?? ref.conversation?.tenantId;
  const aadObjectId = ref.aadObjectId ?? user.aadObjectId;
  return {
    activityId: ref.activityId,
    user: aadObjectId ? { ...user, aadObjectId } : user,
    agent,
    conversation: {
      id: normalizeConversationId(conversationId),
      conversationType: ref.conversation?.conversationType,
      tenantId,
    },
    channelId: ref.channelId ?? "msteams",
    serviceUrl: ref.serviceUrl,
    locale: ref.locale,
    ...(tenantId ? { tenantId } : {}),
    ...(aadObjectId ? { aadObjectId } : {}),
  };
}

function pushTextMessages(
  out: MSTeamsRenderedMessage[],
  text: string,
  opts: {
    chunkText: boolean;
    chunkLimit: number;
    chunkMode: ChunkMode;
  },
) {
  if (!text) {
    return;
  }
  if (opts.chunkText) {
    for (const chunk of getMSTeamsRuntime().channel.text.chunkMarkdownTextWithMode(
      text,
      opts.chunkLimit,
      opts.chunkMode,
    )) {
      const trimmed = chunk.trim();
      if (!trimmed || isSilentReplyText(trimmed, SILENT_REPLY_TOKEN)) {
        continue;
      }
      out.push({ text: trimmed });
    }
    return;
  }

  const trimmed = text.trim();
  if (!trimmed || isSilentReplyText(trimmed, SILENT_REPLY_TOKEN)) {
    return;
  }
  out.push({ text: trimmed });
}

function clampMs(value: number, maxMs: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.min(value, maxMs);
}

function resolveRetryOptions(
  retry: false | MSTeamsSendRetryOptions | undefined,
): Required<MSTeamsSendRetryOptions> & { enabled: boolean } {
  if (!retry) {
    return { enabled: false, maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 };
  }
  return {
    enabled: true,
    maxAttempts: Math.max(1, retry?.maxAttempts ?? 3),
    baseDelayMs: Math.max(0, retry?.baseDelayMs ?? 250),
    maxDelayMs: Math.max(0, retry?.maxDelayMs ?? 10_000),
  };
}

function computeRetryDelayMs(
  attempt: number,
  classification: ReturnType<typeof classifyMSTeamsSendError>,
  opts: Required<MSTeamsSendRetryOptions>,
): number {
  if (classification.kind === "replay-safe" && classification.retryAfterMs != null) {
    return clampMs(classification.retryAfterMs, opts.maxDelayMs);
  }
  const exponential = opts.baseDelayMs * 2 ** Math.max(0, attempt - 1);
  return clampMs(exponential, opts.maxDelayMs);
}

export function renderReplyPayloadsToMessages(
  replies: ReplyPayload[],
  options: MSTeamsReplyRenderOptions,
): MSTeamsRenderedMessage[] {
  const out: MSTeamsRenderedMessage[] = [];
  const chunkLimit = Math.min(options.textChunkLimit, 2500);
  const chunkText = options.chunkText !== false;
  const chunkMode = options.chunkMode ?? "length";
  const mediaMode = options.mediaMode ?? "split";
  const tableMode =
    options.tableMode ??
    getMSTeamsRuntime().channel.text.resolveMarkdownTableMode({
      // SAFETY: The runtime config object is the canonical OpenClaw config shape at this boundary.
      cfg: getMSTeamsRuntime().config.current() as OpenClawConfig,
      channel: "msteams",
    });

  for (const payload of replies) {
    const reply = resolveSendableOutboundReplyParts(payload, {
      text: formatMSTeamsMarkdown(payload.text ?? "", tableMode),
    });

    if (!reply.hasContent) {
      continue;
    }

    if (!reply.hasMedia) {
      pushTextMessages(out, reply.text, { chunkText, chunkLimit, chunkMode });
      continue;
    }

    if (mediaMode === "inline") {
      // For inline mode, combine text with first media as attachment
      const firstMedia = reply.mediaUrls[0];
      if (firstMedia) {
        out.push({ text: reply.text || undefined, mediaUrl: firstMedia });
        // Additional media URLs as separate messages
        for (let i = 1; i < reply.mediaUrls.length; i++) {
          if (reply.mediaUrls[i]) {
            out.push({ mediaUrl: reply.mediaUrls[i] });
          }
        }
      } else {
        pushTextMessages(out, reply.text, { chunkText, chunkLimit, chunkMode });
      }
      continue;
    }

    // mediaMode === "split"
    pushTextMessages(out, reply.text, { chunkText, chunkLimit, chunkMode });
    for (const mediaUrl of reply.mediaUrls) {
      if (!mediaUrl) {
        continue;
      }
      out.push({ mediaUrl });
    }
  }

  return out;
}

async function buildActivity(
  msg: MSTeamsRenderedMessage,
  conversationRef: StoredConversationReference,
  tokenProvider?: MSTeamsAccessTokenProvider,
  sharePointSiteId?: string,
  mediaMaxBytes?: number,
  options?: { feedbackLoopEnabled?: boolean },
): Promise<Record<string, unknown>> {
  const activity: Record<string, unknown> = buildMSTeamsMessageActivity(msg.text);

  // Mark as AI-generated so Teams renders the "AI generated" badge.
  activity.channelData = {
    feedbackLoopEnabled: options?.feedbackLoopEnabled ?? false,
  };

  if (msg.mediaUrl) {
    let contentUrl = msg.mediaUrl;
    let contentType = await getMimeType(msg.mediaUrl);
    let fileName = await extractFilename(msg.mediaUrl);

    if (isLocalPath(msg.mediaUrl)) {
      const maxBytes = mediaMaxBytes ?? MSTEAMS_MAX_MEDIA_BYTES;
      const media = await loadWebMedia(msg.mediaUrl, maxBytes);
      contentType = media.contentType ?? contentType;
      fileName = media.fileName ?? fileName;

      // Determine conversation type and file type
      // Teams only accepts base64 data URLs for images
      const conversationType = normalizeOptionalLowercaseString(
        conversationRef.conversation?.conversationType,
      );
      const isPersonal = conversationType === "personal";
      const isImage = media.kind === "image";

      if (
        requiresFileConsent({
          conversationType,
          contentType,
          bufferSize: media.buffer.length,
          thresholdBytes: FILE_CONSENT_THRESHOLD_BYTES,
        })
      ) {
        // Large file or non-image in personal chat: use FileConsentCard flow
        const conversationId = conversationRef.conversation?.id ?? "unknown";
        const { activity: consentActivity, uploadId } = prepareFileConsentActivity({
          media: { buffer: media.buffer, filename: fileName, contentType },
          conversationId,
          description: msg.text || undefined,
        });

        // Tag the activity so the caller can store the activity ID after sending
        consentActivity["_pendingUploadId"] = uploadId;

        // Return the consent activity (caller sends it)
        return consentActivity;
      }

      if (!isPersonal && !isImage) {
        // Non-images in group chats/channels require SharePoint because an
        // application token has no signed-in `/me/drive` to fall back to.
        const siteId = requireMSTeamsSharePointSiteId(sharePointSiteId);
        if (!tokenProvider) {
          throw new Error("MS Teams Graph token provider unavailable for SharePoint file send");
        }
        const chatId = conversationRef.conversation?.id;

        const uploaded = await uploadAndShareSharePoint({
          buffer: media.buffer,
          filename: fileName,
          contentType,
          tokenProvider,
          siteId,
          chatId: chatId ?? undefined,
          usePerUserSharing: conversationType === "groupchat",
        });

        const driveItem = await getDriveItemProperties({
          siteId,
          itemId: uploaded.itemId,
          tokenProvider,
        });

        // Build native Teams file card attachment
        const fileCardAttachment = buildTeamsFileInfoCard(driveItem);
        activity.attachments = [fileCardAttachment];

        return activity;
      }

      // Image (any chat): use base64 (works for images in all conversation types)
      const base64 = media.buffer.toString("base64");
      contentUrl = `data:${media.contentType};base64,${base64}`;
    }

    activity.attachments = [
      {
        name: fileName,
        contentType,
        contentUrl,
      },
    ];
  }

  return activity;
}

export async function sendMSTeamsMessages(params: {
  replyStyle: MSTeamsReplyStyle;
  app: MSTeamsApp;
  appId: string;
  conversationRef: StoredConversationReference;
  context?: { sendActivity: (activity: MSTeamsActivityLike) => Promise<unknown> };
  messages: MSTeamsRenderedMessage[];
  retry?: false | MSTeamsSendRetryOptions;
  onRetry?: (event: MSTeamsSendRetryEvent) => void;
  /** Token provider for SharePoint uploads in group chats/channels */
  tokenProvider?: MSTeamsAccessTokenProvider;
  /** SharePoint site ID for file uploads in group chats/channels */
  sharePointSiteId?: string;
  /** Max media size in bytes. Default: 100MB. */
  mediaMaxBytes?: number;
  /** Enable the Teams feedback loop (thumbs up/down) on sent messages. */
  feedbackLoopEnabled?: boolean;
  serviceUrlBoundary?: MSTeamsSdkCloudOptions;
  msteamsConfig?: MSTeamsConfig;
}): Promise<string[]> {
  const messages = params.messages.filter(
    (m) => (m.text && m.text.trim().length > 0) || m.mediaUrl,
  );
  if (messages.length === 0) {
    return [];
  }

  const retryOptions = resolveRetryOptions(params.retry);

  const sendWithRetry = async (
    sendOnce: () => Promise<unknown>,
    meta: { messageIndex: number; messageCount: number },
  ): Promise<unknown> => {
    if (!retryOptions.enabled) {
      return await sendOnce();
    }

    return await retryAsync(sendOnce, {
      attempts: retryOptions.maxAttempts,
      minDelayMs: 0,
      maxDelayMs: retryOptions.maxDelayMs,
      shouldRetry: (err) => classifyMSTeamsSendError(err).kind === "replay-safe",
      delayMs: ({ attempt, err }) =>
        computeRetryDelayMs(attempt, classifyMSTeamsSendError(err), retryOptions),
      onRetry: ({ attempt, err, delayMs }) => {
        params.onRetry?.({
          messageIndex: meta.messageIndex,
          messageCount: meta.messageCount,
          nextAttempt: attempt + 1,
          maxAttempts: retryOptions.maxAttempts,
          delayMs,
          classification: classifyMSTeamsSendError(err),
        });
      },
      sleep: (delayMs) => sleepWithAbort(delayMs),
    });
  };

  let providerDispatchStarted = false;
  const sendMessageInContext = async (
    sendFn: (activity: MSTeamsActivityLike) => Promise<unknown>,
    message: MSTeamsRenderedMessage,
    messageIndex: number,
  ): Promise<string[]> => {
    let activity: Record<string, unknown> | undefined;
    let pendingUploadId: string | undefined;
    let response: unknown;
    try {
      response = await sendWithRetry(
        async () => {
          // Retry failed preparation, but keep its successful I/O and SharePoint work
          // out of subsequent provider retries.
          activity ??= await buildActivity(
            message,
            params.conversationRef,
            params.tokenProvider,
            params.sharePointSiteId,
            params.mediaMaxBytes,
            { feedbackLoopEnabled: params.feedbackLoopEnabled },
          );

          pendingUploadId ??=
            typeof activity["_pendingUploadId"] === "string"
              ? activity["_pendingUploadId"]
              : undefined;
          delete activity["_pendingUploadId"];

          const delivered = await sendTeamsActivityWithBudget({
            activity,
            send: async (budgetedActivity) => {
              providerDispatchStarted = true;
              return await sendFn(budgetedActivity);
            },
          });
          let artifactMessageId: string | undefined;
          if (delivered.budgeted.kind === "artifact-digest") {
            artifactMessageId = await sendTeamsDeliveryArtifactActivity({
              artifact: delivered.budgeted.artifact,
              conversationId: params.conversationRef.conversation?.id ?? "unknown",
              conversationType: params.conversationRef.conversation?.conversationType,
              tokenProvider: params.tokenProvider,
              sharePointSiteId: params.sharePointSiteId,
              send: async (artifactActivity) => {
                providerDispatchStarted = true;
                return await sendFn(artifactActivity);
              },
            });
          }
          return { delivered: delivered.result, artifactMessageId };
        },
        {
          messageIndex,
          messageCount: messages.length,
        },
      );
    } catch (error) {
      if (!providerDispatchStarted) {
        throw new PlatformMessageNotDispatchedError(
          error instanceof Error ? error.message : "Teams activity preparation failed",
          { cause: error },
        );
      }
      throw error;
    }
    // SAFETY: The adapter response shape is probed by optional fields and falls back to the raw response.
    const responseRecord = response as { delivered?: unknown; artifactMessageId?: string };
    const messageId = extractMessageId(responseRecord.delivered ?? response) ?? "unknown";

    // Store the activity ID so the accept handler can replace the consent card in-place
    if (pendingUploadId && messageId !== "unknown") {
      setPendingUploadActivityId(pendingUploadId, messageId);
    }

    return [messageId, responseRecord.artifactMessageId].filter((id): id is string =>
      Boolean(id && id !== "unknown"),
    );
  };

  const graphNativeLongTextSettings = resolveGraphNativeLongTextSettings();

  const sendGraphNativeLongTextIfEnabled = async (
    message: MSTeamsRenderedMessage,
  ): Promise<string[] | undefined> => {
    const conversationId = params.conversationRef.conversation?.id?.trim();
    if (!conversationId) {
      return undefined;
    }
    const plan = shouldUseGraphNativeLongText({
      settings: graphNativeLongTextSettings,
      conversationId,
      conversationType: params.conversationRef.conversation?.conversationType,
      message,
    });
    if (!plan || !message.text) {
      return undefined;
    }
    const token = await resolveGraphNativeDelegatedToken({
      msteamsConfig: params.msteamsConfig,
      settings: graphNativeLongTextSettings,
    });
    if (!token) {
      return undefined;
    }
    const sent = await sendGraphNativeTextLive({
      route: { type: "chat", chatId: plan.graphChatId },
      text: message.text,
      token,
      maxPayloadBytes: graphNativeLongTextSettings.maxPayloadBytes,
    });
    return sent.messageIds.length > 0 ? sent.messageIds : ["unknown"];
  };

  const sendMessageBatchInContext = async (
    sendFn: (activity: MSTeamsActivityLike) => Promise<unknown>,
    batch: MSTeamsRenderedMessage[],
    startIndex: number,
  ): Promise<string[]> => {
    const messageIds: string[] = [];
    let messageIndex = startIndex;
    for (const message of batch) {
      const graphNativeMessageIds = await sendGraphNativeLongTextIfEnabled(message);
      if (graphNativeMessageIds) {
        messageIds.push(...graphNativeMessageIds);
        messageIndex += graphNativeMessageIds.length;
        continue;
      }
      messageIds.push(...(await sendMessageInContext(sendFn, message, messageIndex)));
      messageIndex += 1;
    }
    return messageIds;
  };

  const sendProactively = async (
    batch: MSTeamsRenderedMessage[],
    startIndex: number,
    threadActivityId?: string,
  ): Promise<string[]> => {
    let baseRef: MSTeamsConversationReference;
    try {
      baseRef = buildConversationReference(params.conversationRef);
    } catch (error) {
      if (providerDispatchStarted) {
        throw error;
      }
      throw new PlatformMessageNotDispatchedError(
        error instanceof Error ? error.message : "Teams conversation preparation failed",
        { cause: error },
      );
    }
    const isChannel = params.conversationRef.conversation?.conversationType === "channel";
    const sendFn = (activity: MSTeamsActivityLike) =>
      sendMSTeamsActivityWithReference(params.app, baseRef, activity, {
        threadActivityId: isChannel ? threadActivityId : undefined,
        serviceUrlBoundary: params.serviceUrlBoundary,
      });
    return await sendMessageBatchInContext(sendFn, batch, startIndex);
  };

  // Resolve the thread root message ID for channel thread routing.
  // `threadId` is the canonical thread root (set on inbound for channel threads);
  // fall back to `activityId` for backward compatibility with older stored refs.
  const resolvedThreadId = params.conversationRef.threadId ?? params.conversationRef.activityId;

  if (params.replyStyle === "thread") {
    const ctx = params.context;
    if (!ctx) {
      return await sendProactively(messages, 0, resolvedThreadId);
    }
    const sendFn = ctx.sendActivity;
    const messageIds: string[] = [];
    for (const [idx, message] of messages.entries()) {
      const result = await withRevokedProxyFallback({
        run: async () => ({
          ids: await sendMessageBatchInContext(sendFn, [message], idx),
          fellBack: false,
        }),
        onRevoked: async () => {
          // When the live turn context is revoked (e.g. debounced messages),
          // reconstruct the threaded conversation ID so the proactive
          // fallback delivers the reply into the correct channel thread.
          const remaining = messages.slice(idx);
          return {
            ids:
              remaining.length > 0 ? await sendProactively(remaining, idx, resolvedThreadId) : [],
            fellBack: true,
          };
        },
      });
      messageIds.push(...result.ids);
      if (result.fellBack) {
        return messageIds;
      }
    }
    return messageIds;
  }

  // replyStyle === "top-level" — explicit "post at the top of the channel"
  // intent. Do NOT add the thread suffix even when the stored ref has a
  // threadId; threading on a top-level send would defeat the operator's
  // explicit choice. Threaded sends route through the `replyStyle === "thread"`
  // branch above (which already passes resolvedThreadId on the proactive
  // fallback when the live turn context is revoked, preserving #55198).
  return await sendProactively(messages, 0);
}
