# PR #2 Router Rollout Full Log Closeout

Run: 20260914T224000Z-router-pr2-full-log-closeout

This packet captures the full non-Telegram rollout evidence for the PR #2 router deployment.

## Included logs

- metadata.env
- router-service-inspect.txt
- router-service-ps.txt
- service-replicas.txt
- router-container-inspect.json
- router-health.json
- router-http-health.txt
- router-image-inspect.json
- router-container-logs-since-deploy.sanitized.log
- smokes/*.jsonl
- smoke-summary.txt

## Current result

- Router service converged on PR #2 image.
- Router Docker health is healthy.
- Router HTTP health is live.
- Employee services are 1/1.
- Employee smoke outputs are captured per user under smokes/.
