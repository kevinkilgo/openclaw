# Agent Control Plane Prod-Test Rollback Runbook

Scope: prepare and govern production testing of the internal agent management
plane without interrupting current running agents.

Source context:

- Design: `docs/agents/agent-control-plane.md`
- Prod-readiness review: `docs/agents/agent-control-plane-prod-readiness-review.md`
- Risk register: `docs/agents/agent-control-plane-prod-risk-register.md`

## Operating Rule

Testing must be shadow-mode or read-only until every live mutation has explicit
item-specific approval. A rollback action is also a live mutation unless it only
closes local, pending, non-delivered test artifacts.

Do not interrupt active agents to prove that the control plane can recover.
Rollback readiness is demonstrated by documented last-good state, gated
disable paths, queued-action controls, and offline or non-prod validation before
any prod test begins.

## No-Touch Current-Agent Rule

During prep and prod-test planning:

- Do not restart, update, scale, drain, force-recreate, or redeploy gateway,
  router, employee-agent, worker, session, cron, watcher, registry, Swarm, BWS,
  or runtime services.
- Do not send manager-to-agent messages to live agents unless that exact target,
  content, timing, idempotency key, and rollback behavior are approved under
  `ACP-R05`.
- Do not write live agent workspaces, managed files, memory files, registry
  rows, session rows, runtime config, Docker/Swarm state, cron/watch
  declarations, secret grants, or delivery queues.
- Do not query, print, copy, log, or place secret values in commands, docs,
  messages, URLs, or approval packets.
- Do not use rollback steps as test actions. Rollback execution requires its own
  approval unless an emergency runbook has already approved the exact rollback
  target and artifact.

If a planned check cannot be completed without touching one of these surfaces,
stop and convert it into an approval packet or a non-prod/offline validation.

## Preflight Checks

Complete these checks from source, docs, offline fixtures, previously captured
metadata, or separately approved read-only status metadata. Do not perform live
mutations while gathering evidence.

| Gate                      | Required evidence                                                                                                                                                            | Blocks test if missing |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Test boundary             | Written statement that the prod test is shadow-mode/read-only, or a list mapping each live mutation to the matching `ACP-Rxx` risk-register item with approval status.       | Yes                    |
| Active-agent protection   | Documented rule that active sessions are never preempted, cancelled, restarted, drained, or reconfigured by the test.                                                        | Yes                    |
| Principal binding         | Trusted gateway/service boundary derives manager identity; callers cannot supply `agentId`, teams, or manager grants in request bodies.                                      | Yes                    |
| Authorization tests       | Forged-principal denial, out-of-scope action denial, and allowed-action cases exist in source tests or approved non-prod tests.                                              | Yes                    |
| Audit durability          | Append-only or tamper-evident audit destination is identified for allow and deny events, including request id, actor, target, action, reason, source service, and timestamp. | Yes                    |
| Registry integrity        | Prod registry loading fails closed for duplicate ids, empty action sets, missing manager/team grants, unsafe managed paths, and invalid endpoint names.                      | Yes                    |
| Least-privilege responses | Response shapes are scoped by action; workspace roots are not disclosed for list, status, or messaging-only calls.                                                           | Yes                    |
| Message safety            | `sendMessage` semantics are defined as asynchronous, non-preemptive, idempotent, rate-limited, and stoppable before delivery, or removed from the prod test.                 | Yes                    |
| Pending file updates      | `requestManagedFileUpdate` produces only `pending_review` plans with no workspace writes, reloads, or automatic apply path.                                                  | Yes                    |
| Ledger isolation          | Any Tina/Artemis-style owner/evidence ledger output uses a local fixture or clearly non-actionable shadow namespace with no dashboard, alert, or follow-up fanout.           | Yes                    |
| Feature/route gate        | Management-plane route or service can be disabled without redeploying unrelated agent services.                                                                              | Yes                    |
| Last-good state           | Last-good route config, registry version, queue state, service definition, and audit sink location are recorded before testing.                                              | Yes                    |
| Monitoring window         | Owner, start/end time, stop authority, escalation path, and post-test observation window are assigned.                                                                       | Yes                    |

