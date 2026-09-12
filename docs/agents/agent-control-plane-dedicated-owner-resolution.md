# Agent Control Plane Dedicated Owner Resolution

Date: 2026-09-12
Status: Proposed resolution
Scope: source/docs proposal only

Fiona feedback incorporated: 2026-09-12. Artemis attempted direct clarification
through `agent:main:supervision-fiona-20260911`; no immediate reply was returned,
so this proposal treats Kevin-provided Fiona feedback as the governing design
input and leaves the remaining questions explicit.

## Requirement

Kevin's requirement is that Artemis, Fiona, and their teams can communicate with
any agent created in the environment and manage approved agent Markdown files at
a managerial level, without interrupting currently running agents unannounced.

The proposed resolution is to make the internal agent control plane the single
management surface for this work. Swarm, Teams, gateway routing, production
databases, cron/watchers, secrets, and live agent workspaces remain outside this
proposal until separately approved through the existing production risk gates.

## Assigned Owner Recommendation

Assign Artemis as the dedicated accountable owner for the agent management plane.

Rationale:

- Artemis is already the Chief of Staff and operating controller for the agent
  organization.
- The requirement is managerial: discovery, communication policy, delegation
  safety, and approved instruction-file governance across teams.
- Artemis can own cross-agent consistency while Fiona owns finance/business
  agent policy input and approval criteria for her lane.
- The existing design already models manager identities, manager teams, safe
  operations, and pending-review managed-file plans.

Recommended accountability model:

- Accountable owner: Artemis
- Business/governance co-owner: Fiona
- Engineering implementation owner: Justin
- Architecture/prod-readiness reviewer: Ariel
- Platform/security operations reviewer: Richard
- Executive/operator documentation reviewer: Willow
- Final external/live-action approver: Kevin, unless a narrower standing
  authorization is later recorded

Artemis should own the source-of-truth roadmap, acceptance criteria, risk
register alignment, delegation ledger, readiness packets, and go/no-go
recommendations. Fiona should co-own policy decisions that affect finance,
business operations, authoritative records, or delegated business agents.

## Proposed Control Model

Use the registry-backed control model already documented in
`docs/agents/agent-control-plane.md` and implemented in
`src/agents/control/agent-control.ts`.

Managerial actions should start with the existing safe operation vocabulary:

- `list`
- `readStatus`
- `sendMessage`
- `readManagedFile`
- `requestManagedFileUpdate`

The control plane must treat these actions as management intents, not direct
runtime privileges:

- `list` and `readStatus` return least-privilege status views.
- `sendMessage` is queue-only, idempotent, non-preemptive, rate-limited, and
  stoppable before delivery.
- `readManagedFile` is limited to explicit per-agent Markdown allowlists.
- `requestManagedFileUpdate` creates a `pending_review` plan only.
- Applying a Markdown update to a live agent workspace is a separate audited
  config action under `ACP-R04`.

Fiona's required config-management shape should become the explicit API model:

- `agent.config.read(agent_id, file)`
- `agent.config.propose(agent_id, file, patch, reason)`
- `agent.config.apply(change_id)`
- `agent.config.rollback(change_id)`
- `agent.config.history(agent_id)`
- `agent.reload(agent_id)`

The control plane may write to an agent's actual workspace path under the hood,
but never through shared filesystem access as the primary interface. Writes must
flow through the audited config API with backups, validation, policy checks,
approval state, and rollback records. Emergency direct workspace access remains
break-glass only.

All newly created agents should be enrolled into the control-plane registry as a
provisioning step before they are considered managerially reachable. Enrollment
should include logical id, owner team, role, lifecycle status, service identity,
capabilities, manager grants, and explicit managed Markdown paths.

The core design principle is:

```text
registry + task ledger + audited config patches + scoped authority
```

not raw cross-agent editing or broad workspace mounts.

## Manager Dashboard

Add a manager dashboard for Artemis and Fiona after the registry and durable
task loop exist. The first MVP should be read-only unless a separate approval
explicitly enables active controls.

Dashboard fields:

- all agents by team and owner;
- current health/status;
- active tasks and task state;
- last check-in;
- blocked agents;
- pending config proposals;
- recent managed Markdown changes;
- agents needing reload or restart;
- alert-linked tasks;
- stale tasks with escalation state.

