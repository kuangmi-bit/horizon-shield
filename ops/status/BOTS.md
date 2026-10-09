# Scheduled workflows

Written by `tools/status/bot_watch.mjs` at 2026-10-09T12:07:55.029Z. 23 scheduled workflows, none needs attention.

| Workflow | Schedule (UTC) | Expected every | Last run | Last scheduled success | Failures in a row | Status | Last bot commit to its paths |
|---|---|---|---|---|---|---|---|
| `adoption-weekly.yml` | `17 0 * * 1` | 7 d | 2026-10-08T11:14:04.000Z workflow_dispatch success | 2026-10-05T05:40:53.000Z | 0 | ok | 2026-10-08T11:14:45.000Z by horizon-shield-adoption-count |
| `blog-post.yml` | `0 0 * * *` | 1 d | 2026-10-09T05:30:45.000Z schedule success | 2026-10-09T05:30:45.000Z | 0 | ok | 2026-08-18T01:28:27.000Z by KIRA Bot (quiet) |
| `bot-watch.yml` | `47 5 * * *` | 1 d | 2026-10-09T12:07:06.000Z schedule in_progress | none in the last 20 | 0 | ok | 2026-10-08T17:06:48.000Z by horizon-shield-bot-watch |
| `conduct-witness-dogfood.yml` | `23 4 * * 1` | 7 d | 2026-10-05T11:38:06.000Z schedule success | 2026-10-05T11:38:06.000Z | 0 | ok | not inferred |
| `ehn-card-pages.yml` | `40 15 * * *` | 1 d | 2026-10-08T17:35:21.000Z workflow_dispatch success | none in the last 20 | 0 | ok | none in the last 30 commits by hs-ehn-card-pages (quiet) |
| `evidence-mirror.yml` | `41 18 * * *` | 1 d | 2026-10-08T23:32:14.000Z schedule success | 2026-10-08T23:32:14.000Z | 0 | ok | 2026-10-08T23:33:23.000Z by hs-evidence-mirror |
| `gate-register-partners.yml` | `45 3 * * 1` | 7 d | 2026-10-05T10:51:24.000Z schedule success | 2026-10-05T10:51:24.000Z | 0 | ok | not inferred |
| `interop-matrix-watch.yml` | `23 21 * * *` | 1 d | 2026-10-09T01:17:02.000Z schedule success | 2026-10-09T01:17:02.000Z | 0 | ok | not inferred |
| `jidec-stamp.yml` | `17 * * * *` | 1 h | 2026-10-09T09:12:43.000Z schedule success | 2026-10-09T09:12:43.000Z | 0 | ok | not inferred |
| `law-watch-mirror.yml` | `23 21 * * 0` | 7 d | 2026-10-04T23:58:27.000Z schedule success | 2026-10-04T23:58:27.000Z | 0 | ok | 2026-09-27T05:29:47.000Z by hs-law-watch-mirror |
| `line-broadcast.yml` | `0 23 * * *` | 1 d | 2026-10-09T02:47:49.000Z schedule success | 2026-10-09T02:47:49.000Z | 0 | ok | not inferred |
| `mcp-conduct.yml` | `30 3 * * 1` | 7 d | 2026-10-05T10:42:31.000Z schedule success | 2026-10-05T10:42:31.000Z | 0 | ok | not inferred |
| `note-eigo.yml` | `0 21 * * 6` | 7 d | 2026-10-03T23:26:56.000Z schedule success | 2026-10-03T23:26:56.000Z | 0 | ok | not inferred |
| `note-post.yml` | `0 0 * * *` | 1 d | 2026-10-09T04:02:54.000Z schedule success | 2026-10-09T04:02:54.000Z | 0 | ok | not inferred |
| `pending-mirror.yml` | `23 * * * *` | 1 h | 2026-10-09T09:18:31.000Z schedule success | 2026-10-09T09:18:31.000Z | 0 | ok | 2026-10-08T21:24:13.000Z by hs-pending-mirror (quiet) |
| `plugin-mirror-drift.yml` | `41 3 * * *` | 1 d | 2026-10-09T10:52:31.000Z schedule success | 2026-10-09T10:52:31.000Z | 0 | ok | not inferred |
| `registry-drift.yml` | `17 3 * * *` | 1 d | 2026-10-09T10:34:47.000Z schedule success | 2026-10-09T10:34:47.000Z | 0 | ok | not inferred |
| `status-probe.yml` | `23 * * * *` | 1 h | 2026-10-09T09:14:58.000Z schedule success | 2026-10-09T09:14:58.000Z | 0 | ok | 2026-10-09T09:16:48.000Z by horizon-shield-status |
| `survey-observatory.yml` | `23 3 1 * *` | 31 d | 2026-10-01T10:16:23.000Z schedule success | 2026-10-01T10:16:23.000Z | 0 | ok | 2026-10-01T10:21:59.000Z by horizon-shield-observatory |
| `survey-walk.yml` | `41 2 1 2,5,8,11 *` | 92 d | none | none in the last 20 | 0 | ok | 2026-10-01T10:21:59.000Z by horizon-shield-observatory |
| `survive-drill.yml` | `17 3 * * *` | 1 d | 2026-10-09T10:37:57.000Z schedule success | 2026-10-09T10:37:57.000Z | 0 | ok | 2026-10-09T10:51:48.000Z by hs-survive-drill |
| `tsunagi-board.yml` | `41 18 * * *` | 1 d | 2026-10-09T06:23:53.000Z workflow_dispatch success | 2026-10-08T23:32:58.000Z | 0 | ok | 2026-10-09T06:25:13.000Z by horizon-shield-tsunagi |
| `yakumo-guardian.yml` | `23 */6 * * *` | 6 h | 2026-10-09T06:19:40.000Z schedule success | 2026-10-09T06:19:40.000Z | 0 | ok | not inferred |

## Rules

- Expected every: the longest gap between two times the cron lines name, over the last 400 days.
- OVERDUE: the last successful scheduled run is older than 2 expected intervals plus 3 h (for a workflow with no successful scheduled run in the last 20, counted from when GitHub first saw the file).
- FAILING: the last 2 scheduled runs that finished both failed (failure, timed out, startup failure or waiting for approval). Cancelled and skipped runs are not counted either way.
- UNKNOWN: the GitHub API could not be read for this workflow. DISABLED: the workflow is turned off in GitHub; listed here, not counted as a problem.
- The job that writes this page fails (and GitHub notifies the owner) when any workflow is OVERDUE, FAILING or UNKNOWN.

## What it does not establish

- A successful run means the job exited 0, not that it did useful work. A bot that has nothing to commit still succeeds.
- The last column is a hint, not a rule: the bot name and paths are read from the workflow text (`git config user.name` and `git add` paths, with a variable substituted only when the file sets it once to a plain path), and only the last 30 commits per path are read. "quiet" means no commit by that bot within the overdue window; many bots commit only when something changed, so quiet is not a failure and does not turn this job red.
- Only the 20 most recent runs of each workflow are read. Workflows without a schedule are not listed.
