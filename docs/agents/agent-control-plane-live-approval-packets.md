# Agent Control Plane Live Approval Packets

Date: 2026-09-13

Scope: next production-facing steps for the Artemis/Fiona agent management plane
and onboarding hardening work. These packets preserve the non-interruption rule:
source, tests, docs, offline fixtures, and read-only inventory can continue;
anything that can restart agents, mutate live state, send to agents, change
cron/watchers, alter secrets, or write live workspaces requires item-specific
approval.

## Approval Evidence Requirements

Every approved packet must be closed with an evidence record before it can be
treated as complete. Approval is time-bounded and does not grant standing
permission beyond the named packet, target, command boundary, and expiration.

Required closeout fields:

- Approved packet id and approval text.
- Approved window start, expiration, and operator.
- Exact command or tool transcript reference.
- Private artifact path and checksum when an artifact is produced.
- Pass/fail result with blockers, if any.
- Non-interruption evidence or the exact approved interruption window.
- Confirmation that unapproved actions were not performed.
- Follow-up approval required before expanding scope.

## Packet ACP-APP-01: Shadow-Mode Prod Test

Recommendation: approve now.

Approved window: at approval time through 2026-09-13T23:59:59Z, or until the
first APP-01 evidence package is produced, whichever comes first.

Operator: Artemis/main unless explicitly reassigned in the evidence record.

Risk items: `ACP-R12`, `ACP-R13`, `ACP-R14`, `ACP-R15`, `ACP-R16`, `ACP-R17`,
`ACP-R19`, `ACP-R20`, `ACP-R21`, `ACP-R22`.

Intended action: run the internal agent-control shadow-mode prod test using the
current non-delivering shadow wrapper, registry snapshot/evidence package, and
durable audit output.

Targets: agent-control source runner and an approved redacted/read-only registry
snapshot covering the current registered fleet. No live agent services are
targets.

Exact change/command boundary: execute the shadow-mode runner only. It may
authorize, deny, plan, and audit. It may not send messages, write workspaces,
enable routes, deploy services, mutate DBs, alter Swarm, touch secrets, create
cron/watchers, clean sessions, or restart anything.

Expected effect: produce evidence that Artemis/Fiona management policy, deny
cases, registry validation, managed-file pending-review behavior, audit
correlation, and zero side effects hold against production-like inputs.

Interruption window: none expected. The test must not contact live agent
runtimes or wake sessions.

Success evidence: request-id coverage, audit-event count, allow/deny matrix,
forged-principal denial, unmanaged-path denial, zero side-effect counters, and
no live service changes.

Required artifact/evidence: private shadow evidence package path, evidence
checksum, command transcript reference, request-id count, audit-event count,
allow/deny counts, zero side-effect counters, pass/fail result, and explicit
confirmation that no live sends, route changes, DB writes, service restarts,
cron changes, secret reads, or workspace writes occurred.

Risk if wrong: a faulty runner could accidentally call live handlers, disclose
production-derived registry details, or continue without audit.

Rollback/stop path: stop the runner, preserve evidence, and do not execute
rollback commands unless separately approved under `ACP-R10`.

Approval wording:

> I approve ACP-APP-01: run the internal agent-control shadow-mode prod test,
> limited to non-interrupting authorization/planning/audit observation only. No
> live sends, workspace writes, route enablement, service deploy/restart, Swarm
> changes, DB mutation, cron/watch changes, secret changes, cleanup, or rollback
> commands are approved.

## Packet ACP-APP-02: Read-Only Live Fleet Registry Snapshot

Recommendation: approve after `ACP-APP-01` or alongside it if the snapshot
artifact stays private/redacted.

Approved window: at approval time through 2026-09-13T23:59:59Z, or until the
first APP-02 registry snapshot artifact is produced, whichever comes first.

Operator: Artemis/main unless explicitly reassigned in the evidence record.

Risk items: `ACP-R15`, `ACP-R16`, `ACP-R22`.

Intended action: generate a read-only registry snapshot from current fleet
metadata for validation and review.

Targets: live service metadata, configured-agent metadata, and existing
non-secret status fields only.

Exact change/command boundary: read-only inventory. No Docker/Swarm updates, no
DB writes, no secret reads, no workspace writes, no route changes.

