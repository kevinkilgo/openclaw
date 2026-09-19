# PR #18 Hard-Rules Controlled Validation - 2026-09-19T02:49Z

## State

PARTIAL / NOT READY.

The ordinary employee Teams inbound route now has local source/test evidence for `onHardRulesDeliveryEvidence` wiring after Artemis added the missing message-handler pass-through during the 03:12Z heartbeat reconciliation.

This is not final acceptance evidence. Controlled runtime delivery and Teams desktop/web rendering proof through `kkilgo@ftsc.com` are still missing.

## Local Implementation Evidence

Observed and updated worktree:

- `/home/oc_admin/.openclaw/workspace/source/openclaw-pr18-text-window-first`
- Local commit: `345aa88ab07` (`Wire Teams hard-rules evidence recorder`).

Relevant local changes:

- `extensions/msteams/src/monitor.ts` creates `createMSTeamsHardRulesEvidenceRecorder({ runtime, log })`.
- `extensions/msteams/src/monitor-handler.types.ts` includes `onHardRulesDeliveryEvidence`.
- `extensions/msteams/src/monitor-handler/message-handler.ts` passes `deps.onHardRulesDeliveryEvidence` into `dispatchMSTeamsInboundTurn`.
- `extensions/msteams/src/monitor-handler/inbound-dispatch.ts` passes `params.onHardRulesDeliveryEvidence` into `createMSTeamsReplyDispatcher`.
- `extensions/msteams/src/hard-rules-evidence-recorder.ts` persists emitted evidence under OpenClaw state artifacts.
- `extensions/msteams/src/employee-container-dispatch.test.ts` covers ordinary employee-route hook wiring.

## Validation

Command:

```text
pnpm exec vitest run extensions/msteams/src/employee-container-dispatch.test.ts extensions/msteams/src/reply-dispatcher.test.ts
```

Result:

```text
Test Files  2 passed (2)
Tests  75 passed (75)
```

Important note: before the pass-through fix, the focused test failed because `onHardRulesDeliveryEvidence` reached the reply dispatcher as `undefined`. After adding the message-handler pass-through, the same focused test set passed.

## Remaining Blockers

- Local changes are committed but unpublished; `git push origin pr-18` failed with `fatal: could not read Username for 'https://github.com': No such device or address`.
- The controlled ordinary employee-route runtime invocation through `kkilgo@ftsc.com` has not been run.
- Required per-chunk message IDs, chunk count/order, payload sizes, delivery status, hashes, and no-default-attachment/card/file/document/digest/open-link proof have not been captured from the controlled run.
- Teams desktop and authenticated Teams web rendering proof showing no truncation and no silent ellipses remains missing.

## Guardrails

No production deploys, service restarts, production mutations, secret changes, or Teams messages outside the authorized `kkilgo@ftsc.com` controlled validation lane were performed while producing this artifact.
