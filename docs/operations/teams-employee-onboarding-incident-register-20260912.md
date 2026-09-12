# Teams Employee Onboarding Incident Register

Date: 2026-09-12
Scope: Artemis Teams employee pilot onboarding for John Owen, Richard Stephens, Dave Mathis, and Haseeb Dadabhoy.
Repository target: Kevin-owned GitHub space only (`kevinkilgo/*`).

## Executive Status

Live Artemis is healthy as of the morning check:

- Gateway router service: `1/1`
- Employee services: `kkilgo`, `jowen`, `rstephens`, `dmathis`, and `hdadabhoy` all `1/1`
- Router, Richard, Dave, and Haseeb SQLite stores: `quick_check=ok`, `integrity_check=ok`
- Durable source changes already in Kevin-owned PR: Teams dispatch retry handling and welcome-card copy.

The remaining work is prevention. The incidents below repeatedly left pilot users in limbo because backend setup failed without a clear app-origin status message. The next iteration must make onboarding single-writer, lock-aware, explicit about gates, and self-healing where safe.

## Incident 1: SQLite Corruption During Onboarding

Severity: P0

Symptoms:

- Router SQLite reported malformed/corrupt state during onboarding and app-origin sends.
- Dave and Haseeb onboarding stalled before normal auth gates could complete.
- Users saw "setup started" or silence while backend retries failed.

Observed recovery:

- Paused fast provisioner loop before repair.
- Stopped or isolated active writers.
- Restored router DB from clean backup when light repair failed.
- Re-merged pending onboarding request state.
- Verified `quick_check=ok` and `integrity_check=ok` before resuming.

Likely root cause:

- Onboarding/provisioner/router paths can write the same SQLite state from multiple contexts or wrong state roots.
- A nested root-owned router state DB was observed under `.openclaw/.openclaw/state/openclaw.sqlite`, indicating at least one operational path can run with the wrong `HOME`/state directory.
- Fast retry cadence can repeatedly hammer malformed or locked DB state.

Durable fix plan:

- Add a preflight guard before every onboarding run:
  - verify router DB path is the canonical path;
  - fail closed if a nested `.openclaw/.openclaw/state/openclaw.sqlite` exists;
  - run `PRAGMA quick_check` before writes;
  - run bounded `PRAGMA integrity_check` after request-store mutation batches.
- Make router request-store writes single-writer:
  - use one canonical writer process or a lock file around state mutations;
  - enforce busy timeout/WAL checkpoint discipline;
  - never run operational repair/write commands with inherited wrong `HOME`.
- Change provisioner retry behavior:
  - do not retry every 5 seconds when DB health is bad;
  - write a backend-blocked marker;
  - send the affected user an app-origin "backend maintenance" status message when a conversation reference exists;
  - notify operators once, not every loop.

Acceptance tests:

- Simulated malformed DB stops onboarding before mutation and sends/logs one clear backend-blocked status.
- Simulated locked DB backs off instead of service thrashing.
- Provisioner cannot create or use nested `.openclaw/.openclaw` state.
- New onboarding request remains recoverable after router restart and WAL checkpoint.

## Incident 2: OpenAI/Codex Multi-Prompt Loop

Severity: P0

Symptoms:

- Richard and Haseeb completed OpenAI/Codex device login, but the app sent additional OpenAI device codes.
- Direct model auth checks eventually showed OpenAI usable, but the running employee gateway had stale auth state until restart.

Observed recovery:

- Restarted affected employee service once after auth landed.
- Ran direct read-only smoke.
- Wrote smoke/reload markers.
- Stopped issuing repeated codes once auth was usable.

Root cause:

- Completed auth was not being treated as a "reload pending" state.
- Provisioner smoke failure could be interpreted as needing another auth code instead of a stale runtime that needed one bounded restart.

Durable fix plan:

- Model OpenAI auth as explicit states:
  - `prompt-sent`
  - `user-completed-pending-reload`
  - `reload-attempted`
  - `smoke-complete`
  - `operator-followup-required`
- After a device-code flow exits successfully, restart only that employee service once and defer smoke until service is healthy.
- If smoke still returns 401 after one restart, mark operator follow-up and stop prompting the user.
- Add a command/intercept for "new OpenAI auth code" that checks existing auth state first.

Acceptance tests:

- Completed auth plus stale gateway triggers exactly one restart and no new prompt.
- Persistent 401 after restart sends an operator-followup status, not a fresh device code.
- "New OpenAI auth code" does not create a code when auth is already usable.

## Incident 3: Teams Dispatch Session-Claim Race

Severity: P0/P1

Symptoms:

- Kevin's Teams route stopped responding.
- Router logs showed: `Session "agent:main:main" changed while starting work. Retry.`
- Handler treated retryable session-claim conflicts as hard failure, creating silence for the user.

Observed recovery:

- Added bounded retry/backoff for the exact retryable condition.
- Added focused tests.
- Pushed the source change to Kevin-owned PR and hotpatched the live router bundle.

Durable fix plan:

- Keep retry bounded and scoped only to explicit retryable session-claim text.
- Surface final failure as an app-origin "backend retry failed" message where possible.
- Add router metrics/log labels for retry count and final outcome.