Expected effect: create a validated private snapshot showing logical agent ids,
roles, owner teams, service names, managed-file declarations, and capabilities
needed for agent-control review.

Interruption window: none expected.

Success evidence: snapshot checksum, validation result, target counts,
redaction proof, private artifact path, and no live mutation evidence.

Required artifact/evidence: private redacted snapshot path, checksum, validation
result, source inventory summary, target counts, redaction proof, command
transcript reference, pass/fail result, and explicit confirmation that the
snapshot was not committed, pushed, dashboarded, or written to a public path.

Risk if wrong: production topology or workspace metadata could be exposed in
logs, public repo commits, or dashboards.

Rollback/stop path: remove or quarantine only the generated snapshot if it was
stored in the wrong location; preserve incident evidence if disclosure occurred.

Approval wording:

> I approve ACP-APP-02: generate a private, redacted, read-only live fleet
> registry snapshot for validation. Do not commit/push the production-derived
> snapshot publicly, expose secret values, or mutate live services, DBs, routes,
> cron, secrets, or workspaces.

## Packet ACP-APP-03: Agent-Control Internal Route/Service, Disabled By Default

Recommendation: review only. Do not execute until Fiona independently reviews
APP-01/02 evidence and this APP-03 plan, then Kevin approves the exact reviewed
diff and window.

Approval status: held. This packet is prepared for review only and does not
authorize a router/gateway update, service deploy, route enablement, live
manager send, workspace write, DB mutation, secret change, cron/watch change, or
rollback command.

Risk items: `ACP-R01`, `ACP-R02`, `ACP-R12`, `ACP-R13`, `ACP-R14`, `ACP-R16`,
`ACP-R20`, `ACP-R21`.

Precondition evidence already available from APP-01/02:

- Registry snapshot: 14 agent records.
- Shadow attempts: 6 total, 4 allowed, 2 denied.
- Request-id coverage: 6/6.
- Audit events: 6.
- Live side-effect counters: all zero.
- Blockers: none.

Intended action: stage, but keep disabled, a shadow-only internal
agent-control gateway route that can later run the already-proven shadow wrapper
against the private registry snapshot and append shadow audit evidence. This is
not a live management route.

Target service/route: `gateway-router` route group
`/internal/agent-control/v1/shadow`. The route must bind only to the internal
gateway/router surface and must remain unavailable to public Telegram, Teams,
Discord, app-origin, webhook, MCP, and employee-agent channel ingress.

Design decision: prefer a disabled gateway-router route over a separate live
`agent-control` service for APP-03. A separate service adds Swarm service
registration, DNS, network, and health surfaces before they are needed. The
route approach minimizes the change surface and can still be rolled back by
removing or disabling one config block. If implementation review proves the
gateway route cannot be added without broad router risk, this packet must be
revised before approval.

Proposed config diff, not applied:

```yaml
agentControl:
  internalRoute:
    enabled: false
    mode: shadow
    path: /internal/agent-control/v1/shadow
    bind: internal-gateway-only
    trustedIdentitySource: gateway-request-scope
    allowedPrincipals:
      agentIds:
        - artemis
        - fiona
      teams:
        - artemis-leadership
        - fiona-leadership
    allowedActions:
      - list
      - readStatus
      - readManagedFile
      - requestManagedFileUpdate
    deniedActions:
      - sendMessage
    registry:
      source: private-artifact
      path: .artifacts/agent-control-live-approval/<run-id>/agent-control-registry-snapshot.private.json
      failClosed: true
    audit:
      sink: .artifacts/agent-control-live-approval/<run-id>/agent-control-app03-shadow-audit.private.ndjson
      failClosed: true
      requiredFields:
        - requestId
        - sourceService
        - principalAgentId
        - targetAgentId
        - action
        - decision
    liveAdapters:
      delivery: disabled
      workspaceWrites: disabled
      serviceMutation: disabled
      secretReads: disabled
      cronMutation: disabled
      databaseMutation: disabled
      liveHandlerCalls: disabled
```

Implementation boundary to prove before approval:

- The route is absent or returns disabled before `agentControl.internalRoute.enabled`
  is explicitly set true under a future packet.
