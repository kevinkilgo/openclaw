# Teams Employee Onboarding Remediation Plan

Date: 2026-09-12
Owner model: Artemis primary, Fiona shadowing, Tina oversight.
Repository target: Kevin-owned GitHub space only (`kevinkilgo/*`).

## Objective

Eliminate repeated employee onboarding limbo by preventing known backend failures before they reach the pilot user, and by sending clear app-origin status messages whenever a backend gate genuinely requires waiting or admin action.

## Workstream 1: SQLite Prevention

Priority: P0

Problem:

The onboarding path has repeatedly exposed SQLite malformed/freelist/lock failures. Restoring from backup worked, but that is remediation, not prevention.

Build:

- Add `assertCanonicalRouterState()` before onboarding DB writes.
- Add `assertHealthySqlite(dbPath)` using `PRAGMA quick_check`.
- Add a post-mutation integrity sample for onboarding request-store changes.
- Add lock-aware backoff so a bad/locked DB disables the fast provisioner loop and writes a clear backend-blocked marker.
- Detect and reject nested `.openclaw/.openclaw/state/openclaw.sqlite` roots.

Tests:

- Unit test malformed DB handling.
- Unit test wrong state-root detection.
- Integration test onboarding request survives router restart/WAL checkpoint.
- Regression test no user prompt loop when DB is unhealthy.

Definition of done:

- A malformed router DB cannot be mutated by onboarding.
- The affected user receives one safe app-origin delay message if conversation reference exists.
- Operator gets one actionable alert.

## Workstream 2: Auth State Machine

Priority: P0

Problem:

OpenAI/Codex auth completion can land while the employee service still runs stale auth state. The old behavior created repeated device-code prompts.

Build:

- Introduce explicit OpenAI auth states:
  - `prompt-sent`
  - `completed-pending-reload`
  - `reload-attempted`
  - `smoke-complete`
  - `operator-followup-required`
- Restart the affected employee service exactly once after successful device login.
- Run smoke only after service health returns.
- Stop prompting if auth is already usable or reload has been attempted.
- Add operational intercept for "new OpenAI auth code" that checks state before issuing a code.

Tests:

- Completed auth plus stale runtime triggers one restart and no new code.
- Persistent 401 after restart becomes operator follow-up.
- User-requested new code does not create duplicate code when auth is already ready.

Definition of done:

- Richard/Haseeb prompt loop cannot recur.
- User sees validation progress or admin-required status instead of duplicate codes.

## Workstream 3: Teams Dispatch Reliability

Priority: P0

Problem:

Retryable Teams employee-container session-claim races were treated as terminal failures, causing silence.

Build:

- Keep the bounded retry/backoff already added in Kevin-owned PR.
- Add final exhausted-retry status handling.
- Add metrics/log fields for retry count, employee slug, and final outcome with no raw message content.

Tests:

- First retryable claim error succeeds on retry.
- Non-retryable errors are not swallowed.
- Exhausted retry creates a clear status path.

Definition of done:

- Teams route never silently drops a retryable employee dispatch without at least one bounded retry and clear final logging.

## Workstream 4: Gate Messaging

Priority: P0

Problem:

Pilot users were left without status while backend gates were blocked.

Build:

- Add one message template per gate:
  - setup started;
  - backend maintenance/delay;
  - OpenAI registration required;
  - OpenAI registration received, validating;
  - BWS/admin setup pending;
  - MS365 registration required;
  - MS365 expired;
  - core ready, connector pending;
  - complete.
- Add message de-duplication markers per employee/gate.
- Add user status command handling for "where is the current process?".

Tests:

- Every blocked state has a corresponding user-safe message.
- Repeated provisioner loops do not spam messages.
- Senior-pilot path receives a status refresh during long waits.

Definition of done:

- No user sits in a backend wait longer than 10-15 minutes without an app-origin update.

## Workstream 5: Connector Gate Isolation

Priority: P1

Problem:

One employee's BWS/MS365 connector blocker could stop broader provisioner progress.

Build:

- Process employee connector gates independently.
- Convert connector failures into per-employee markers:
  - `bws-project-missing`
  - `bws-token-required`
  - `ms365-device-code-required`
  - `ms365-expired`
  - `ms365-admin-assignment-required`
- Preflight allowlisted users before pilot invite:
  - BWS project exists if precreated;
  - required runtime token secret exists;
  - conversation reference is available or first-message path is ready.

Tests:

- Richard BWS-missing style case does not block Dave/Haseeb.
- MS365 expired state does not affect core readiness.
- Salesforce/Krisp pending state does not block base chat.

Definition of done:

- A connector gate can delay that connector but not core agent readiness or unrelated employee onboarding.

## Workstream 6: Automation Reliability

Priority: P2

Problem:

Scheduled checks and active watches disabled themselves after repeated runtime/auth failures.

Build:

- Migrate Codex restricted-run config to the supported requirements file.
- Fix Dave watcher trigger variable initialization.
- Add one-shot validation when creating a watch.
- Record automation disablement into the same operator alert stream.

Tests:

- Watcher runs repeatedly without `state is not defined`.
- Restricted scheduled run starts under current host policy.
- Auto-disabled watcher produces actionable operator alert.

Definition of done:

- Pilot watches are trustworthy enough to rely on during live onboarding.

## Sequencing

1. Land documentation and existing Teams dispatch retry fix in Kevin-owned PR.
2. Implement SQLite preflight/single-writer guard.
3. Implement OpenAI auth state machine and duplicate-prompt prevention.
4. Implement gate messaging and status command.
5. Isolate connector gates.
6. Repair scheduled automation runtime and watcher scripts.
7. Run a full synthetic onboarding drill before inviting another senior pilot.

## Synthetic Drill

Run after P0 fixes:

1. Create synthetic allowlisted employee.
2. Simulate first Teams DM.
3. Force router DB lock and verify backoff/status.
4. Complete OpenAI auth and verify one restart/smoke path.
5. Simulate BWS token missing and verify connector-only pending state.
6. Simulate MS365 expiration and verify core-ready connector-pending message.
7. Confirm no duplicate auth codes and no silent waits.

## Reporting Cadence

- Artemis owns implementation status.
- Fiona shadows and independently verifies live health, logs, and user-facing messaging.
- Tina reports to Kevin with:
  - merged/pushed code;
  - live runtime status;
  - current blockers;
  - whether Kevin is needed for admin/credential work.