## Prod-Test Entry Gates

Before any production test starts:

1. Confirm the proposed action set contains only safe operations from the design:
   `list`, `readStatus`, `readManagedFile`, and
   `requestManagedFileUpdate` in pending-review mode. Include `sendMessage` only
   if the message-safety gate is closed and `ACP-R05` approval exists.
2. Confirm every planned live mutation has an approved risk-register item. Any
   unmapped mutation is removed from the test or converted into a new
   risk-register item.
3. Confirm no test depends on service restart, route replacement, Swarm alias
   change, DB migration, workspace write, cron/watch update, secret permission
   change, session cleanup, or live rollback.
   Live task-ledger, dashboard, alert-linked task, or operator-visible status
   writes also remain out of scope unless separately approved under `ACP-R19`.
4. Confirm the operator has stop authority to disable only the new management
   plane route/flag/queue path, not current agent runtimes.
5. Confirm all approval packets name exact target, command/change, expected
   effect, risk if wrong, rollback artifact, and monitoring window.

## Rollback Triggers

Stop the test and prepare rollback approval if any trigger occurs:

- Any current agent loses message delivery, becomes unreachable through an
  existing channel, or shows unexpected session cancellation, duplicate final
  delivery, stuck delivery, or active-turn interruption.
- Gateway/router health, route logs, or access logs show denied/allowed behavior
  inconsistent with the approved test plan.
- A caller can influence principal identity, team membership, grants, target
  agent id, managed path, or workspace root outside trusted middleware.
- Audit allow or deny events are missing, delayed beyond the monitoring
  threshold, uncorrelated to request ids, or written to the wrong destination.
- Registry loading accepts duplicate ids, empty grants, unsafe managed paths, or
  unexpected live targets.
- `sendMessage` cannot be held, drained, discarded before delivery, correlated by
  idempotency key, or proven non-preemptive.
- `requestManagedFileUpdate` writes a file, reloads agent instructions, bypasses
  review, or creates a plan outside the expected pending-review store.
- Shadow observations create live task-ledger rows, dashboard work items, alerts,
  or follow-up automation that operators could mistake for real assigned work.
- Any secret value appears in logs, chat, docs, command lines, URLs, screenshots,
  or audit payloads.
- Monitoring detects resource pressure, retry storms, queue growth, repeated
  authorization denials, or unexpected requests to non-test agents.
- The test deviates from the approved target, timing, operator, command,
  content, route, registry version, or rollback artifact.

If a trigger involves secret exposure, stop using the exposed artifact, preserve
minimal diagnostic context without repeating the secret, and recommend rotation
if exposure crossed a trust boundary.

## Rollback Decision Path

1. Declare state: active trigger, affected risk-register ID, evidence observed,
   affected services/agents, and whether current agents are impacted.
2. Freeze the test path: stop new test requests and hold undelivered test
   messages or pending plans when that can be done without touching current
   agent runtimes.
3. Preserve evidence: audit events, request ids, route/test config version,
   registry version, queue ids, and monitoring snapshots. Do not delete audit
   evidence during rollback.
4. Select the narrowest rollback target:
   - Close or discard local pending-review plans if no live system consumed them.
   - Disable only the new management-plane route/flag when pre-approved.
   - Hold, drain, or discard only test-owned queued messages when pre-approved.
   - Revert to the last-good registry or config only with explicit approval.
5. Prepare an approval packet for any live rollback command. Include exact
   command/change, target, last-good artifact, expected state, risk if wrong,
   monitoring window, and recovery path if rollback fails.
6. Execute only after approval, unless an existing emergency runbook explicitly
   covers the exact target and artifact.
7. Verify post-rollback with non-mutating checks and documented delivery/session
   evidence. If verification would interrupt agents, mark it approval-required.