Acceptance tests:

- First retryable session-claim failure succeeds on retry.
- Non-retryable auth/config errors are not swallowed.
- Exhausted retry produces one clear operator/user-visible failure path.

## Incident 4: User Communication Gaps

Severity: P0 for senior pilot experience

Symptoms:

- Pilot users saw "setup started" and then silence during backend blockers.
- Senior users asked repeatedly whether onboarding had started or stalled.

Observed recovery:

- Haseeb received app-origin status messages:
  - setup active;
  - core agent ready;
  - MS365 code expired and can be renewed when available.

Durable fix plan:

- Every onboarding gate must have a status message template:
  - setup started;
  - backend provisioning delayed;
  - OpenAI registration required;
  - OpenAI registration received, validating;
  - BWS admin setup required;
  - MS365 registration required;
  - connector pending but core agent ready;
  - setup complete.
- Each template must be sent at most once per gate unless the user asks for status.
- Long waits should refresh the user every 10-15 minutes with a short app-origin update.

Acceptance tests:

- Simulated backend block sends a user-safe status message instead of silence.
- Repeated provisioner loops do not spam the same message.
- "Where is the current process?" returns the current gate and next action.

## Incident 5: BWS/Bitwarden Gate Blocking Other Users

Severity: P1

Symptoms:

- Richard's missing pre-created BWS project blocked the provisioner after core auth.
- One employee connector failure risked stopping the whole onboarding runner.

Observed recovery:

- Created `openclaw-richard-stephens`.
- Kevin added the machine account/secret.
- Provisioner advanced to `msteams-bitwarden-setup-complete`.
- Similar prep completed for Dave and Haseeb.

Durable fix plan:

- Isolate post-provision connector gates per employee.
- A missing or invisible BWS project should mark only that employee as waiting for admin action.
- Pre-created project expectations must be validated before inviting the pilot user.
- Add a nightly preflight for allowlisted employees and required BWS project/secret presence.

Acceptance tests:

- One employee missing BWS token does not block another employee onboarding.
- Missing pre-created project produces a clear admin action marker and user-safe message.
- Existing project with token secret proceeds without manual intervention.

## Incident 6: MS365 Registration and Permission Gates

Severity: P1

Symptoms:

- John completed MS auth but tools were unavailable because `ms365` MCP was not wired into his employee-local config.
- Haseeb's MS365 code expired while core agent remained ready.
- Some employees may hit Entra assignment/Enterprise App permission issues.

Observed recovery:

- Patched John's config with employee-local MS365 token paths.
- Sent fresh app-origin MS365 device prompt.
- Verified John mail/calendar access.
- For Haseeb, communicated that core chat is ready and MS365 remains pending.

Durable fix plan:

- Provisioner must inject `ms365` MCP config into every employee agent that has MS365 enabled.
- Token cache paths must be employee-local, never operator/global.
- Device-code expiration and Entra assignment failure must be classified separately.
- A user's request for a new Microsoft code should reset only that user's stale MS365 prompt state when auth is not already ready.

Acceptance tests:

- Successful device login creates employee-local token cache and exposes mail/calendar tools.
- Expired code produces a renewable pending state, not a loop.
- Entra assignment block produces an admin-required status.

## Incident 7: Automation/Heartbeat Failures

Severity: P2

Symptoms:

- Scheduled progress checks auto-disabled after repeated auth/config failures.
- Dave watcher failed due trigger bug (`state is not defined`).
- Restricted Codex runs failed because host config still used legacy managed config TOML.

Durable fix plan:

- Migrate host Codex config from legacy managed config TOML to requirements TOML for restricted/isolated turns.
- Add a preflight to automation creation: run once immediately and fail visibly if script variables are undefined.
- Treat disabled pilot watches as operational alerts, not silent background failures.

Acceptance tests:

- Dave-style watcher can run 10 consecutive checks without disabling.
- Restricted scheduled turn starts successfully with current host config.
- Automation failures create one actionable operator notification.

## Immediate Engineering Backlog

1. P0: Router/onboarding SQLite single-writer and DB health gate.
2. P0: OpenAI auth state machine with one bounded employee-service reload.
3. P0: User-safe gate status messaging for every long wait or backend block.
4. P1: Per-employee connector isolation for BWS/MS365/Salesforce/Krisp.
5. P1: Provisioner preflight for allowlist, BWS project/secret, MS365 config, and conversation reference.
6. P1: Route all changes through Kevin-owned repos/PRs only.
7. P2: Repair scheduled automation runtime config and watcher scripts.

## Go/No-Go Guidance

Go for next tester only when:

- Router and target employee DBs pass `quick_check` and `integrity_check`.
- Router and target employee service are `1/1`.
- Provisioner has no failed run in the last 15 minutes.
- User has received an app-origin status message within the last gate.
- OpenAI auth has either `smoke-complete` or a clearly communicated pending gate.

Do not invite another senior tester while:

- SQLite health is unknown or degraded.
- Provisioner is retrying every few seconds on the same backend failure.
- A live hotpatch exists without a matching Kevin-owned PR update.
- The user-facing gate message would be silence.
