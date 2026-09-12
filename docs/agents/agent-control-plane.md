# Agent Control Plane

The agent control plane separates network reachability from management semantics.
Swarm DNS and service VIPs give agents a stable way to reach services, but they
do not decide who can discover agents, message them, read status, or propose
managed instruction-file changes. Those actions must flow through a registry and
authorization layer.

## Registry Contract

Each managed agent is represented by a logical record:

- `id`: stable agent id used by manager workflows.
- `ownerTeam`: team that owns the agent, such as `artemis` or `fiona`.
- `role`: human-readable role for routing and review.
- `status`: lifecycle state such as `ready`, `degraded`, or `blocked`.
- `endpoint`: in-swarm service identity, not a node IP, container id, or task IP.
- `workspace`: governed workspace root plus explicit managed Markdown paths.
- `capabilities`: routing hints for managers.
- `management`: manager agent ids, manager teams, and allowed safe operations.

The registry may also define two global policies:

- `fleetManagement`: Artemis, Fiona, and approved leadership teams may manage
  every registered agent/container/subagent for the listed safe operations,
  unless a target is explicitly excluded.
- `upchainCommunication`: employee/subagent initiated communication to Artemis
  or Fiona is denied by default and allowed only when the source agent id or
  source owner team is explicitly listed.

The registry resolves:

```text
agent-id -> endpoint/workspace/capabilities -> authorized action
```

Registry discovery can also be represented as a source-only snapshot artifact.
The artifact contains the dry-run registry snapshot plan, deterministic
normalized agent ids, generated summary counts, and schema validation for JSON
round trips. It is intended for tests, review, and shadow-mode control-plane
work; it does not read live workspaces, contact agent services, or mutate any
runtime state.

## Safe Operations First

The initial control surface only models safe operations:

- `list`
- `readStatus`
- `sendMessage`
- `readManagedFile`
- `requestManagedFileUpdate`

`requestManagedFileUpdate` deliberately creates a pending review plan. It does
not write files. This keeps file governance separate from arbitrary filesystem
access and leaves room for audit, review, and Git-backed changes before live
agent instructions are mutated.

## Directional Communication Policy

Manager-to-agent and employee-to-manager communication are separate grants.

Artemis and Fiona need fleet-wide management reachability so they can govern and
coordinate all registered agents. That is modeled through `fleetManagement` and
remains limited to the safe operations allowed in the registry.

Employee or subagent communication up the chain is stricter: no source may send
to Artemis or Fiona unless it is explicitly present in `upchainCommunication`.
This prevents newly created, compromised, retired, or unknown agents from
opening unreviewed communication paths to the management layer.

## Managed Files

Managers can only target explicit Markdown paths or folders declared on the
agent record. The control layer rejects absolute paths, `..` escapes, non-
Markdown files, and files outside the declared managed set.

Typical managed files are:

- `AGENTS.md`
- `SOUL.md`
- `USER.md`
- `MEMORY.md`
- `memory/*.md`
- `knowledge/**/*.md`

The allowed set is always per-agent and explicit.

## Rollout Sequence

1. Land the registry and authorization primitives in source.
2. Add an internal `agent-control` service or gateway route that exposes safe
   read/message operations through this module.
3. Register Artemis/Fiona/team agents by logical id and service name.
4. Add audited read access for managed Markdown files.
5. Add Git-backed review/apply flow for managed Markdown updates.
6. Only then connect the control plane to live employee onboarding templates.

This lets the control plane build in parallel to employee Teams onboarding
without changing the onboarding runtime until an explicit rollout gate.
