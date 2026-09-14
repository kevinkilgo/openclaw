# PR #2 Router Preflight Foreign DB Blocker

status_run_id: `20260914T210551Z-pr2-router-preflight-foreign-db`

overall_result: `patched_pending_rebuild`

## STATUS

PR #2 production promotion is blocked by a router startup preflight bug, not by the employee agent database itself. The attempted production deploy rolled back because the new router image exited `78` after gateway startup inspected a separately running employee agent database and hard-failed on its older agent DB schema.

## Root Cause

File/function: `src/state/openclaw-database-preflight.ts`

- `assertOpenClawDatabasesReady({ operation: "gateway-startup" })` called `preflightOpenClawDatabaseSchemas` with startup readiness enabled.
- That path inspected registered persistent agent databases broadly, including employee/foreign agent DBs such as `babbey`.
- `assertCanonicalAgentPersistenceVersion` then treated the employee DB's schema version `17` as a router startup blocker.

The intended router safety check is still valid for the router/default agent DB and shared state. It should not hard-fail router startup on independently running employee agent DBs.

## Proposed Fix

Implemented a narrower gateway-startup preflight scope:

- Added `resolveGatewayStartupAgentDatabaseCandidatePaths`.
- For `gateway-startup`, preflight now checks shared state plus router/default session-store DB candidates.
- Gateway startup opts out of persistent registered foreign DB inspection.
- Doctor and gateway-restart behavior remain broad and still inspect registered DBs.

Changed files:

- `src/state/openclaw-database-preflight.ts`
- `src/state/openclaw-database-preflight.test.ts`

## Test Plan / Results

Passed:

- `node scripts/run-vitest.mjs run src/state/openclaw-database-preflight.test.ts -t "Gateway startup"`
- `pnpm tsgo:core`
- `git diff --check`

Regression coverage:

- Gateway startup does not block on registered employee DB outside the router store.
- Gateway startup still blocks when the router-owned database needs migration.

## Code State

Patched locally. Commit/push step pending at artifact creation time.

No production deploy, no rebuild, no live Teams smoke, and no pilot-user changes were performed by this patch step.

## Next Action

Commit and push the patch to PR #2 branch with the BWS-backed Git wrapper, then hand back to Tina-controlled rebuild/deploy/E2E smoke flow.
