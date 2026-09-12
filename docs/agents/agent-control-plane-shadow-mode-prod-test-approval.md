# Agent Control Plane Shadow-Mode Prod-Test Approval Packet

Reviewer lane: Ariel-style architecture/prod-readiness review
Date: 2026-09-12
Target: internal agent management plane shadow-mode production test
Default state: hold pending explicit approval

## Recommendation

Approve only a bounded shadow-mode prod test that records authorization,
planning, audit, observability, and non-interruption evidence without delivering
control messages, writing managed files, mutating gateway/router config, changing
Swarm services, restarting agents, touching secrets, creating cron/watchers, or
altering live runtime state.

The test is acceptable as a production-observation exercise because the source
control-plane surface currently models safe operations and returns plans/audit
events. It is not acceptable as an active management-plane rollout.

## Objective

Prove that the internal agent management plane can:

- resolve logical agent-control records without exposing transient task or node
  identities;
- derive allow/deny decisions from registry grants;
- produce audit records for allowed and denied decisions;
- produce operation plans for `readStatus`, `sendMessage`, `readManagedFile`,
  and `requestManagedFileUpdate`;
- reject unmanaged Markdown paths and empty messages;
- record Tina/Artemis-style owner and evidence states only in a local fixture or
  non-actionable shadow namespace;
- maintain live-session non-interruption while observing production-like
  identities, targets, and request shapes.

## Evidence Reviewed

- `docs/agents/agent-control-plane.md`: registry contract, safe initial
  operations, managed Markdown path constraints, and rollout sequence.
- `docs/agents/agent-control-plane-prod-readiness-review.md`: must-fix gates
  for authenticated principal binding, durable audit capture, message safety,
  live-session non-interruption, registry integrity, and least-privilege
  response shapes.
- `docs/agents/agent-control-plane-prod-risk-register.md`: approval gates and
  rollback expectations for gateway routes, new internal services, employee
  restarts, workspace writes, manager-to-agent sends, registry migrations,
  Swarm aliases, cron/watchers, secrets permissions, rollback operations, and
  stale-session cleanup.
- `src/agents/control/agent-control.ts`: current registry, authorization,
  managed-file validation, pending-review update plan, and operation-plan
  implementation.
- `src/gateway/server-methods/agents.ts`: existing live `agents.*` management
  APIs, including list/create/update/delete and `agents.files.*` read/write
  behavior.
- `src/gateway/server-methods/agents-workspace.ts`: existing read-only
  workspace browsing surface.
- `src/gateway/control-plane-audit.ts`: current gateway control-plane actor
  extraction and changed-path audit helper shape.
- `src/gateway/control-plane-rate-limit.ts`: current write-side control-plane
  rate-limit helper.
- `packages/gateway-protocol/src/schema/agents-models-skills.ts`: existing
  gateway protocol schemas for agent list/create/update/delete and
  `agents.files.*`.

## Test Surface

Allowed shadow-mode inputs:

- small explicit registry fixture or read-only production-derived registry view
  with no secret values;
- authenticated caller facts as observed by the trusted gateway/service boundary;
- candidate target agent ids from the approved registry subset;
- candidate operation requests for `list`, `readStatus`, `sendMessage`,
  `readManagedFile`, and `requestManagedFileUpdate`;
- managed Markdown paths declared by the registry;
- synthetic message bodies and synthetic proposed Markdown content.

Allowed shadow-mode execution:

- call pure planning/authorization functions or a non-delivering wrapper around
  them;
- emit redacted, durable audit/observation events;
- compare observed plans against expected decisions;
- count what would have been allowed, denied, queued, read, or converted to a
  pending review plan.

Explicitly out of scope for this approval:

- enabling a live `/agent-control` route or equivalent manager-accessible
  endpoint;
- invoking `agents.create`, `agents.update`, `agents.delete`, or
  `agents.files.set`;
- writing live task-ledger rows, manager dashboard rows, alert-linked task
  views, or operator-visible status streams;
- sending a message to any live agent/session;
- reading arbitrary workspace paths beyond the approved managed Markdown
  simulation set;
- applying a managed-file update;
- changing gateway/router config, Swarm service definitions, network aliases,
  BWS/secrets permissions, cron jobs, watchers, cleanup jobs, or runtime config;
- restarting, scaling, deploying, or force-recreating any service.

## Non-Interruption Rule

This prod test must be non-interrupting.