The dashboard should connect to the monitoring workstream: alerts may create or
suggest management tasks, but they should not directly mutate agent runtime
state without the same approval and risk-register gates.

## Supporting Roles

Artemis:

- Owns the management-plane roadmap and operating policy.
- Maintains the registry governance model and manager/team grant policy.
- Produces approval packets for any live action or rollback.
- Confirms every current-agent non-interruption gate before a prod test.

Fiona:

- Co-owns manager policy for finance/business agents and any business-critical
  Markdown governance.
- Reviews approval criteria where agent communication or file policy could
  affect business decisions, financial work, or authoritative records.
- Helps define team-level grants for Fiona-owned agents.

Justin:

- Implements source changes in `src/agents/control/` and adjacent non-live
  adapters.
- Adds unit and contract tests for registry integrity, principal binding,
  least-privilege response shapes, and pending-review file plans.
- Keeps source implementation dry-run/shadow-mode until live integration is
  approved.

Ariel:

- Reviews architecture, risk surfaces, compatibility with the existing gateway
  and session model, and prod-readiness gates.
- Owns second-review criteria before any active management route is proposed.

Richard:

- Reviews platform operations, runtime safety, audit durability, route/service
  exposure, rollback packets, and non-interruption evidence.
- Does not restart, scale, deploy, mutate Swarm, touch secrets, or change
  gateway/cron/watch state without explicit approval.

Willow:

- Converts approved policy into operator-facing docs, review templates, and
  managerial workflow guidance.
- Ensures the process is clear enough for Artemis/Fiona teams to use without
  bypassing gates.

## Phased Implementation Plan

Phase 0: Ownership and acceptance criteria

- Record Artemis as accountable owner and Fiona as governance co-owner.
- Define the initial manager teams and agent categories covered by the plane.
- Define acceptance criteria for "communicate with any/all agents" as registry
  reachability plus non-interrupting message planning, not direct live delivery.
- Define acceptance criteria for "manage approved agent .md files" as
  allowlisted Markdown reads and pending-review update plans, not direct writes.

Phase 1: Inventory and registry

- Build the agent registry from current containers, services, workspaces, and
  known employee-agent roots such as `/srv/openclaw/data/employee-agents/`.
- Capture logical agent ids, teams, service identities, workspaces, lifecycle
  status, capabilities, manager grants, and managed Markdown allowlists.
- Keep discovery read-only and fail closed on duplicate ids, unsafe paths,
  empty grants, invalid service identities, or stale registry inputs.

Phase 2: Durable manager messaging

- Formalize manager-to-agent task delivery with acknowledgement and evidence
  states: requested, accepted, blocked, rejected, done.
- Make `sendMessage` queue-only, idempotent, non-preemptive, and observable
  before any live delivery path is approved.
- Use the Tina/Artemis ledger pattern as the behavioral model: no silent drops,
  every managerial ask gets an owner and evidence state.

Phase 3: Markdown proposal/apply system

- Add `agent.config.read`, `agent.config.propose`, `agent.config.history`, and
  pending-review proposal records for approved Markdown files.
- Add safe patch validation, backups, secret-pattern scans, policy checks,
  affected-agent metadata, approver capture, and rollback ids.
- Keep `agent.config.apply`, `agent.config.rollback`, and `agent.reload`
  approval-gated until Kevin approves standing authority or target-specific
  live actions.

Phase 4: Manager dashboard

- Build the read-only manager dashboard for Artemis/Fiona over registry,
  health, tasks, pending config proposals, recent Markdown changes, reload
  needs, and alert-linked tasks.
- Hide or disable active apply/reload controls until the apply/reload gates are
  approved.

Phase 5: Policy automation

- Add automatic checks: no secrets in Markdown, no unauthorized identity
  changes, no external-action permission expansion without approval, no unsafe
  workspace path changes, no stale tasks without escalation, and no hidden
  live-side effects from monitoring alerts.

## Source-Only Hardening Tasks

In parallel with the phases above:

- Keep implementation under `src/agents/control/`.
- Ensure production registry parsing fails closed for duplicate ids, empty
  grants, empty actions, unsafe managed paths, and invalid endpoint names.
- Preserve per-agent managed Markdown allowlists and path normalization.
- Split response shapes by action so list/status/message planning does not
  disclose workspace roots or managed paths unnecessarily.
