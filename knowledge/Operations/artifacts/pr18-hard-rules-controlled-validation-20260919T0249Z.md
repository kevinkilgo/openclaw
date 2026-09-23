# PR #18 Hard-Rules Controlled Validation - 2026-09-19T02:49Z

## State

PARTIAL / NOT READY.

The ordinary employee Teams inbound route now has local source/test evidence for `onHardRulesDeliveryEvidence` wiring after Artemis added the missing message-handler pass-through during the 03:12Z heartbeat reconciliation.

This is not final acceptance evidence. Controlled runtime delivery and Teams desktop/web rendering proof through `kkilgo@ftsc.com` are still missing.

## Local Implementation Evidence

Observed and updated worktree:

- `/home/oc_admin/.openclaw/workspace/source/openclaw-pr18-text-window-first`
- Current local commit: `b9c9fafddf04b589e0e45191fe67b12e525029f4` (`Wire Teams hard-rules evidence recorder`).
- Published feature branch observed after fetch: `origin/feature/msteams-text-window-first-long-response-pr18` at `b9c9fafddf04b589e0e45191fe67b12e525029f4`.

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

- Publication blocker cleared for the named feature branch: `origin/feature/msteams-text-window-first-long-response-pr18` now resolves to `b9c9fafddf04b589e0e45191fe67b12e525029f4` from this checkout.
- The controlled ordinary employee-route runtime proof through `kkilgo@ftsc.com` has not succeeded.
- Required per-chunk message IDs, chunk count/order, payload sizes, delivery status, hashes, and no-default-attachment/card/file/document/digest/open-link proof have not been captured from the controlled run.
- Teams desktop and authenticated Teams web rendering proof showing no truncation and no silent ellipses remains missing.

## 2026-09-19T06:45Z Controlled Pickup Attempt

STATUS: BLOCKED / NOT READY.

Publication blocker update:

- After `git fetch`, `origin/feature/msteams-text-window-first-long-response-pr18` resolves to `b9c9fafddf04b589e0e45191fe67b12e525029f4`.
- The stale local tracking ref `origin/pr/18` was pruned/deleted during fetch; the published feature branch is the current remote evidence-recorder branch observed from this checkout.

Controlled lane action:

- Lane used: `kkilgo@ftsc.com` controlled one-on-one Teams lane.
- Chat: Kevin Kilgo / Richard Harris one-on-one.
- Trigger message ID: `1789800186733`.
- Trigger sent at: `2026-09-19T06:43:06.733Z`.
- Trigger was sent only through the authorized `kkilgo@ftsc.com` lane.
- Trigger requested an ordinary default employee long answer with native Teams text only and no attachment/artifact/card/file/document/digest/open-link route.

Observed result:

- Teams connector send succeeded for the trigger message.
- Teams connector read after the polling window showed only the trigger message and no employee-route reply.
- No `msteams-hard-rules-delivery-*.json` file was found under `/home/oc_admin/.openclaw` after the trigger/poll window.
- Therefore delivery evidence remains `NOT_RUN` for acceptance purposes: no qualifying PR #18 native text chunk message IDs, chunk count/order, payload-size measurements, delivery success, source/reconstructed hashes, route audit, or no-default-fallback proof were produced.

Concrete runtime blocker:

- The controlled Teams lane is reachable, but the Teams message sent via Graph into the Kevin/Richard one-on-one chat did not trigger a live ordinary employee-route reply from this session.
- This is a runtime pickup/routing failure, not a `kkilgo@ftsc.com` lane access failure.
- Remediation owner: Artemis/main should provide the exact live ordinary employee-route invocation surface for this published branch, or run the controlled validation from the live Teams ingress environment that receives the `kkilgo@ftsc.com` lane and append the generated `msteams-hard-rules-delivery-*.json` here.

Rendering blocker:

- Desktop proof remains blocked locally: `openclaw nodes list --json` returned no paired nodes, so this session has no controlled Teams desktop capture node.
- Authenticated web proof remains blocked locally: no supported browser executable was found (`chromium`, `chromium-browser`, `google-chrome`, `microsoft-edge`, and `firefox` all absent from PATH).
- Remediation owner: Artemis/main should provide a paired desktop capture node and supported authenticated Teams web browser surface, or append those captures directly to this artifact.

Acceptance status:

- HOLD / NOT READY.
- No production deploy, service restart, production mutation, secret change, or Teams message outside the authorized `kkilgo@ftsc.com` controlled lane was performed.

## Guardrails

No production deploys, service restarts, production mutations, secret changes, or Teams messages outside the authorized `kkilgo@ftsc.com` controlled validation lane were performed while producing this artifact.

## 2026-09-19T08:32Z Local Runtime Pickup Patch Check

STATUS: LOCAL PATCH VALIDATED / ACCEPTANCE STILL HOLD.

Observed local worktree changes:

- `extensions/msteams/src/monitor-handler/inbound-dispatch.ts` now treats an employee container run that completes without `terminalReply.text` as a failed dispatch instead of a quiet completed turn.
- The failure is classified as `recipient-visible-proof-missing`.
- `extensions/msteams/src/employee-container-dispatch.test.ts` adds coverage for the no-terminal-reply case.
- The new test uses a distinct Teams message id to avoid suppressing the following failure-path status update through the static dedupe set.

Focused validation command:

```text
pnpm exec vitest run extensions/msteams/src/employee-container-dispatch.test.ts
```

Result:

```text
Test Files  1 passed (1)
Tests  13 passed (13)
```

Important note:

