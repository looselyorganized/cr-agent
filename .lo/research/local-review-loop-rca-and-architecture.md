# From GitHub Webhook to Local Review Loop

We built cr-agent to answer a simple question: what happens when you put two AI agents in an adversarial loop — one that critiques code, one that fixes it?

The answer, it turns out, is that they produce better code than either agent alone. CodeRabbit catches real issues. Cross-file inconsistencies, contract violations, edge cases a single-pass reviewer would miss. Claude fixes them competently. The loop converges. In v0.1.0, we validated the core idea: wire a GitHub org webhook to a Railway service, let CodeRabbit and Claude iterate on pull requests, and auto-merge when they agree.

That was the right first version. But we've been running it long enough now to see where the architecture breaks down — not in the intelligence of the agents, but in the infrastructure they communicate through.

## What went wrong

The first sign of trouble was subtle. After several rounds of review and fixes on a pull request, CodeRabbit would silently stop reviewing. The CR agent would push its latest fix, and CodeRabbit would declare "Review completed" without examining the new commit. Auto-merge would fire. Unreviewed code would land in main.

We traced this on PR #6 of lo-plugin. Five review rounds, five fix commits, a clear pattern:

| Time  | Event |
|-------|-------|
| 00:10 | CodeRabbit review #1 — 4 comments |
| 00:11 | CR agent pushes fix |
| 00:15 | CodeRabbit review #2 — 2 comments |
| 00:16 | CR agent pushes fix |
| 00:20 | CodeRabbit review #3 — 2 comments |
| 00:21 | CR agent pushes fix |
| 00:23 | CodeRabbit review #4 — 1 comment |
| 00:24 | CR agent pushes fix |
| 00:28 | CodeRabbit review #5 — 1 comment |
| 00:29 | CR agent pushes fix — **never reviewed** |

The root cause turned out to be in GitHub itself. The PR review comment API attributes comments not to the commit being reviewed, but to the commit that *last touched that line*. When the CR agent pushes a fix that modifies line 42 of a file, GitHub silently re-parents every existing comment on that line to the new commit — including comments that were created minutes or hours earlier, about entirely different code.

CodeRabbit's incremental review logic depends on this mapping. It looks at the latest commit, sees its own previous comments already tagged "Addressed," and concludes there's nothing new to review. The bookkeeping that's supposed to track what's been reviewed and what hasn't is being rewritten underneath it with every fix commit.

This isn't a bug in CodeRabbit or in cr-agent. It's a fundamental property of how GitHub tracks review comments across a moving codebase. The API was designed for human reviewers making occasional comments on stable commits — not for two agents rapidly iterating on the same lines.

## The secondary costs

The review coverage gap was the critical issue, but the GitHub-mediated loop has other costs that compound over time.

**Commit noise.** Each fix round adds a commit to the PR. That same PR #6 went from 6 meaningful commits to 11 — nearly half the history was "fix: address CodeRabbit review comments (round N)." The git log stops telling the story of what was built and starts documenting a negotiation between two robots.

**Latency.** The loop is event-driven through multiple systems. Push a commit, wait for GitHub to trigger CI, wait for CodeRabbit to review, wait for the webhook to fire back to Railway. Each cycle takes 3–5 minutes of wall time for work that takes Claude seconds to execute. A three-round loop burns 10–15 minutes of calendar time.

**Coupling.** The entire loop depends on GitHub's webhook delivery, CodeRabbit's GitHub integration, and the PR review API behaving exactly as expected. Any outage, rate limit, or behavior change in any of these systems breaks the loop. We can't test it locally. We can't swap the reviewer without rewiring the trigger mechanism.

## The realization

The adversarial loop between CodeRabbit and Claude is genuinely valuable. The architecture that mediates it — GitHub's PR review system — is not. We were running a tight feedback loop through infrastructure designed for asynchronous human review, and the impedance mismatch was showing up as lost coverage, wasted time, and fragile coupling.

