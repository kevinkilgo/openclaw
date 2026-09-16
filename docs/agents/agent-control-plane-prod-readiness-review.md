# Agent Control Plane Prod-Readiness Review

Reviewer: Ariel, senior AI architecture/risk review lane
Date: 2026-09-12

## Recommendation

Proceed with a bounded management-plane MVP test only after adding a prod-test gate around authentication, durable audit capture, and live-session non-interruption. The existing foundation is directionally sound for a dry-run or shadow-mode control plane because it separates logical agent identity from network reachability, constrains manager actions through an explicit registry, and models managed-file changes as pending review instead of direct mutation.

Do not connect this directly to live employee-agent sessions as an active control surface until the must-fix items below are closed and validated.

## Evidence Reviewed

- `src/agents/control/agent-control.ts`
  - `AgentControlRecord`, `AgentControlScope`, and `AgentControlPrincipal` define the registry, manager grants, and acting principal shape.
  - `normalizeAgentControlRegistry` and `normalizeAgentControlRecord` normalize agent ids, deduplicate capabilities, filter invalid managed file paths, and remove unrecognized actions.
  - `parseAgentControlRegistryJson` and `loadAgentControlRegistryFile` add JSON/schema validation and injected file-reader support for file-backed registries.
  - `authorizeAgentControlAction` decides allow/deny by direct manager id or manager team plus action grant, and returns an authorization audit event.
  - `listManageableAgents` filters targets by an authorized action.
  - `resolveAgentControlTarget` releases endpoint/workspace/capability details only after authorization.
  - `isManagedAgentMarkdownFile` rejects path escapes, absolute paths, non-Markdown targets, and unmanaged paths.
  - `buildManagedFileUpdatePlan` returns a `pending_review` plan and audit event without writing target files.
- `src/agents/control/agent-control.test.ts`
  - Covers file-backed registry parsing, malformed registry rejection, injected file-reader loading, id/capability normalization, direct and team manager authorization, denied out-of-scope access, action-scoped listing, authorized target resolution, managed Markdown path allow/deny behavior, and pending-review update planning.
- `docs/agents/agent-control-plane.md`
  - Documents the intended separation between Swarm reachability and management semantics, the safe initial operations, explicit managed Markdown paths, and a rollout sequence that defers live onboarding integration until a later gate.

## Must-Fix Before Prod Test

1. Bind principals to authenticated runtime identity.
   - Current authorization trusts an in-memory `AgentControlPrincipal` shape. A prod test needs a gateway or service boundary that derives `agentId`, `teams`, and any manager role claims from authenticated service identity, not caller-supplied request body fields.
   - The test should include forged-principal denial cases and a path proving the principal is injected by trusted middleware.

2. Persist audit events outside the request return path.
   - `authorizeAgentControlAction` and `buildManagedFileUpdatePlan` return audit events, but nothing in this foundation guarantees durable append, retention, correlation IDs, or denied-attempt visibility.
   - Prod testing should require append-only or tamper-evident audit persistence for allow and deny decisions, including actor, target, action, reason, request id, source service, and timestamp.

3. Define agent-to-agent message safety semantics.
   - `sendMessage` is modeled as a safe operation, but messaging can interrupt work, alter task state, or create external effects depending on the recipient's runtime.
   - Before prod testing, define whether `sendMessage` is queue-only, non-interrupting, user-visible, cancellable, rate-limited, and whether it can trigger tools. Default should be queued/asynchronous with explicit no preemption of active live sessions.

4. Add a live-session interruption guard.
   - The current contract has agent lifecycle status but no per-session state, lease, drain mode, or "do not disturb" control.
   - Prod tests should gate active commands against live session state and support shadow-mode reads, queued messages, and opt-in apply windows so employee sessions are not interrupted or reconfigured mid-turn.

5. Make registry integrity and ownership explicit.
   - The current schema-backed parser is a good start: malformed JSON, invalid actions, missing endpoint service names, and unsafe managed-file paths can fail closed before use.
   - Remaining prod-test risk: `normalizeAgentControlRegistry` still deduplicates by first record, and the schema does not appear to reject duplicate ids or empty-but-valid management grants. Prod config loading should fail closed on duplicate ids, empty action sets, no manager/team grant, and suspicious managed-file declarations.

6. Separate read access from workspace path disclosure.
   - `resolveAgentControlTarget` returns workspace root metadata after action authorization. That is acceptable for internal orchestration but should be minimized for callers that only need messaging or status.
   - Prod tests should return least-privilege response shapes per action and avoid exposing workspace roots unless the action requires file governance context.

## Acceptable MVP Boundaries

- Registry-backed discovery for a small, explicit set of internal agents.
- Read-only status and capability listing for authorized managers.
- Agent-to-agent messages only if delivered through an asynchronous queue that does not preempt or cancel active sessions.
- Managed Markdown reads only from explicit per-agent allowlists, with path normalization and Markdown-only constraints preserved.
- Managed-file updates limited to `pending_review` plans. No direct write, no live instruction reload, and no automatic workspace mutation.
- Shadow-mode prod test is acceptable: record what would be sent/read/updated and verify authorization/audit decisions without touching live agent runtime state.

## Rollback Expectations

- Feature flag or route gate must disable the management-plane endpoint without redeploying unrelated agent services.
- Registry changes must be Git-backed or otherwise versioned, with a known last-good registry and a one-step rollback path.
- Queued messages must support hold, drain, or discard before delivery if the test is stopped.
- Managed-file update plans must remain pending artifacts until separately approved; rollback should be deletion/closure of the pending plan, not restoration of live files.
- Audit persistence must survive rollback. Rollback should not delete evidence of attempted control actions.
- Live sessions should continue under their existing session runtime if the control plane is disabled.

## Open Questions

- What service or gateway owns principal derivation and team membership, and what identity material is trusted at that boundary?
- Where will audit events be stored, and what retention/search requirements apply for internal incident review?
- Does `sendMessage` mean a conversational message, a management command, or both? If both, it should split into separate actions with different risk controls.
- How will active session state be queried before a control action, and what state blocks interruption?
- Who approves `requestManagedFileUpdate` plans, and what mechanism applies them after review?
- Should manager team grants be case-sensitive as currently implemented for `teams`, or normalized to a canonical directory/team id?
- Should registry normalization fail on invalid config in prod while remaining permissive for in-memory helper use?

## Overall Risk Rating

Medium for shadow-mode prod testing after the must-fix gates are added. High if connected directly to live agents as an active message/file-management surface without authenticated principal binding, durable audit persistence, and explicit non-interruption controls.
