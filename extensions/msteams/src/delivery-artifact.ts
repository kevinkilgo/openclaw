// Msteams helper module delivers full response artifacts through Teams-native files.
import { readFile } from "node:fs/promises";
import type { MSTeamsAccessTokenProvider } from "./attachments/types.js";
import type { TeamsDeliveryArtifact } from "./delivery-budget.js";
import {
  prepareFileConsentActivity,
  prepareFileConsentActivityFs,
} from "./file-consent-helpers.js";
import { buildTeamsFileInfoCard } from "./graph-chat.js";
import {
  getDriveItemProperties,
  requireMSTeamsSharePointSiteId,
  uploadAndShareSharePoint,
} from "./graph-upload.js";
import { extractMessageId } from "./media-helpers.js";
import { setPendingUploadActivityIdFs } from "./pending-uploads-fs.js";
import { setPendingUploadActivityId } from "./pending-uploads.js";
import type { MSTeamsActivityLike } from "./sdk-types.js";

const FULL_RESPONSE_FILENAME = "openclaw-full-response.md";
const FULL_RESPONSE_CONTENT_TYPE = "text/markdown; charset=utf-8";
const FULL_RESPONSE_DESCRIPTION = "Full response from OpenClaw.";

export async function sendTeamsDeliveryArtifactActivity(params: {
  artifact: TeamsDeliveryArtifact;
  conversationId: string;
  conversationType?: string;
  tokenProvider?: MSTeamsAccessTokenProvider;
  sharePointSiteId?: string;
  send: (activity: MSTeamsActivityLike) => Promise<unknown>;
  fsBackedFileConsent?: boolean;
}): Promise<string> {
  const buffer = await readFile(params.artifact.artifactPath);
  const conversationType = params.conversationType?.toLowerCase();
  if (conversationType === "personal") {
    const prepare = params.fsBackedFileConsent
      ? prepareFileConsentActivityFs
      : async (prepareParams: Parameters<typeof prepareFileConsentActivity>[0]) =>
          prepareFileConsentActivity(prepareParams);
    const { activity, uploadId } = await prepare({
      media: {
        buffer,
        filename: FULL_RESPONSE_FILENAME,
        contentType: FULL_RESPONSE_CONTENT_TYPE,
      },
      conversationId: params.conversationId,
      description: FULL_RESPONSE_DESCRIPTION,
    });
    const result = await params.send(activity);
    const messageId = extractMessageId(result) ?? "unknown";
    if (messageId !== "unknown") {
      setPendingUploadActivityId(uploadId, messageId);
      if (params.fsBackedFileConsent) {
        await setPendingUploadActivityIdFs(uploadId, messageId);
      }
    }
    return messageId;
  }

  const siteId = requireMSTeamsSharePointSiteId(params.sharePointSiteId);
  if (!params.tokenProvider) {
    throw new Error("MS Teams Graph token provider unavailable for artifact file send");
  }
  const uploaded = await uploadAndShareSharePoint({
    buffer,
    filename: FULL_RESPONSE_FILENAME,
    contentType: FULL_RESPONSE_CONTENT_TYPE,
    tokenProvider: params.tokenProvider,
    siteId,
    chatId: params.conversationId,
    usePerUserSharing: conversationType === "groupchat",
  });
  const driveItem = await getDriveItemProperties({
    siteId,
    itemId: uploaded.itemId,
    tokenProvider: params.tokenProvider,
  });
  const result = await params.send({
    type: "message",
    text: "Full response attached.",
    attachments: [buildTeamsFileInfoCard(driveItem)],
  });
  return extractMessageId(result) ?? "unknown";
}
