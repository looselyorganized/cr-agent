---
status: in-progress
created: 2026-03-08
---

# RCA: cr-agent "Claude Code process exited with code 1"

## Problem

cr-agent's Claude Agent SDK `query()` call fails with "Error: Claude Code process exited with code 1" ~5 seconds after starting. No stderr output captured. This happens on lo-plugin PR #5 (branch `0.3.2` → `main`) but succeeded on cr-agent PR #4 (`test/e2e-cr-trigger-2` → `main`).

## What We Know (confirmed)

1. **The webhook chain works end-to-end.** GitHub org webhook → cr-agent → Supabase upsert → clone → agent start. The failure is in the agent subprocess itself.

2. **The error is opaque.** The SDK throws "Claude Code process exited with code 1" with no detail. stderr callback produces nothing — the process dies before generating output.

3. **It fails in ~5 seconds.** `agent_start` at 04:39:26, `agent_failed` at 04:39:32. This is too fast for any real work — it's a startup crash.

4. **It worked on cr-agent PR #4.** That PR was `test/e2e-cr-trigger-2` → `main` on the cr-agent repo. The agent cloned, ran, committed a fix, and pushed. So the SDK, API key, container, and permissions all work in principle.

5. **Shallow clone merge-base issue is real but may not be the only problem.** We confirmed `git diff main...HEAD` fails with `fatal: no merge base` on a `--depth 1` clone of lo-plugin. We deployed a treeless clone fix (`--filter=blob:none --no-single-branch`) but the next run (round 3) still failed. However, that run may have hit the old container before the new deploy was live.

6. **Round counter bug existed.** The webhook didn't reset `current_round` when patching from terminal states, so re-triggers after `stuck` immediately exceeded `max_rounds`. Fixed in `ee8ddd3`.

## What We Don't Know

1. **Did the treeless clone fix actually get tested?** Round 3 at 04:39 ran on a container that started before the treeless clone deploy. We haven't confirmed whether the new code fixes the issue.

2. **Is there a Node.js dependency?** The SDK's `cli.js` has `#!/usr/bin/env node` shebang. The Dockerfile uses `oven/bun:1` which may or may not include Node.js. The hosting docs say "Node.js (required by Claude Code CLI)". But if node wasn't available, it should have failed on PR #4 too. Need to verify what's in the `oven/bun:1` image.

3. **Is it a repo-specific issue?** cr-agent repo is small (~20 files). lo-plugin is larger (~100+ files, many skill markdown files). Could be a context/token issue, or could be something in lo-plugin's structure that triggers a Claude Code startup error.

4. **What does stderr actually say?** The new stderr capture code hasn't been tested yet. It should surface the real error on the next failure.

## Investigation Plan

### Step 1: Verify the current deployed code
```bash
cd /Users/bigviking/Documents/github/projects/lo/cr-agent
railway service status --service cr-agent
railway logs --service cr-agent --build --lines 30
```
Confirm deployment `ee8ddd3` is live with both fixes (treeless clone + round counter reset).

### Step 2: Check if Node.js exists in the container
```bash
# Option A: Check the oven/bun:1 image locally
docker run --rm oven/bun:1 which node
docker run --rm oven/bun:1 node --version

# Option B: Check SDK source to see how it spawns the CLI
cd /Users/bigviking/Documents/github/projects/lo/cr-agent
grep -n 'spawn\|exec\|fork\|child_process\|node\|cli.js' node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs | head -30
```

### Step 3: Trigger a fresh test
Push a trivial change to lo-plugin 0.3.2 branch, wait for CodeRabbit review, watch Railway logs in real-time:
```bash
railway logs --service cr-agent --lines 50 --latest
```
The stderr capture should now surface the actual error.

### Step 4: If Node.js is the issue
Update Dockerfile to include Node.js:
```dockerfile
FROM oven/bun:1 AS base
WORKDIR /app

RUN apt-get update && \
    apt-get install -y git curl && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*
```

### Step 5: If it's something else
The stderr output from Step 3 should tell us. Common causes:
- Missing system dependency (e.g., ripgrep, but SDK bundles its own)
- File permission issue (running as `agent` user)
- API key format/validity issue specific to this context
- Working directory issue
- Memory/resource constraint on Railway

## Files Changed So Far

### cr-agent repo (all on main, deployed to Railway)
- `src/server.ts` — HMAC-SHA256 webhook auth, round counter reset
- `src/fix-session.ts` — treeless clone, local base branch ref
- `src/agent.ts` — stderr capture in error diagnostics
- Deleted: `action/cr-fix-trigger/`, `.github/workflows/cr-fix.yml`

### lo-plugin repo (on 0.3.2 branch, PR #5)
- Deleted `.github/workflows/cr-fix.yml`
- 9 files updated for CodeRabbit review comments (hardcoded paths, ship/release/plan/work skills, changelog, backlog, stream)
- Intentional typo in `plugins/lo/skills/ship/SKILL.md` metadata (`authr` instead of `author`) for testing

## Infrastructure State

- Org webhook ID: `599578415` — `pull_request_review` → `https://cr-agent-production.up.railway.app/webhook`
- Railway project: `loosely-organized`, service: `cr-agent`, env: `production`
- GitHub Actions secrets `CR_AGENT_URL` and `CR_WEBHOOK_SECRET` deleted from org
- `cr-fix.yml` deleted from all 15 org repos

## Resume Instructions

Start a fresh Claude Code session in the cr-agent repo:
```
cd /Users/bigviking/Documents/github/projects/lo/cr-agent
```

Then:
1. Read this file: `.lo/work/cr-agent-exit-code-1-rca.md`
2. Follow the investigation plan from Step 1
3. The goal is to get cr-agent successfully processing CodeRabbit reviews on lo-plugin PR #5
