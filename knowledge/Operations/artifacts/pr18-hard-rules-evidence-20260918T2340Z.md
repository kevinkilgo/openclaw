# PR #18 Hard-Rules Evidence - 2026-09-18 23:40 UTC

Status: bounded source/test progression only. Do not call PR #18 ready from this artifact.

## Target State

- Target worktree: `/home/oc_admin/.openclaw/workspace/source/openclaw-pr18-text-window-first`
- Branch: `pr-18`
- Local HEAD at artifact creation: `3b7440fc5fab7974ddddc09ad41c9bb1c9deee21`
- Public PR head observed locally: `origin/pr/18` at `3b58df60fa58`
- Mismatch: yes. Local source/test evidence is ahead of the observed public PR head and is not proof that the public PR has the same evidence.
- Dirty files at artifact creation: `extensions/msteams/src/messenger.ts`, `extensions/msteams/src/messenger.test.ts`, and this artifact.

## Current Source/Test Proof Available

- Native Teams text chunks only for routine long plain-text messenger replies:
  - `extensions/msteams/src/messenger.ts` routes text-only over-budget activities through `planTeamsTextWindowChunks` and sends each chunk as an ordinary activity with only `text` changed.
  - `extensions/msteams/src/messenger.test.ts` test `delivers routine long replies as reconstructable text-window chunks without artifacts or cards`.
- No default artifact/file/card/document/digest/open-link route for routine long replies:
  - The routine long-reply test asserts every chunk has no `attachments`, no `openclawDeliveryEnvelope`, no `contentUrl`, no `document`, no `application/vnd.microsoft.card`, no Teams file-consent card, and no `artifactPath`.
  - The 413 test asserts `MessageSizeTooBig` propagates without artifact fallback and with the same no-artifact/no-file/no-card/no-document checks.
- Teams message ID per chunk:
  - The routine long-reply test asserts returned IDs equal the per-chunk provider IDs.
  - The 429 retry test asserts IDs returned after retry equal the successful delivered chunk IDs.
- Payload sizes under Microsoft 80 KB recommended / approximately 100 KB hard activity budget:
  - The routine long-reply test measures each chunk with `measureTeamsActivity` and asserts UTF-8 and UTF-16 serialized JSON byte counts are both below `80 * 1024`, and `overBudget` is false.
  - The text-window send path measures every chunk before send and throws if any chunk is over the 80 KB activity budget.
- Source/reconstructed hash match after deterministic headers/footers:
  - The routine long-reply test reconstructs via `reconstructTeamsTextWindowChunks` and asserts exact equality plus SHA-256 equality against the source text.
  - Planner tests also cover exact reconstruction and planner `sourceHash === reconstructedHash`.
- Partial failure after accepted chunks:
  - Test `surfaces partial failure after text-window chunks have already been accepted` asserts a later provider error propagates and is not converted to `PlatformMessageNotDispatchedError`.
  - `messenger.ts` comments document that once any text-window chunk is accepted, later provider failure is partial delivery.
- 429 backoff:
  - Test `backs off and retries text-window chunks after HTTP 429 before delivery` covers a replay-safe 429 before delivery, records the retry callback, then verifies the successful retry delivers reconstructable text-window chunks with per-chunk IDs and no artifact/file/card/document route.
  - Existing thread-send 429 coverage remains in `retries thread sends after a replay-safe HTTP 429`.
- 413 `MessageSizeTooBig` behavior:
  - Test `propagates text-window MessageSizeTooBig without artifact fallback` covers a later text-window chunk receiving status 413/code `MessageSizeTooBig`, propagation of that provider error, no total-not-dispatched classification, and no artifact/file/card/document fallback.

## Missing Proof / Blockers

- Public PR head mismatch remains: local worktree evidence is at `3b7440fc5fab`, while observed public PR head is `3b58df60fa58`.
- Worktree is intentionally not clean until the bounded source/test changes and this artifact are committed or otherwise handed off.
- No controlled live Teams send was performed. This artifact cannot prove native delivery in a real tenant.
- No Teams desktop rendering artifact exists proving no truncation or silent ellipses.
- No Teams web rendering artifact exists proving no truncation or silent ellipses.
- No live delivery audit artifact exists proving provider-side success for ordinary employee long answers.
- Source tests prove returned chunk ID aggregation shape, but not a production delivery audit record persisted from a real Teams delivery.

## Bounded Tests Implemented Or Planned

- Implemented: native Teams text chunks only by default for routine long plain-text messenger replies.
- Implemented: no artifact/file/card/document/digest/open-link route by default in the messenger routine long-reply path.
- Implemented: per-chunk message IDs returned from messenger delivery.
- Implemented: activity payload size checks below 80 KB source budget.
- Implemented: reconstructed/source exact text and SHA-256 match after deterministic `Part N/M` headers are stripped.
- Implemented: partial provider failure after accepted text-window chunks surfaces as provider error.
- Implemented: 429 replay-safe backoff before delivery for text-window chunks.
- Implemented: 413 `MessageSizeTooBig` propagation without fallback to artifact/file/card/document route.
- Planned/missing: production delivery audit success artifact for the long-reply text-window path.
- Planned/missing: controlled Teams desktop and web rendering artifacts showing no truncation or silent ellipses.

## Validation Run

Command:

```sh
node scripts/run-vitest.mjs run extensions/msteams/src/messenger.test.ts
```

Result:

- Passed: 1 test file
- Passed: 50 tests
- Duration reported by runner: 25.94s

## Guardrails Observed

- No deploy.
- No restart.
- No production mutation.
- No secret access or emission.
- No live Teams sends.