- This is local source/test evidence only. It does not satisfy PR #18 acceptance by itself.
- Controlled runtime proof through `kkilgo@ftsc.com` is still missing: no native Teams chunk message IDs, chunk count/order, payload sizes, delivery audit, source/reconstructed hashes, no-default-fallback proof, or desktop/web rendering proof has been captured from a successful ordinary employee-route run.

Next action:

- Commit/publish or otherwise route this runtime pickup patch if accepted.
- Rerun the controlled `kkilgo@ftsc.com` ordinary employee-route validation after the live route includes the patch.
- Capture the generated `msteams-hard-rules-delivery-*.json` plus Teams desktop and authenticated web no-truncation/no-silent-ellipsis proof.

## 2026-09-19T08:35Z Local Commit / Publication Attempt

STATUS: LOCAL COMMIT READY / PUBLICATION BLOCKED BY GITHUB HTTPS AUTH / ACCEPTANCE STILL HOLD.

Local commit:

```text
dc80f6c04cd3c4c34c459594f6b4cbf90510ba11 Classify empty Teams employee replies
```

Committed files:

- `extensions/msteams/src/monitor-handler/inbound-dispatch.ts`
- `extensions/msteams/src/employee-container-dispatch.test.ts`
- `knowledge/Operations/artifacts/pr18-hard-rules-controlled-validation-20260919T0249Z.md`

Focused validation rerun before commit:

```text
pnpm exec vitest run extensions/msteams/src/employee-container-dispatch.test.ts
```

Result:

```text
Test Files  1 passed (1)
Tests  13 passed (13)
```

Publication attempt:

```text
git push origin pr-18
```

Result:

```text
fatal: could not read Username for 'https://github.com': No such device or address
```

Remediation:

- Fiona/Kevin should publish or cherry-pick local commit `dc80f6c04cd3c4c34c459594f6b4cbf90510ba11` from `/home/oc_admin/.openclaw/workspace/source/openclaw-pr18-text-window-first`, or restore non-interactive GitHub push auth for Justin.
- After pickup, rerun the controlled `kkilgo@ftsc.com` ordinary employee-route validation. A run that completes without `terminalReply.text` should now fail visibly as `recipient-visible-proof-missing` instead of quiet-completing with no reply and no hard-rules delivery JSON.

Acceptance status remains HOLD / NOT READY:

- No controlled live delivery JSON exists yet.
- No Teams desktop or authenticated web rendering proof exists yet.
- This commit improves runtime pickup diagnosability; it is not acceptance proof by itself.

## 2026-09-19T07:00Z Live Invocation Surface

STATUS: BLOCKED / NOT READY.

Exact live ordinary employee-route invocation surface identified from source:

- Teams monitor registration: `extensions/msteams/src/monitor.ts` builds `handlerDeps` and calls `registerMSTeamsHandlers(handler, handlerDeps)`.
- Live Teams ingress surface: `createMSTeamsIngress({ ... dispatch: async (activity, lifecycle, liveContext) => ... })` dispatches Bot Framework inbound activities to the registered message handler.
- Ordinary inbound handler: `extensions/msteams/src/monitor-handler/message-handler.ts` calls `dispatchMSTeamsInboundTurn(...)` and passes `onHardRulesDeliveryEvidence: deps.onHardRulesDeliveryEvidence`.
- Employee route decision and dispatch: `extensions/msteams/src/monitor-handler/inbound-dispatch.ts` calls `dispatchViaEmployeeContainer(...)` when `shouldDispatchToEmployeeContainer(...)` is true.
- Employee-container gateway invocation: `dispatchViaEmployeeContainer(...)` calls `callGatewayFromCli("agent", ...)` against `ws://employee-agent-{agentId}:18789`, then waits with `callGatewayFromCli("agent.wait", ...)`.
- Runtime call shape covered by `extensions/msteams/src/employee-container-dispatch.test.ts`:
  - `agentId: "main"`
  - `sessionKey: "agent:main:msteams:direct:<sender-aad>"`
  - `message: <ordinary Teams inbound body>`
  - `idempotencyKey: "msteams-employee-container:<routeAgentId>:<teams-message-id>"`
  - `deliver: false`
  - `sourceReplyDeliveryMode: "automatic"`

Current blocker:

- The `kkilgo@ftsc.com` controlled lane trigger at `2026-09-19T06:43:06.733Z` did not produce an ordinary employee-route reply and did not produce a `msteams-hard-rules-delivery-*.json` file under `/home/oc_admin/.openclaw`.
- This is a runtime pickup/routing failure after lane access, not a controlled-lane access failure and not a source-test sufficiency claim.
- Next diagnosis should inspect the live Teams ingress/runtime logs for the trigger message ID `1789800186733` and determine whether it reached `dispatchMSTeamsInboundTurn`, whether `shouldDispatchToEmployeeContainer(...)` was true, whether `callGatewayFromCli("agent", ...)` returned a run id, and whether `agent.wait` returned a terminal reply.

Next action:

- Artemis/main should run or inspect the live Teams ingress environment that actually receives the `kkilgo@ftsc.com` lane and capture the gateway invocation/result above.
- If the inbound message never reaches the monitor, record the exact Teams ingress/adoption/routing failure.
- If `callGatewayFromCli("agent", ...)` or `agent.wait` fails or returns no `terminalReply`, record that exact gateway/employee-container failure and remediation.
- After the employee reply is produced, collect the generated `msteams-hard-rules-delivery-*.json` plus controlled Teams desktop and authenticated web rendering proof.