- The route imports only the agent-control registry parser, authorization,
  operation planner, shadow wrapper, shadow matrix/evidence package builder, and
  audit appender.
- The route does not import or call gateway message delivery, conversation
  send/turn handlers, Teams/Telegram/Discord outbound handlers, live workspace
  file APIs, Docker/Swarm adapters, secret/BWS resolvers, cron/watch handlers,
  production DB mutation helpers, session cleanup helpers, or rollback helpers.
- `sendMessage` remains denied for APP-03 even though the offline shadow wrapper
  can model message planning. Live send testing stays held under APP-04.
- `requestManagedFileUpdate` may only produce a shadow pending-review plan in
  the private evidence artifact. It must not write a live pending-review store
  or any agent workspace.

Exact change/command boundary for a future approval: apply only the reviewed
disabled route/config block and run route-disabled health checks. No active
control-plane route, no live manager action, no employee-agent restart, no live
workspace write, no DB mutation, no secret access, no cron/watch change, and no
rollback command are included.

Expected effect: make the reviewed shadow route definition present but disabled
so the next approval can test reachability without designing the route under
pressure. Existing channel delivery and running agents should be unchanged.

Interruption window: none if the final implementation can be loaded without a
router update. If a router update, rollout, restart, or health-starting window is
required, execution must stop and return for approval with the exact affected
service, expected downtime/health-starting window, active-session check, and
rollback command.

Required preflight before approval:

- Fiona independent review of APP-01/02 closeout evidence and this APP-03 plan.
- Source diff review proving the route is disabled by default.
- Static import boundary test for forbidden live mutation adapters.
- Focused route/config tests proving disabled requests cannot reach the shadow
  wrapper and enabled-shadow fixture requests cannot produce live side effects.
- Action response review proving list/status/message planning responses do not
  expose workspace roots unless the action requires it.
- Private artifact path and retention owner for route-disabled proof and audit
  samples.

Health checks for the future approved run:

- Pre: `gateway-router` service `1/1`; active employee agents `1/1`; current
  active-session count captured; APP-01/02 private snapshot still present with
  restrictive permissions.
- Config: route flag reads `enabled=false`; route path is internal-only; trusted
  identity source is gateway-derived, not caller-provided.
- Route disabled: request to `/internal/agent-control/v1/shadow` returns a
  disabled/404/403-style response and records no shadow operation.
- Existing channels: sample read-only health/status check confirms Telegram,
  Teams, and existing gateway health are unaffected.
- Post: no new service restart events, no route enablement, no delivery attempts,
  no workspace writes, no DB mutations, no secret reads, no cron mutations, and
  no live-handler calls.

Expected logs/artifacts:

- Private artifact directory:
  `.artifacts/agent-control-live-approval/<run-id>/app03-review/`
- Expected files:
  - `app03-config-diff.review.patch`
  - `app03-static-boundary.review.txt`
  - `app03-route-disabled-health.review.json`
  - `app03-non-interruption.review.json`
  - `fiona-app03-independent-review.md`
- Expected log markers:
  - `agent-control.route.disabled`
  - `agent-control.authorization` only if a later enabled-shadow test is
    separately approved
  - no `message.delivery`, no workspace-write marker, no service-mutation
    marker, no DB write marker, no secret-read marker, no cron/watch mutation
    marker

Risk if wrong: gateway routing could interrupt channels or expose control paths
to the wrong callers. A disabled route bug could still shadow an existing route,
accept untrusted principals, disclose production-derived registry details, or
create false confidence if audit/disabled checks are not durable.

Rollback plan for the future approved run:

- Preferred stop: leave `agentControl.internalRoute.enabled=false`; no rollback
  needed if only source/config review occurs.
- If the disabled config was applied and causes no router restart: revert the
  config diff in source/config and verify route-disabled health again.
- If applying the disabled config required a router update: rollback is not
  pre-approved by this review packet. Prepare a separate rollback approval
  naming the exact prior config/image, service, command, backup path, monitoring
  window, and expected health proof.
- Preserve all APP-03 evidence and audit samples; do not delete diagnostic
  artifacts during rollback.

Proof it cannot perform live management actions:

