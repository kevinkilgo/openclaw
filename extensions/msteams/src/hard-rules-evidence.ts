import {
  planTeamsTextWindowChunks,
  reconstructTeamsTextWindowChunks,
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
    jsonUtf8Bytes: number;
    jsonUtf16Bytes: number;
    budgetBytes: number;
    overBudget: boolean;
  }>;
  sourceHash: string;
  reconstructedHash: string;
  hashesMatch: boolean;
  nativeTextChunksOnly: boolean;
  defaultArtifactRouteObserved: boolean;
  deliverySuccess: boolean;
};

export function buildMSTeamsHardRulesDeliveryEvidence(params: {
  conversationId?: string;
  conversationType?: string;
  sourceText: string;
  messageIds: readonly string[];
}): MSTeamsHardRulesDeliveryEvidence {
  const plan = planTeamsTextWindowChunks(params.sourceText);
  const messageIds = params.messageIds.filter((id) => id.trim() && id !== "unknown");
  const chunks = plan.chunks.map((chunk, index) => ({
    index: chunk.index,
    total: chunk.total,
    messageId: messageIds[index] ?? "missing",
    jsonUtf8Bytes: chunk.measurement.jsonUtf8Bytes,
    jsonUtf16Bytes: chunk.measurement.jsonUtf16Bytes,
    budgetBytes: chunk.measurement.budgetBytes,
    overBudget: chunk.measurement.overBudget,
  }));
  const reconstructedHash = plan.reconstructedHash;
  const hashesMatch =
    plan.sourceHash === reconstructedHash &&
    reconstructTeamsTextWindowChunks(plan.chunks.map((chunk) => chunk.text)) === params.sourceText;
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
  };
}
