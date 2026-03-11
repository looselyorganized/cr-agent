---
title: "CodeRabbit Review Race Condition on Rapid Pushes"
date: "2026-03-10"
topics:
  - coderabbit
  - review-automation
  - race-conditions
---

## Observation

On lo-plugin PR #10, CodeRabbit failed to re-review after commits pushed in rapid succession. The PR stayed in `CHANGES_REQUESTED` with no new review triggered.

## Timeline (PR #10, 2026-03-10)

| Time (UTC) | Event |
|------------|-------|
| 20:25 | CR first review — 9 actionable comments, CHANGES_REQUESTED |
| 20:57 | Push `b30dcd3` (manual fixes) |
| 21:00 | CR second review — 2 actionable comments, CHANGES_REQUESTED |
| 21:02 | Push `8a319ba` (more fixes, landed ~2 min after CR started reviewing) |
| — | **CR silent. No third review.** |
| 21:14 | cr-agent pushes `440e1c4` (round 2 fixes) |
| 21:17 | cr-agent pushes `648f484` (backward-transition fix) |
| — | **CR still silent.** |
| 21:20 | Manual `@coderabbitai review` tag needed to trigger review |
| — | **CR stalled again on the tagged review.** PR force-merged with `--admin`. |

## Root Cause

CR's auto-review pipeline snapshots the PR diff at trigger time. The review takes 3-5 minutes to complete. If a new commit lands during that window, CR does not re-trigger — it has already started processing and the new push event is effectively dropped.

This is not a webhook delivery issue. GitHub's push events were confirmed present via `gh api repos/.../events`. Both manual pushes (from `mhofwell`) and cr-agent pushes showed up. CR simply doesn't re-queue when a review is already in flight.

## Rejected Hypotheses

1. **GitHub App token suppresses webhooks** — Investigated and rejected. The pushes that CR missed were from a PAT (`mhofwell`), not a GitHub App token. The `x-access-token` scheme in cr-agent's clone URL is for reading, not for the pushes CR missed.

2. **CR rate limiting** — Possible contributing factor but not the primary cause. CR reviewed `b30dcd3` within 3 minutes of push, so it's responsive to individual events. The issue is concurrent events during an active review.

3. **CR decided nothing changed** — Rejected. `8a319ba` contained meaningful changes (status normalization, new guards) that CR would have commented on.

## Impact on cr-agent

cr-agent's current flow assumes CR will auto-review after it pushes fixes. The flow is:

1. CR reviews → CHANGES_REQUESTED
2. Webhook fires → cr-agent picks up fix request
3. cr-agent clones, fixes, pushes
4. cr-agent sets status to `waiting_review`
5. **Assumption: CR auto-reviews the push**

Step 5 fails when cr-agent's push lands during or shortly after an active CR review. The PR stays stuck in `waiting_review` indefinitely.

## Solution: On-Demand Review

Switch CR to on-demand mode and have cr-agent explicitly trigger reviews:

1. Disable `auto_review` in CodeRabbit org config
2. cr-agent posts `@coderabbitai review` after pushing all fixes
3. cr-agent waits for a review with `submitted_at` > its tag timestamp before starting the next round
4. `/lo:ship` tags CR when opening PRs

This eliminates the race entirely — reviews only start when explicitly requested, after all commits are settled.

## Key Insight

Auto-review assumes pushes are discrete, isolated events. In practice — especially with automated agents pushing fixes — pushes come in bursts. The review pipeline's snapshot-at-trigger-time model breaks down under burst traffic. On-demand review aligns the review lifecycle with the agent's commit lifecycle: push everything, then ask for review.