No test step may preempt, cancel, resume, wake, message, reconfigure, restart,
reload, or otherwise alter a live agent session or service. `sendMessage` is
shadowed as a plan only: the expected result is "would queue/send", never an
actual delivery. `requestManagedFileUpdate` is shadowed as a
`pending_review` plan only: the expected result is never a workspace write or
instruction reload.

If any test implementation needs a live send, live route enablement, service
restart, registry DB migration, Swarm update, cron/watch change, secret
permission change, cleanup, or rollback command, it is outside this approval and
requires a separate item-specific approval packet.

## Risk Register References

- `ACP-R01`: gateway/router rollout remains held. Shadow mode must not enable a
  new route or change gateway routing.
- `ACP-R02`: new internal control route/service remains held. Shadow mode may
  inspect source and run local/planning wrappers only.
- `ACP-R03`: employee service restarts remain held. No restart, deploy, scale,
  or force-recreate is allowed.
- `ACP-R04`: live agent workspace writes remain held. Managed-file updates must
  stay as pending-review plans.
- `ACP-R05`: manager-to-agent sends remain held. `sendMessage` must not deliver
  to any live agent.
- `ACP-R06`: registry DB migrations remain held. Use fixture/read-only views
  only.
- `ACP-R07`: Swarm network/service alias changes remain held.
- `ACP-R08`: watchers and cron remain held. Do not create recurring or watched
  test jobs.
- `ACP-R09`: secrets/BWS permissions remain held. Do not request, print, move,
  or mutate secrets.
- `ACP-R10`: rollback commands are live mutations and remain approval-gated.
- `ACP-R11`: stale-session cleanup remains held.
- `ACP-R12`: trusted principal derivation remains a precondition for any
  production-derived identity observation.
- `ACP-R13`: durable audit persistence remains a precondition beyond local
  source tests.
- `ACP-R14`: live-session non-interruption remains mandatory; no control action
  may reach a live agent.
- `ACP-R15`: production-derived registry input must fail closed and name a
  last-good artifact.
- `ACP-R16`: response disclosure must stay action-scoped and least-privilege.
- `ACP-R17`: test-owned queues and pending plans must be contained.
- `ACP-R18`: upchain communication to Artemis/Fiona remains denied unless
  explicitly allowlisted.
- `ACP-R19`: task-ledger and dashboard accounting must stay local or
  non-actionable shadow-only unless separately approved.
- `ACP-R20`: shadow wrapper live-handler isolation must prove the test path
  cannot import or call live `agents.*`, delivery, restart/update, file-set, or
  mutation adapters.
- `ACP-R21`: shadow audit sink outage behavior must fail closed; unaudited prod
  shadow execution is not acceptable.
- `ACP-R22`: production-derived registry snapshots must be redacted, visibility
  reviewed, and retained only in approved private/evidence locations.

## Preconditions

- Test runner has a read-only or synthetic registry input that names the exact
  target agent ids under test.
- The principal used by the test is injected by trusted middleware or explicitly
  marked synthetic; caller-supplied principal bodies are treated as forged and
  must deny.
- Audit sink is ready before test start and captures allow and deny decisions
  with request id, actor, device/client identity where available, target,
  action, decision, reason, timestamp, and shadow-mode marker.
- The implementation path is verified not to call delivery, write, restart,
  config mutation, cron/watch, Swarm, or secret-manager APIs.
- Operators have a stop condition and an evidence collection path before the
  first production observation.

## Test Plan

1. Registry parsing and integrity observation
   - Load the approved fixture/read-only registry input.
   - Confirm invalid JSON, unsafe managed paths, unsupported actions, and
     duplicate ids fail closed or are reported as readiness blockers.
   - Record target count and managed-file declarations without secret values.

2. Principal-binding checks
   - Run one allowed manager principal derived from trusted context.
   - Run one forged caller-supplied principal and confirm denial.
   - Run one out-of-scope team/agent principal and confirm denial.

3. Authorization matrix
   - Exercise `list`, `readStatus`, `sendMessage`, `readManagedFile`, and
     `requestManagedFileUpdate` against each approved target.
   - Record allow/deny counts and reasons.
   - Confirm action-scoped grants do not bleed across operations.

4. Non-interrupting operation planning
   - For `readStatus`, produce only a status/read plan.
   - For `sendMessage`, produce only a "would queue/send" plan with no delivery
     id, no target session wake, and no tool-triggering behavior.
   - For `readManagedFile`, plan only approved Markdown allowlist paths.
   - For unmanaged paths, absolute paths, path escapes, non-Markdown files, and
     empty messages, confirm denial.
   - For `requestManagedFileUpdate`, produce only a `pending_review` plan.

