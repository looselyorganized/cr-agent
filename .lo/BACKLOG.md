---
updated: 2026-03-10
---

## v0.1.0 — GitHub Webhook + CodeRabbit Loop (done)

Railway service receives GitHub org webhook on PR review, runs Claude Agent SDK to fix CodeRabbit comments, pushes fixes, loops until clean or stuck. Supabase tracks state across rounds. Shipped 2026-03-07, first successful e2e on PR #4.

## v0.2.0 — Self-Contained Adversarial Loop via CR CLI (backlog)

### f005 — CodeRabbit CLI Integration
Replace the GitHub webhook trigger with direct CodeRabbit CLI invocation. cr-agent clones the branch, runs `cr --prompt-only --api-key` locally to get review findings, feeds the output to Claude for fixes, then runs `cr` again to verify. The full review-fix-verify loop happens inside cr-agent without waiting for GitHub events. CodeRabbit and Claude operate as genuinely adversarial agents — one critiques, one fixes, they iterate until agreement.
Status: backlog

### f006 — On-Demand CR Review with Agent-Triggered Tagging
Switch CodeRabbit from auto-review-on-push to on-demand review (`@coderabbitai review`). cr-agent becomes the orchestrator of the full review loop: push fixes → tag CR → wait for re-review → repeat until clean.

**Problem:** CR auto-reviews on every push, but snapshots the PR at trigger time. When commits land in rapid succession (e.g., cr-agent pushing fixes 2-5 minutes after a review starts), CR's pipeline has already snapshotted and misses the follow-up commits. The PR stays in CHANGES_REQUESTED with no new review. This was observed on lo-plugin PR #10 — CR reviewed `b30dcd3` at 21:00, `8a319ba` landed at 21:02, CR went silent.

**Root cause:** Race condition between CR's review pipeline duration (~3-5 min) and push frequency. Not a webhook delivery issue — push events exist on GitHub. CR simply doesn't re-trigger when a new push arrives mid-review.

**Solution:**
1. Disable CR auto-review org-wide (`.coderabbit.yaml`: `reviews.auto_review: false`)
2. `/lo:ship` tags `@coderabbitai review` when opening a PR
3. cr-agent pushes ALL fixes in a single commit, then posts `@coderabbitai review` as a PR comment
4. cr-agent waits for CR's new review before starting the next round
5. Loop continues until CR approves or max rounds exceeded

**Implementation notes:**
- cr-agent needs a `tagCR()` function in `src/github.ts` that posts PR comments
- After pushing fixes in `fix-session.ts`, call `tagCR()` before setting status to `waiting_review`
- Need to ensure cr-agent waits for the NEW review (not the stale one) — compare review timestamps or IDs
- Consider adding a `review_requested_at` field to `cr_fix_rounds` to track when CR was tagged

Status: backlog

### f004 — Evals
Analytics pipeline tracking CR+Claude resolution efficacy: what percentage of review comments are autonomously resolved, which categories consistently need humans, and aggregate metrics over time.
Status: backlog