- Route flag is disabled by default.
- `allowedActions` excludes `sendMessage` for APP-03.
- No live adapters are configured.
- Shadow wrapper side-effect counters must remain zero:
  `deliveryAttempts`, `workspaceWrites`, `serviceMutations`, `secretReads`,
  `cronMutations`, `liveHandlerCalls`.
- Audit append is fail-closed; no audit means no recorded shadow result.
- Static import boundary test must fail if the route imports live delivery,
  workspace, Swarm/Docker, secret, cron/watch, DB-mutation, session-cleanup, or
  rollback modules.

Open review requirements:

- Fiona must independently review APP-01/02 evidence and this APP-03 design
  before Kevin approves any router/gateway change.
- APP-04, APP-05, APP-06, and APP-07 remain held. APP-03 does not approve live
  manager-to-agent send, managed-file update, stale ingress cleanup, or SQLite
  repair.

Approval wording:

> I approve ACP-APP-03 only for applying the reviewed disabled/shadow-only
> internal gateway route config for `/internal/agent-control/v1/shadow`, with
> `enabled=false`, no live adapters, `sendMessage` denied, private audit/evidence
> artifacts, and the approved monitoring window. No live sends, workspace
> writes, route enablement, service deploy/restart, Swarm changes, DB mutation,
> cron/watch changes, secret changes, cleanup, rollback commands, or live
> management actions are approved. If a router/gateway restart or update is
> required, stop and notify me before proceeding.

## Packet ACP-APP-04: Live Manager-To-Agent Send Test

Recommendation: hold until route/service and non-interruption evidence pass.

Risk items: `ACP-R05`, `ACP-R14`, `ACP-R17`, `ACP-R18`, `ACP-R19`.

Intended action: send one approved test message from Artemis or Fiona to one
approved target agent through the management plane.

Targets: one named agent/session only, selected during a quiet window.

Exact change/command boundary: one message body, one idempotency key, one target
agent. No fanout, no tool-triggering request, no workspace writes.

Expected effect: prove non-preemptive manager-to-agent communication can be
queued/delivered with audit and without disrupting active turns.

Interruption window: possible session wake for the selected target.

Success evidence: authorization audit, idempotency key, delivery/session result,
no duplicate message, no active-turn cancellation, and target confirmation.

Risk if wrong: the test could interrupt work, create duplicate tasks, or make a
target agent act externally.

Rollback/stop path: send a cancel/correction only if separately approved; mark
test-owned queue/session artifacts as closed or voided with evidence.

Approval wording:

> I approve ACP-APP-04 for one live manager-to-agent send test to
> `<target-agent-id>` with the exact reviewed message body and idempotency key.
> No fanout, external action, workspace write, restart, cleanup, or additional
> sends are approved.

## Packet ACP-APP-05: Pending-Review Managed Markdown Update Test

Recommendation: hold until shadow evidence and registry snapshot are reviewed.

Risk items: `ACP-R04`, `ACP-R14`, `ACP-R17`, `ACP-R19`.

Intended action: create one pending-review managed Markdown update plan for an
approved target agent file.

Targets: one managed Markdown file declared in the approved registry, such as
`AGENTS.md`, `memory/*.md`, or `knowledge/**/*.md`.

Exact change/command boundary: create a pending-review plan only. No live file
write, no instruction reload, no workspace mutation.

Expected effect: prove the manager workflow can propose controlled `.md`
updates without changing the running agent.

Interruption window: none expected if pending-review-only.

Success evidence: normalized path, allowlist decision, pending-review artifact,
audit event, zero live workspace writes, and no reload.

Risk if wrong: a managed file could be changed live, altering agent behavior or
leaking context.

Rollback/stop path: close/reject the pending plan if strictly local/non-live;
live workspace rollback requires separate approval.

Approval wording:

> I approve ACP-APP-05 for one pending-review managed Markdown update plan
> against `<target-agent-id>:<managed-path>`. This does not approve live file
> writes, instruction reloads, workspace mutation, service restart, or automatic
> apply.

## Packet ACP-APP-06: Stale Teams Ingress Cleanup

Recommendation: approve only when the dry-run names exact candidate hashes and
the candidate is proven stale/superseded.

Risk items: `ACP-R10`, `ACP-R11`, plus onboarding/router-state risk.