5. Audit and observability verification
   - Confirm every attempted action, including denials, has a correlated audit
     event.
   - Confirm audit output redacts content where needed and contains no secrets.
   - Confirm metrics/logs identify shadow mode distinctly from active control
     actions.
   - Confirm any owner/evidence rows are local fixture rows or shadow-only rows
     that cannot trigger dashboards, alerts, follow-ups, or operator work.

6. Stop and review
   - Stop the test without running rollback commands.
   - Review audit counts, denied cases, error rates, unexpected live side-effect
     attempts, and non-interruption evidence.
   - Produce a go/no-go recommendation for the next gate.

## Observability

Required evidence:

- shadow-mode request id per attempted operation;
- actor/device/client identity from trusted context when available;
- target agent id and action;
- decision and reason;
- whether the action was planned, denied, or blocked by shadow-mode policy;
- counts for each action type;
- denial samples for forged principal, unmanaged path, non-Markdown path, empty
  message, and unauthorized target;
- explicit zero count for live deliveries, live writes, service restarts, route
  enables, cron/watch changes, secret operations, and cleanup operations.
- explicit zero count for live actionable task-ledger rows, dashboard work
  items, alert-linked tasks, and follow-up automation.

Recommended metrics/log fields:

- `agent_control_shadow_mode=true`
- `agent_control_action`
- `agent_control_decision`
- `agent_control_reason`
- `agent_control_target_agent_id`
- `agent_control_request_id`
- `agent_control_live_side_effect_attempted`

## Success Criteria

- All planned test cases run without live delivery, live writes, service
  restarts, route changes, registry DB migrations, Swarm changes, cron/watch
  changes, secret operations, or cleanup operations.
- Allowed and denied authorization cases match the registry grants.
- Forged principal cases deny.
- Managed-file path checks reject absolute paths, path escapes, unmanaged paths,
  and non-Markdown targets.
- `requestManagedFileUpdate` produces only pending-review output.
- `sendMessage` produces only a non-delivered shadow plan.
- Audit/observability captures every attempt, including denials, with
  correlation ids and shadow-mode markers.
- Tina/Artemis-style evidence states are recorded only as non-actionable shadow
  evidence and cannot be mistaken for live assigned work.
- No secret values appear in logs, docs, command lines, or evidence artifacts.

## Fail Criteria

Stop the test immediately if any of these occur:

- any live message is sent, queued for delivery, or wakes a target session;
- any workspace, registry DB, runtime config, gateway config, Swarm config,
  cron/watch declaration, or secret permission is mutated;
- any live task-ledger row, dashboard work item, alert-linked task, or
  operator-visible status row is created without `ACP-R19` approval;
- any service restart, deploy, scale, or route enablement is attempted;
- audit capture fails for an allowed or denied decision;
- caller-supplied principal data is accepted as authoritative;
- a managed-file path escape, absolute path, non-Markdown file, or unmanaged path
  is accepted;
- audit/log output exposes a secret or sensitive content body;
- test code cannot prove shadow-mode isolation from live `agents.*` mutation
  APIs.
- audit append fails and the runner continues anyway;
- production-derived registry snapshots appear in public repos, broad logs,
  dashboard surfaces, or other unapproved destinations.

## Rollback and Stop Plan

Because the approved test is shadow-mode only, normal stop should be:

1. stop the shadow-mode runner or disable the local test invocation;
2. preserve audit/evidence artifacts;
3. record the last request id and counts;
4. report any failure against the fail criteria.

No rollback command is pre-approved by this packet. If an unexpected live
mutation occurs, stop further actions, preserve evidence, identify the matching
risk-register item, and prepare a separate rollback approval packet under
`ACP-R10` with the exact target, command/change, expected effect, and recovery
path.

## Approval Wording

Approval needed:

> I approve the internal agent control-plane shadow-mode prod test described in
> `docs/agents/agent-control-plane-shadow-mode-prod-test-approval.md`, limited
> to non-interrupting authorization/planning/audit observation only. This
> approval does not authorize live route enablement, service deploy/restart,
> Swarm changes, registry DB migration, cron/watch changes, secret changes,
> workspace writes, live manager-to-agent sends, cleanup, or rollback commands.

Any approval with broader wording should be narrowed before execution. Any test
step outside this packet requires a new item-specific approval packet mapped to
the prod risk register.
