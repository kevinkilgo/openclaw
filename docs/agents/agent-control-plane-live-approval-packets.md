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

Recommendation: hold until shadow evidence passes.

Risk items: `ACP-R01`, `ACP-R02`, `ACP-R12`, `ACP-R13`, `ACP-R14`, `ACP-R16`,
`ACP-R20`, `ACP-R21`.

Intended action: stage an internal `/agent-control` route or service in
disabled/shadow-only mode.

Targets: gateway/router configuration or a new internal service definition.

Exact change/command boundary: enable only a disabled-by-default route/service
for shadow test traffic if separately scheduled. No employee restarts, no live
sends, no workspace writes.

Expected effect: make the shadow control plane reachable from trusted manager
contexts without exposing active management actions.

Interruption window: possible gateway/router health-starting interval if a
router update is required.

Success evidence: route/service health, trusted principal binding, deny samples,
audit append proof, no live side-effect counters, and existing channel delivery
continuity.

Risk if wrong: gateway routing could interrupt channels or expose control paths
to the wrong callers.

Rollback/stop path: disable the new route/flag or revert only the route config;
router rollback/restart requires separate approval if not included in the
approved command.

Approval wording:

> I approve ACP-APP-03 only for a disabled/shadow-only internal agent-control
> route or service using the exact reviewed config and monitoring window. Notify
> me before any router/gateway restart or update that can interrupt current
> agents.

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
