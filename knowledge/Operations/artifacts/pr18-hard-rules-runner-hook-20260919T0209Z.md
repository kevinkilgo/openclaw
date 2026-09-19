# PR #18 Hard-Rules Runner Hook - 2026-09-19T02:09Z

STATUS: COMPLETED

OWNER: Justin

CURRENT_BLOCKER: None for source/local evidence hook. Controlled runtime proof is still not collected until Richard/Artemis run the `kkilgo@ftsc.com` lane and capture Teams desktop/web rendering.

IMPLEMENTATION_COMMIT: `b8ada31425e`

## Changed Files

- `extensions/msteams/src/hard-rules-evidence.ts`
- `extensions/msteams/src/reply-dispatcher.ts`
- `extensions/msteams/src/reply-dispatcher.test.ts`
- `knowledge/Operations/artifacts/pr18-hard-rules-runner-hook-20260919T0209Z.md`

## Hook Summary

The ordinary Teams employee reply dispatcher now accepts `onHardRulesDeliveryEvidence`. After a successful settled delivery, it emits `MSTeamsHardRulesDeliveryEvidence` built from the actual delivered ordinary reply content and Teams message IDs.

Evidence fields exposed for controlled validation:

- `route`: fixed to `ordinary-employee`
- `conversationId` and `conversationType`
- `messageIds`: accepted Teams message ID for every delivered native text chunk
- `chunkCount`
- `chunks[]`: chunk index/order, total, message ID, JSON UTF-8 bytes, JSON UTF-16 bytes, budget bytes, and `overBudget`
- `sourceHash` and `reconstructedHash`
- `hashesMatch`
- `nativeTextChunksOnly`
- `defaultArtifactRouteObserved`: `false` for this ordinary text route
- `deliverySuccess`

The hook does not send Teams messages by itself and does not deploy/restart/mutate production/change secrets.

## Validation

Command:

```bash
pnpm vitest run --config test/vitest/vitest.extension-msteams.config.ts extensions/msteams/src/reply-dispatcher.test.ts extensions/msteams/src/text-window-planner.test.ts extensions/msteams/src/messenger.test.ts
```

Result:

```text
Test Files  3 passed (3)
Tests       116 passed (116)
```

The new regression is `createMSTeamsReplyDispatcher > records hard-rules delivery evidence for ordinary long block replies`.

## Next Action

Richard/Artemis should run the controlled ordinary employee long-answer validation through `kkilgo@ftsc.com` with this local commit, wiring the dispatcher `onHardRulesDeliveryEvidence` callback to persist the emitted object for the run. Capture:

- Native Teams text chunks only.
- Per-chunk Teams message IDs.
- Chunk count and order.
- Payload sizes under the Teams 80 KB activity budget.
- Delivery success.
- Source/reconstructed SHA-256 after deterministic chunk headers are stripped.
- No default artifact/file/card/document/digest/open-link route for routine answers.
- Teams desktop rendering proof showing no truncation and no silent ellipses.
- Authenticated Teams web rendering proof showing no truncation and no silent ellipses.
- 429 backoff evidence if rate limiting is triggered.

No live Teams messages were sent by Justin while creating this artifact.