## Rollback Steps By Surface

| Surface                                 | Rollback step                                                                                                                                                  | Approval requirement                                                                                                    |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Local pending-review managed-file plans | Close, mark rejected, or delete only the new pending plan if it has not been applied and lives outside live workspace state. Preserve review/audit references. | Not required when strictly local and non-live; required if it touches live workspace, registry, or review system state. |
| Management-plane route or feature flag  | Disable only the new route/flag and verify existing channels continue.                                                                                         | Required under `ACP-R01` or `ACP-R02` unless the exact disable action was pre-approved.                                 |
| Agent-control service                   | Scale down, remove, or revert only the new service definition.                                                                                                 | Required under `ACP-R02`; must not restart employee agents.                                                             |
| Queued test messages                    | Hold, drain, or discard test-owned messages before delivery by idempotency key.                                                                                | Required under `ACP-R05` if queue state is live or target agents could observe the change.                              |
| Registry config                         | Revert to last-good registry version and confirm duplicate/unsafe entries are absent.                                                                          | Required under `ACP-R06` if live registry/state changes.                                                                |
| Gateway/router config                   | Revert only the agent-control route/config to last-good.                                                                                                       | Required under `ACP-R01`; do not restart unrelated gateway paths unless separately approved.                            |
| Swarm network/service aliases           | Restore previous aliases or network definition.                                                                                                                | Required under `ACP-R07`; any step that can partition agents is approval-required.                                      |
| Cron/watch jobs                         | Disable or restore only the test-owned job declaration.                                                                                                        | Required under `ACP-R08`; do not clear shared queues or histories without approval.                                     |
| Secrets/BWS grants                      | Revoke added grants, restore previous grant metadata, or rotate exposed credentials.                                                                           | Required under `ACP-R09`; never handle secret values in chat, docs, commands, or logs.                                  |
| Session cleanup/state                   | Restore backed-up rows/files or rebind sessions only if cleanup touched live state.                                                                            | Required under `ACP-R11`; default is preserve evidence and avoid cleanup.                                               |
| Task ledger/dashboard rows              | Mark only test-owned rows closed, voided, or shadow-expired by idempotency/request id; keep audit evidence and avoid triggering follow-up automation.          | Required under `ACP-R19` if the rows are in a live ledger, dashboard store, alert-linked view, or operator stream.      |
| Employee-agent services                 | Do not restart, scale, drain, or recreate as part of management-plane rollback.                                                                                | Always approval-required under `ACP-R03`; if needed, escalate as a separate incident.                                   |

## Monitoring Signals

Monitor only approved metadata and non-secret logs/metrics.

- Current-agent continuity: active sessions remain active, existing channels keep
  delivery, no duplicate final messages, no unexpected cancellations, no
  employee-agent restart events.
- Gateway/router: route health, error rate, denied/allowed counts, unexpected
  route matches, non-test route latency, websocket/control traffic stability.
- Authorization: allow/deny ratio, forged-principal denials, out-of-scope
  denials, action-specific grants, source service identity, request ids.
- Audit: event append success, event lag, correlation id coverage, retention
  location, failed audit writes, evidence preserved across route disable.
- Registry: loaded version, target count, duplicate-id rejection, grant
  validation, managed-path validation, last-good version recorded.
- Messaging: queue depth, held/drained/discarded counts, idempotency-key
  conflicts, delivery suppression before active-session preemption.
- Managed files: pending-review plan count, target path validation failures, no
  direct workspace write, no instruction reload.
- Resource pressure: CPU/memory/error spikes for only the new control-plane path,
  retry storms, request fanout, queue growth, backoff behavior.
- Secrets hygiene: redaction checks, absence of secret values in logs/audits,
  metadata-only permission records.
- Ledger/dashboard isolation: shadow namespace counts, non-actionable markers,
  zero alert/follow-up fanout, zero operator-visible real-task rows, and
  closure/void markers for any approved live shadow rows.

