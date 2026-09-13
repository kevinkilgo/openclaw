# OpenClaw Onboarding Hardening Runbook

Date: 2026-09-13
Scope: onboarding reliability during approved hardening window
Mode: source/docs/scripts only until a separate live-action approval is granted

## Boundary

This runbook is for preparing and validating the next employee onboarding tests. It does not authorize live mutation.

Allowed now:

- Read source, docs, generated proof artifacts, and local copies of state.
- Create or update docs and scripts.
- Run read-only validation helpers against copied snapshots or explicit read-only mounts.
- Prepare approval packets for live service, Swarm, database, secret, cron, or Teams cleanup work.

Approval-gated:

- Mutating live SQLite router state, WAL files, pending request tables, or plugin state.
- Pausing, resuming, retrying, or completing live provisioning requests.
- Changing Docker/Swarm services, secrets, mounts, stacks, cron, relay, bridge, network, or Teams app registration.
- Deleting stale Teams ingress rows, relay state, queues, files, or pending requests.
- Reading or printing BWS access tokens, secret values, bearer tokens, OAuth payloads, raw Teams peer ids, or raw route identifiers.

## Snapshot First

Every live repair starts with a named snapshot and an undo target. Do not run a repair command until the snapshot exists, the snapshot integrity check passes, and the rollback owner is named.

Minimum snapshot packet:

| Surface            | Required evidence                                                                                           | Rollback target                                                 |
| ------------------ | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Router SQLite DB   | copied DB path, WAL/SHM copied when present, SHA256, `PRAGMA integrity_check` or documented failure         | restore copied DB/WAL/SHM after stopping writer                 |
| Router config      | active config path, SHA256, validation result                                                               | restore prior config and restart only approved service          |
| Provisioning state | request id, state, updated timestamp, redacted target employee slug, pending count                          | restore request row or replay from snapshot only after approval |
| BWS mounts         | mount path names, file presence/permissions, redacted project visibility result                             | unmount/revert service mount or token secret reference          |
| Teams ingress      | queue namespace/table/file, current count, oldest/newest timestamps, stale candidate ids redacted or hashed | restore from queue snapshot or DB copy                          |

## SQLite Router DB Corruption And Repair Order

Use this order when the router DB reports corruption, malformed WAL state, lock errors, or onboarding queue reads fail.

1. Freeze mutation.
   - Stop provisioning retries, admin dry-runs, smoke retries, and any execute-mode command.
   - If a writer must be stopped, pause only the approved writer service and record the service name, old image, replica state, and rollback image.
2. Snapshot the exact DB set.
   - Copy `router.db`, `router.db-wal`, and `router.db-shm` when present as one set.
   - Record SHA256 and file sizes before any repair.
   - If possible, snapshot the backing volume or host path before file copy.
3. Run read-only integrity checks on the snapshot.
   - Prefer `sqlite3 "$SNAPSHOT_DB" 'PRAGMA integrity_check;'`.
   - If `sqlite3` is unavailable, use Python's standard `sqlite3` module against the snapshot.
   - Capture `PRAGMA wal_checkpoint(PASSIVE);` only on a copied DB, not live state.
4. Classify the failure.
   - `ok`: do not repair; look for application or permission failures.
   - lock/busy only: do not rebuild; identify writer ownership or stale process.
   - WAL mismatch: re-copy DB/WAL/SHM while writer is paused; do not mix files from different times.
   - integrity failure: preserve snapshot and prepare repair approval.
5. Repair only a copy first.
   - Try `.recover` when the installed sqlite CLI supports it.
   - Alternative: `.dump` into a new DB if `.recover` is unavailable and schema/data loss is acceptable after review.
   - Run schema sanity checks and onboarding queue count comparison on the repaired copy.
6. Approval-gated restore.
   - Stop the approved writer.
   - Move the active DB set aside to a timestamped rollback directory.
   - Place the repaired DB set.
   - Start only the approved writer.
   - Re-run integrity, config validation, health checks, pending count, and a no-secret leak scan.

Rollback:

1. Stop only the service approved for restore.
2. Move the repaired DB set to a timestamped failed-repair directory.
3. Restore the pre-repair DB/WAL/SHM set from the snapshot.
4. Start the service on the rollback image/config if that was part of the approval.
5. Re-run DB integrity, router health, active config hash, pending count, and unaffected employee service checks.

## Provisioner Pause And Resume

Pause/resume is a state transition, not a restart shortcut. Use it to stop duplicate employee creation, wait for human BWS admin action, or hold after a failed proof.

Pause checklist:

- Identify request id, employee slug, current state, target service name, and last transition timestamp.
- Prove the request is not already terminal.
- Snapshot provisioning state and router DB before transition.
- Record whether the pause is operational (`paused_operator`), waiting for Bitwarden admin (`awaiting_bws_admin`), waiting for secure capture (`awaiting_bws_token_capture`), or blocked by validation (`blocked_validation`).
- Do not delete pending requests to pause them.

