import { createHash } from "node:crypto";
import {
  planTeamsTextWindowChunks,
  reconstructTeamsTextWindowChunks,
  stripTeamsTextWindowChunkChrome,
} from "./text-window-planner.js";

export type MSTeamsHardRulesDeliveryEvidence = {
  kind: "msteams-hard-rules-delivery-evidence";
  route: "ordinary-employee";
  conversationId: string;
  conversationType?: string;
  messageIds: string[];
  chunkCount: number;
  chunks: Array<{
    index: number;
    total: number;
    messageId: string;
    payloadHash: string;
    reconstructedHash: string;
    jsonUtf8Bytes: number;
    jsonUtf16Bytes: number;
    budgetBytes: number;
    overBudget: boolean;
    deliveryStatus: "delivered" | "missing";
  }>;
  sourceHash: string;
  reconstructedHash: string;
  hashesMatch: boolean;
  nativeTextChunksOnly: boolean;
  defaultArtifactRouteObserved: boolean;
  deliverySuccess: boolean;
  correlationId?: string;
  activityIdHash?: string;
  routeAgentId?: string;
  conversationIdHash?: string;
};

export function buildMSTeamsHardRulesDeliveryEvidence(params: {
  conversationId?: string;
  conversationType?: string;
  sourceText: string;
  messageIds: readonly string[];
  sentChunkTexts?: readonly string[];
  correlationId?: string;
  activityIdHash?: string;
  routeAgentId?: string;
  conversationIdHash?: string;
}): MSTeamsHardRulesDeliveryEvidence {
  const plan = planTeamsTextWindowChunks(params.sourceText);
  const messageIds = params.messageIds.filter((id) => id.trim() && id !== "unknown");
  const sentChunkTexts = params.sentChunkTexts ?? plan.chunks.map((chunk) => chunk.text);
  const chunks: MSTeamsHardRulesDeliveryEvidence["chunks"] = plan.chunks.map((chunk, index) => {
    const messageId = messageIds[index] ?? "missing";
    const reconstructedBody =
      sentChunkTexts[index] !== undefined
        ? stripTeamsTextWindowChunkChrome(sentChunkTexts[index]!)
        : "";
    return {
      index: chunk.index,
      total: chunk.total,
      messageId,
      payloadHash: sha256(chunk.body),
      reconstructedHash: sha256(reconstructedBody),
      jsonUtf8Bytes: chunk.measurement.jsonUtf8Bytes,
      jsonUtf16Bytes: chunk.measurement.jsonUtf16Bytes,
      budgetBytes: chunk.measurement.budgetBytes,
      overBudget: chunk.measurement.overBudget,
      deliveryStatus: messageId === "missing" ? "missing" : "delivered",
    };
  });
  const reconstructedText = reconstructTeamsTextWindowChunks([...sentChunkTexts]);
  const reconstructedHash =
    sentChunkTexts === params.sentChunkTexts
      ? planTeamsTextWindowChunks(reconstructedText).sourceHash
      : plan.reconstructedHash;
  const hashesMatch =
    plan.sourceHash === reconstructedHash &&
    reconstructedText === params.sourceText &&
    sentChunkTexts.length === plan.chunks.length;
  return {
    kind: "msteams-hard-rules-delivery-evidence",
    route: "ordinary-employee",
    conversationId: params.conversationId ?? "unknown",
    ...(params.conversationType ? { conversationType: params.conversationType } : {}),
    messageIds,
    chunkCount: plan.chunks.length,
    chunks,
    sourceHash: plan.sourceHash,
    reconstructedHash,
    hashesMatch,
    nativeTextChunksOnly: messageIds.length === plan.chunks.length && hashesMatch,
    defaultArtifactRouteObserved: false,
    deliverySuccess:
      messageIds.length === plan.chunks.length &&
      hashesMatch &&
      chunks.every((chunk) => !chunk.overBudget && chunk.messageId !== "missing"),
    ...(params.correlationId ? { correlationId: params.correlationId } : {}),
    ...(params.activityIdHash ? { activityIdHash: params.activityIdHash } : {}),
    ...(params.routeAgentId ? { routeAgentId: params.routeAgentId } : {}),
    ...(params.conversationIdHash ? { conversationIdHash: params.conversationIdHash } : {}),
  };
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