## Consolidated Risk Register Coverage

Confirm these items exist in the consolidated risk register before approving
prod tests:

- `ACP-R12` Principal derivation and identity boundary: risk that caller-supplied
  principals, team grants, or manager ids bypass trusted gateway/service
  identity. Approval gate must require forged-principal denial evidence and
  trusted middleware injection proof.
- `ACP-R13` Durable audit persistence: risk that allow/deny events are returned
  to callers but not durably retained. Approval gate must require append-only or
  tamper-evident storage, retention owner, request correlation, and rollback
  survival.
- `ACP-R14` Live-session non-interruption guard: risk that management-plane
  actions preempt active turns, cancel sessions, or duplicate delivery. Approval
  gate must require active-session block logic, queue-only behavior, and
  post-test continuity evidence.
- `ACP-R15` Registry integrity and fail-closed loading: risk that duplicate ids,
  empty grants, unsafe managed paths, or invalid endpoint declarations are
  normalized into usable prod config. Approval gate must require fail-closed
  validation and last-good rollback artifact.
- `ACP-R16` Least-privilege response disclosure: risk that list/status/message
  operations expose workspace roots, managed file paths, endpoints, or
  capabilities not needed for that action. Approval gate must require
  action-scoped response schemas and disclosure review.
- `ACP-R17` Test-owned queue and pending-plan containment: risk that test
  messages or pending-review file plans outlive the test, reach live agents
  unexpectedly, or require disruptive cleanup. Approval gate must require
  idempotency, hold/drain/discard controls, owner tags, expiration, and
  non-disruptive cleanup evidence.
- `ACP-R18` Upchain communication allowlist: risk that employee/subagent
  initiated messages to Artemis, Fiona, or manager-team endpoints bypass a
  strict allowlist. Approval gate must require deny-by-default tests, allowed
  source ids/teams, target managers, queue policy, and deny behavior.
- `ACP-R19` Shadow-mode task ledger and dashboard accounting: risk that
  Tina/Artemis-style owner/evidence rows written during shadow testing become
  actionable work, trigger follow-up automation, or create false completion
  evidence. Approval gate must require a shadow namespace or local fixture,
  non-actionable markers, fanout suppression, visibility scope, and closure path.
- `ACP-R20` Shadow wrapper live-handler isolation: risk that a shadow wrapper
  imports or calls live mutation handlers. Approval gate must require static
  import boundary tests, forbidden-handler contract tests, no live adapter in
  shadow mode, and zero live side-effect counters.
- `ACP-R21` Shadow audit sink outage behavior: risk that prod shadow execution
  continues without durable audit. Approval gate must require fail-closed audit
  behavior, audit-write failure samples, destination health checks, and request
  id correlation.
- `ACP-R22` Production-derived registry data leakage: risk that service names,
  workspace roots, team structure, or capabilities from registry snapshots leak
  into public or unauthorized artifacts. Approval gate must require redacted
  samples, artifact destination review, private repo/evidence gates, and
  retention owner.

## Approval Packet Template

For each live action or rollback:

- Intended action:
- Risk-register ID:
- Target system/person/channel:
- Exact command, config diff, message body, or state change:
- Expected effect:
- Current-agent interruption risk:
- Evidence that active agents are protected:
- Detection and success signals:
- Rollback artifact and exact rollback step:
- Risk if wrong:
- Recovery path if rollback fails:
- Monitoring window and owner:
- Approval wording needed:

## Exit Criteria

The prod test is complete only when:

- Test requests stop and no queued test messages or pending plans can reach live
  agents unexpectedly.
- Audit evidence for allowed and denied decisions is preserved.
- Existing agent delivery/session continuity remains normal for the monitoring
  window.
- Any held, discarded, rejected, or expired test artifact is recorded with an
  idempotency key or plan id.
- All deviations are added to the risk register or readiness review before the
  next approval.