Resume checklist:

- Reconfirm the same request id and employee slug.
- Confirm the blocker is cleared with evidence:
  - BWS admin grants exist as metadata only;
  - secure token capture marker exists without exposing value;
  - target service/scaffold absence or readiness is proven;
  - DB integrity and active config validation pass.
- Resume only through the supported provisioner/operator path named in the approval packet.
- Stop before Teams smoke unless the approval explicitly includes one trusted DM with nonce and evidence predicates.

Rollback:

1. If resume fails before mutation, leave the request paused and attach the blocker evidence.
2. If resume creates a bounded resource, remove or quarantine only the resources named in the rollback approval.
3. Restore the prior request state from snapshot if the transition itself was wrong and approval includes DB/request mutation.
4. Re-prove pending count, active config hash, DB integrity, and unaffected peers.

## BWS Mount Verification For Employee Services

The BWS check must prove access shape, not secret values.

Expected evidence:

- Employee runtime has a token source mounted or injected through the approved secret-safe path.
- Employee-private project is visible to the runtime identity.
- Shared connector project `openclaw-employee-connectors` is visible to the same runtime identity.
- Required SecretRef keys are resolvable as present/absent or shape-only.
- No secret value, token, bearer, OAuth payload, SFDX auth JSON, or Krisp OAuth store content is printed.

Read-only validation pattern:

1. Inspect mount paths by name and permissions only.
2. Confirm the runtime user can read the token source without echoing it.
3. Run BWS project and secret metadata listing with redaction.
4. Run `scripts/secrets/openclaw-bws-resolver.mjs` only through a harness that discards values and reports boolean resolution.
5. Record project names/ids and required key names only.

Approval-gated live actions:

- Adding a Docker secret.
- Changing a service mount.
- Rotating or revoking a BWS token.
- Granting a machine/service account access to an employee or shared project.
- Restarting/reconciling employee services to pick up a mount.

Rollback:

1. Restore previous service spec or secret mount.
2. Revoke the new token only if approval covers revocation.
3. Remove newly added project grants only if approval covers Bitwarden admin cleanup.
4. Re-run metadata-only project visibility proof for the previous identity.

## Stale Teams Ingress Cleanup

Stale ingress cleanup is destructive when it deletes queues, pending requests, relay files, or plugin state. The default action is inventory only.

Inventory checklist:

- Define stale threshold and approved namespace, for example Teams onboarding capture requests older than the test window.
- Identify source of truth: router SQLite table, plugin state namespace, relay queue, file-backed ingress queue, or dead-letter store.
- Count current entries, oldest/newest timestamps, and candidate stale entries with ids redacted or hashed.
- Check whether any candidate maps to a non-terminal onboarding request.
- Confirm no current tester nonce, trusted DM window, or active employee route depends on the candidate.

Approval-gated cleanup:

- Export candidates to a snapshot file.
- Delete only the approved ids or approved age-qualified namespace.
- Do not run broad `DELETE` without a `WHERE` clause tied to the packet.
- Re-run count, oldest/newest timestamps, and current test nonce absence/presence checks.

Rollback:

1. Stop the writer if required by the restore path.
2. Restore deleted rows/files from the export or full DB snapshot.
3. Re-run queue health, pending count, and router health.
4. Mark any replayed ingress entries as restored from rollback in the proof packet.

## Validation Checklist For Next Testers

Before each tester:

- Current router DB snapshot exists and passes integrity, or the blocker is documented.
- Active router config hash and validation result are recorded.
- Provisioner request state is empty or contains only approved pending requests.
- BWS runtime identity can see the employee project and `openclaw-employee-connectors` by metadata only.
- Required BWS SecretRefs resolve as present without printing values.
- Target employee service/scaffold/stack absence or readiness is proven according to test phase.
- Teams ingress queue has no stale candidate that could consume the tester nonce.
- The exact Teams initiation path, expected nonce, and evidence window are named.
- Rollback owner and rollback snapshot paths are named.

After each tester:

- Record pass/blocker state with evidence, not intent.
- Preserve DB/config/provisioning/Teams snapshots for the test window.
- Re-run DB integrity and pending count.
- Re-run leak scan over new artifacts before sharing.
- If blocked, name the smallest next approval: DB repair, provisioner state transition, BWS grant/mount update, Teams ingress cleanup, service reconcile, or source/build/proof change.

## Approval Packet Template

Use this packet before any live mutation:

```text
Intended action:
Target system/person/channel:
Exact command or change:
Expected effect:
Snapshot paths and hashes:
Risk if wrong:
Rollback path:
Validation after action:
Explicit exclusions:
Approval wording needed:
```

## Companion Validation Helper

Use `scripts/operations/onboarding-hardening-validate.sh` for local read-only evidence collection. It can inspect copied SQLite snapshots, path presence, and candidate artifact text. It intentionally does not pause services, alter DBs, call Docker/Swarm, change BWS, or clean Teams ingress.