Intended action: retire stale pending Teams ingress rows that repeatedly replay
old failed onboarding/auth turns.

Targets: exact dry-run candidate rows in the router state DB, identified by
redacted hash/request metadata.

Exact change/command boundary: backup DB/WAL/SHM, update only approved stale rows
to failed/superseded, preserve new inbound message behavior. No service restart
unless separately approved.

Expected effect: stop repetitive dispatch loops such as
`agent:main:main changed while starting work` without deleting valid new
messages.

Interruption window: brief DB write only; no agent offline time expected.

Success evidence: backup path, before/after row counts, queue pending count,
router DB integrity, and no recurrence across the next dispatch interval.

Risk if wrong: a valid user message could be marked failed and require the user
to resend.

Rollback/stop path: restore the backed-up rows/DB under separate rollback
approval if needed; otherwise ask the user to resend the affected message.

Approval wording:

> I approve ACP-APP-06 for the exact stale Teams ingress cleanup candidates shown
> by dry-run, with DB/WAL/SHM backup first and no service restart unless
> separately approved.

## Packet ACP-APP-07: SQLite Router DB Repair

Recommendation: hold until a live integrity check finds corruption/malformed
state again.

Risk items: `ACP-R10`, router/onboarding SQLite recovery.

Intended action: repair router SQLite corruption such as malformed delivery
queue or freelist mismatch.

Targets: router state DB and associated WAL/SHM files only.

Exact change/command boundary: pause provisioner if it is hammering the DB,
backup DB/WAL/SHM, run integrity/table diagnosis, build clean candidate, swap
only after candidate passes integrity, restart only gateway-router if required.

Expected effect: restore router DB integrity and stop queue maintenance errors.

Interruption window: possible router health-starting interval if swap/restart is
required.

Success evidence: backup path, candidate integrity result, active DB
`quick_check`/`integrity_check`, router health, employee service health, and log
quiet window.

Risk if wrong: router outage, lost stale queue entries, or restore from a bad
candidate.

Rollback/stop path: restore pre-repair DB/WAL/SHM from backup and restart only
gateway-router if approved.

Approval wording:

> I approve ACP-APP-07 only if router SQLite corruption/malformed state recurs:
> pause provisioner if needed, backup DB/WAL/SHM, build and integrity-check a
> repair candidate, and repair the router DB. Notify me before any router restart
> that can interrupt current agents unless the corruption is actively blocking
> onboarding during the approved work window.

## Packet ACP-APP-08: Provisioner Pause/Resume For Onboarding Repair

Recommendation: approve for bounded onboarding-hardening windows.

Approved window: narrow standing approval from approval time through
2026-09-13T23:59:59Z for onboarding repair only. It expires sooner if revoked
or if provisioner pause/resume is needed for a broader maintenance action.

Operator: Artemis/main unless explicitly reassigned in the evidence record.

Risk items: `ACP-R08`, onboarding/provisioner safety.

Intended action: pause or resume the Teams employee onboarding provisioner timer
while repairing a specific onboarding row, BWS stack wiring, or router DB issue.

Targets: onboarding provisioner timer only.

Exact change/command boundary: pause/resume the provisioner timer, no employee
service restart unless separately approved, no broad queue cleanup.

Expected effect: stop provisioner churn while a row/service/DB is repaired, then
resume maintenance.

Interruption window: no existing agent should go offline; new onboarding may wait
while paused.

Success evidence: timer state before/after, reason, affected onboarding slug,
services still healthy, and resumed state.

Required artifact/evidence: timer state before/after, affected onboarding slug,
reason, command transcript reference, pause duration, pass/fail result, service
health after resume, and explicit confirmation that no employee service restart,
DB mutation, queue cleanup, secret change, route change, or workspace write was
performed under this packet.

Risk if wrong: onboarding stalls or maintenance fails to resume.

Rollback/stop path: resume the timer, or keep it paused and alert if resuming
would reintroduce corruption/churn.

Approval wording:

> I approve ACP-APP-08 for bounded pause/resume of the Teams onboarding
> provisioner timer when directly needed for onboarding repair or SQLite safety.
> Do not restart employee agents or mutate unrelated rows under this approval.
