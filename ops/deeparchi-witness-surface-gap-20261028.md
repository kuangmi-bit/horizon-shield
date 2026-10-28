> Note on this fork: the file records the state of the **DeepArchi witness service** (`deeparchi-witness`, CloudBase env `qunling-001-d7gwxqdou24c9dad4`), which is not part of the upstream HORIZON SHIELD project. Kept here because this repository is where the witness work is mirrored and issue tracking is disabled.

Recorded from the TSUGI live draw on 2026-10-27, where this defect was visible in the published reply and had to be excluded from the expected values before the draw ran.

**What happened.** The draw sent one `nenrin-witness-request-v1` to `https://qunling-001-d7gwxqdou24c9dad4.service.tcloudbase.com/a2a` at 06:01 UTC. The reply answered in 7,796 ms and `accept_check.ok` was true, so the witness counted — `quorum_met`, 2 of 2. But one of the nine advertised surfaces came back as an error:

```
agent-card.signature:
  "Cannot find module '@a2a-js/sdk'\nRequire stack:\n- /a2a-card-sign/package.json"
```

Published reply: `workers/hs-ledger/nenrin/recovery-v0/live_draw_20261027/sent_qunling-001-d7gwxqdou24c9dad4.service.tcloudbase.com.json` at `b28a7280`. The draw's own note: `agent-card.signature` came back as an error from both witnesses, was excluded from the expected values beforehand, and counts neither way.

**Why it is ours.** The container measures that surface by running the `workers/a2a-card-sign` verifier from `/a2a-card-sign/`, and the image carries the worker without its `node_modules` (or without a `npm ci` step for it). `workers/a2a-card-sign/package.json` declares `@a2a-js/sdk 1.1.0`, so the fix is a build step, not a code change: install that worker's dependencies in the image.

**Blocker worth recording separately.** The deploy source for the `deeparchi-witness` Cloud Run service is not on this machine:

- `grep -rls "nenrin-witness-observation-v1"` across `~`, `/mnt/d/AI workspace`, `~/Desktop`, `~/Documents` → no match
- `tcb cloudrun download -e qunling-001-d7gwxqdou24c9dad4 -s deeparchi-witness` → "未找到云托管服务版本" (image-based deploy, no code version to pull)

So the service's current source of truth is the running container, not a local checkout. Until that is re-established, every change to this witness starts with recovering the image contents. Worth fixing before the next draw, not because the draw failed — it did not — but because the advertised surface count (nine) is not the answered count (eight) until the dependency is in the image.

**Not claimed.** No failure of the draw, no incorrect observation, no effect on the quorum. The remaining eight surfaces matched the expected after-state.
