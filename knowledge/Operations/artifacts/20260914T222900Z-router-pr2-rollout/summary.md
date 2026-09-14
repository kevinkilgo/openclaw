# PR #2 Router Rollout Evidence

Run: 20260914T222900Z-router-pr2-rollout

## Deployment

- Service updated: openclaw-gateway-lanes-prod-swarm_gateway-router
- Image: local/openclaw-gateway:2026.8.1-msteams-router-pr2-startup-migration-205be517344-20260914T221000Z
- Image revision label: 205be517344e0d87c3bc81d120d37043afa1e6a0
- Build source: PR #2 feature/msteams-sender-aware-routing
- Deployment result: converged

## Health

- Router service: 1/1
- Router Docker health: healthy
- Router /health: {"ok":true,"status":"live"}
- Employee services: kkilgo, jowen, rstephens, hdadabhoy, babbey, dmathis all 1/1

## Smokes

Active employee agent CLI smokes returned EMPLOYEE_READY_OK for:

- kkilgo
- jowen
- rstephens
- hdadabhoy
- babbey
- dmathis

## Notes

- The build was performed off-host on the recovery node to avoid production load on employee services.
- The earlier PR #2 startup blocker was fixed by commit 205be517344, allowing router-owned v17 agent DBs to enter the controlled startup migration path while preserving the pre-media schema block.
- Raw router CLI smoke without auth is not used as readiness evidence; service health, router health, and employee agent smokes were used.