The loop needs to move. Not the agents, not the logic, not the adversarial principle. Just where the iteration happens.

## Moving the loop local

The new architecture is straightforward. Instead of iterating on a live PR — pushing commits, waiting for reviews, reacting to webhooks — cr-agent clones the branch, runs the review-fix loop entirely on its own machine, and pushes once when it's done.

```
cr-agent (Railway)                              GitHub
──────────────────                              ──────
1. Trigger: PR opened or manually invoked
2. Clone the branch
3. Run CodeRabbit CLI locally
4. Parse findings
5. Claude fixes issues (local commit, no push)
6. Run CodeRabbit CLI again to verify
7. If clean → push
8. If issues remain → repeat from 5 (max 3 rounds)
9. Push single clean commit  ──────────────>  PR updated, clean
                                              Auto-merge
```

One push. One commit. No intermediate commits on the PR means no comment re-parenting. CodeRabbit on GitHub becomes a final sanity check rather than the primary review mechanism — and if it finds nothing, auto-merge fires immediately.

| | v0.1.0 | v0.2.0 |
|--|--------|--------|
| Review mechanism | CodeRabbit GitHub integration | CodeRabbit CLI (`cr --prompt-only`) |
| Fix loop | Push → wait for review → fix → push → wait | Local: CLI → fix → CLI → fix → push once |
| Commits per loop | 1 per round (3–5 total) | 1 total |
| Latency per round | 3–5 min | ~30–60 sec |
| Review coverage | Last round often unreviewed | Every round verified locally |
| GitHub dependency | Full | Minimal |

Everything else carries forward. The adversarial principle. The Supabase tracking. The Railway deployment. The Claude Agent SDK fix logic. We're changing the transport, not the intelligence.

## The tooling landscape

CodeRabbit recently shipped a CLI that can review diffs locally without a GitHub PR. `cr --prompt-only` outputs machine-readable findings explicitly designed for piping into AI agents — file paths, line numbers, severity, suggested fixes. This is the natural starting point since we already use CodeRabbit and the output format is purpose-built for our use case.

But one of the more interesting properties of the new architecture is that the reviewer becomes pluggable. The interface between cr-agent and the review tool is minimal: give it a diff, get back a list of findings or a clean signal. That's a shell command, not a platform integration.

Claude Code's headless mode can review diffs for $0.02–0.15 per invocation. OpenAI's Codex CLI has a built-in `/review` command. Open-source tools like ZapCircle exist. The choice of reviewer is now a configuration decision rather than an architectural commitment. Start with CodeRabbit CLI because the integration is natural and the findings quality is proven. But the door is open to swap, stack, or run multiple reviewers in parallel.

This pluggability extends beyond cr-agent. Any workflow that ships code — including our own `/lo:ship` pipeline — could use the same pattern: run a local CLI review before pushing, catch issues before they reach the PR, keep the commit history clean.

```
/lo:ship Gate 4: Review
  ├── reviewer subagent (built-in)
  └── external CLI review (pluggable)
        ↳ cr --plain
        ↳ claude -p "review this"
        ↳ codex /review
```

## What we still need to learn

The architecture is clear. A few questions remain about the implementation:

CodeRabbit's documentation suggests CLI reviews can take 7–30 minutes depending on diff size. If that holds, the local loop may not be dramatically faster than the GitHub loop for large changes. We need to benchmark with real diffs before committing to latency claims.

The free tier allows 3 reviews per hour. A 3-round loop on one PR exhausts that. Paid tier at ~$15/month gives 8 per hour, which is comfortable for our current volume but worth tracking.

We're inclined to keep CodeRabbit on GitHub as a passive final check — belt and suspenders. But if the local loop is thorough enough, the GitHub review becomes pure overhead. That's an empirical question we'll answer by running both for a while and comparing what the GitHub pass catches that the local pass missed.

The round cap matters. Three rounds is probably right. If two AI agents can't converge in three iterations, the issue likely requires human judgment — and continuing to iterate is more likely to introduce new problems than to resolve the original one.