- Add tests for team grant normalization, forged principal denial, out-of-scope
  denial, managed Markdown allow/deny, and pending-review plans.

Trusted identity and audit design:

- Design the trusted gateway/service boundary that derives manager identity,
  teams, and roles from authenticated runtime context.
- Reject caller-supplied `agentId`, teams, roles, or grants as authoritative.
- Define durable audit fields for allow and deny decisions: request id, actor,
  source service, target agent id, action, decision, reason, timestamp, and
  shadow-mode marker.
- Name the audit sink and retention owner before any prod observation.

Shadow-mode management wrapper:

- Build a non-delivering wrapper that calls planning/authorization functions and
  emits audit observations.
- Ensure `sendMessage` produces only a "would queue" plan in this phase.
- Ensure `requestManagedFileUpdate` produces only a `pending_review` plan.
- Prove the wrapper cannot call live delivery, live workspace writes,
  `agents.files.set`, service restart/update paths, Swarm APIs, cron/watch APIs,
  secret-manager APIs, or production DB mutation paths.

Bounded prod-test path:

- Use the existing shadow-mode approval packet as the first production path.
- Limit the prod test to authorization, planning, audit, observability, and
  non-interruption evidence.
- Use synthetic or read-only registry input with no secret values.
- Observe only approved metadata and non-secret logs/metrics.
- Produce a go/no-go packet before any active route, delivery queue, or file
  apply path is proposed.

Active management pilot after approval:

- Enable only the smallest approved route/service surface.
- Start with `list`, `readStatus`, and `readManagedFile`.
- Add `sendMessage` only after `ACP-R05` and `ACP-R14` are explicitly approved.
- Add managed-file apply only after Git-backed review/apply workflow, backup,
  checksum, rollback, and `ACP-R04` approval are complete.
- Expand target coverage by registry enrollment, not by direct workspace or
  service discovery.

## Prod-Test Path

The recommended prod-test path is shadow mode first.

Entry criteria:

- Artemis is named test owner and stop authority.
- Fiona has reviewed business/governance implications for covered agents.
- Trusted principal binding is designed and forged-principal denial is tested.
- Audit destination and retention owner are named.
- Registry input is fixture-based or read-only and contains no secret values.
- `sendMessage` is non-delivering plan-only.
- `requestManagedFileUpdate` is pending-review only.
- No route enablement, service deployment, restart, Swarm change, registry DB
  migration, cron/watch change, secret change, workspace write, cleanup, or
  rollback command is part of the test.

Success evidence:

- Allow/deny decisions match registry grants.
- Forged principals deny.
- Unmanaged, absolute, escaped, and non-Markdown paths deny.
- Empty messages deny.
- All attempts have audit events with request ids and shadow-mode markers.
- Live delivery count is zero.
- Live workspace write count is zero.
- Service restart/deploy/scale count is zero.
- Route, Swarm, cron/watch, secret, and DB mutation counts are zero.
- Current agent sessions continue without preemption, cancellation, duplicate
  delivery, or unannounced wakeups.

Exit criteria:

- Test requests stop.
- Audit evidence is preserved.
- No queued test message or pending plan can reach live agents unexpectedly.
- Deviations are added to the readiness review or risk register before the next
  approval.

## Rollback and Non-Interruption Gates

Default gate: hold pending explicit approval for any live mutation.

Required non-interruption gates:

- No employee-agent restart, scale, deploy, drain, force-recreate, or
  instruction reload is allowed as part of source/docs prep or shadow mode.
- No manager-to-agent live send is allowed unless the exact target, content,
  timing, idempotency key, and rollback behavior are approved under `ACP-R05`.
- No active session may be preempted, cancelled, resumed, awakened, or
  reconfigured by the control plane without explicit prior approval.
- `sendMessage` must be queue-only and held/discardable before delivery until
  live delivery is separately approved.
- `requestManagedFileUpdate` must remain a pending plan until a Git-backed apply
  workflow and `ACP-R04` approval exist.
- Any rollback touching live route/service/config/DB/queue/workspace/cron/secret
  state requires its own approval under `ACP-R10`.
- Audit evidence must survive stop or rollback; rollback must not delete
  evidence.

Stop triggers:

- Any live message is delivered or queued outside the approved boundary.
- Any workspace file, registry DB, runtime config, gateway config, Swarm config,
  cron/watch declaration, secret permission, or cleanup path is mutated.
- Any service restart/deploy/scale is attempted.
- Audit capture misses an allow or deny decision.
- Caller-supplied identity is accepted as authoritative.
- A managed-file path escape, absolute path, unmanaged path, or non-Markdown
  target is accepted.
- Any secret value appears in logs, docs, commands, URLs, screenshots, or audit
  payloads.

Additional config-management gates:

- `agent.config.apply(change_id)` is approval-gated by default.
- `agent.config.rollback(change_id)` is approval-gated by default because
  rollback is also a live mutation.
- `agent.reload(agent_id)` is approval-gated by default because it may interrupt
  active work or alter instruction/runtime state.
- Dashboard actions stay read-only until the matching apply/send/reload risk
  item is approved.
- Shared workspace mounts are not a valid normal-management interface; use only
  as break-glass under separate incident approval.

## Open Decisions

- Which service boundary will derive trusted Artemis/Fiona/team identity for the
  control plane?
- What is the durable audit sink, retention period, search path, and owner?
- Should manager team ids be case-sensitive or canonicalized through a directory
  identity source?
- What exact fields are allowed in each action-specific response shape?
- Does "communicate" mean conversational message only, management command only,
  or separate actions with separate grants and approvals?
- Who approves pending managed-file plans after Artemis/Fiona review and before
  live workspace application?
- What is the canonical registry source for newly created agents before a
  production registry database exists?
- Should all new agents inherit a default Artemis management grant, or should
  ownership-specific grants be required at creation time?
- Should `agent.config.apply(change_id)` require Kevin approval for every live
  workspace write at first, or can Artemis/Fiona later receive scoped standing
  authority for low-risk Markdown updates?
- What exact validation suite blocks `agent.config.apply`: Markdown parser,
  secret scan, identity/authority diff, external-action permission diff,
  bootstrap-file safety check, and agent-specific policy checks?
- What is the first dashboard backing store: registry + task ledger + health
  metadata only, or a new dedicated management database?
- How should alerts create suggested management tasks without creating live
  control actions?
- What conditions make `agent.reload(agent_id)` safe enough for a maintenance
  window versus requiring explicit one-off approval?

## Concrete Next Tasks

1. Artemis: accept or revise this ownership model and record the accountable
   owner/co-owner decision in the control-plane docs.
2. Artemis and Fiona: define initial manager teams, covered agent categories,
   and default grant policy for newly created agents.
3. Artemis and Fiona: finalize answers to the config apply/reload authority
   questions above.
4. Justin: add or confirm source tests for fail-closed registry integrity,
   forged-principal denial, action-scoped responses, and pending-review managed
   Markdown plans.
5. Justin: draft source interfaces for `agent.config.read`,
   `agent.config.propose`, `agent.config.apply`, `agent.config.rollback`,
   `agent.config.history`, and `agent.reload` with live methods stubbed or
   shadow-mode only.
6. Ariel: review the action-specific response model and confirm the shadow-mode
   prod-test boundary remains non-interrupting.
7. Richard: identify the proposed audit sink and route/service disable strategy
   without touching live services.
8. Willow: prepare operator workflow docs for manager requests, Markdown review
   packets, and approval handoffs after the technical gates are accepted.
9. Artemis/Willow: draft the read-only manager dashboard information
   architecture.
10. Artemis: prepare the next approval packet only after the above source/docs
    tasks have concrete evidence and no live side effects.

## Source Evidence

Reviewed source/docs:

- `docs/agents/agent-control-plane.md`
- `docs/agents/agent-control-plane-prod-readiness-review.md`
- `docs/agents/agent-control-plane-prod-risk-register.md`
- `docs/agents/agent-control-plane-prod-test-rollback-runbook.md`
- `docs/agents/agent-control-plane-shadow-mode-prod-test-approval.md`
- `src/agents/control/agent-control.ts`

No Tina-named ledger file was found under the repository path scan. Existing
operations docs reference Tina-owned capture responsibilities for separate BWS
workstreams, but they were not needed for this source/docs-only proposal.

External feedback source:

- Kevin-provided Fiona feedback on 2026-09-12 covering config APIs, manager
  dashboard, shared-filesystem avoidance, and implementation phases.
