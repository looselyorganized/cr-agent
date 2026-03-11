# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

cr-agent is an autonomous CodeRabbit review fixer. It receives GitHub webhooks when CodeRabbit reviews a PR, runs the Claude Agent SDK to fix the issues, pushes changes, and loops until clean or stuck. It runs as a long-lived Railway service with Supabase state tracking.

## Commands

```bash
bun install                  # Install dependencies
bun run src/index.ts         # Start the service locally (needs .env)
```

No test runner or linter is configured. CI runs via a reusable workflow from `looselyorganized/ci`.

## Required Environment Variables

Copy `.env.example`. Required: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `CR_WEBHOOK_SECRET`. Optional with defaults: `PORT` (3000), `MAX_ROUNDS` (3), `MAX_TURNS` (30), `MAX_BUDGET_USD` (5), `MODEL` (sonnet), `ALLOWED_TOOLS` (Read,Edit,Write,Bash,Glob,Grep).

## Architecture

The service is a single async loop triggered by webhooks:

```
GitHub org webhook (pull_request_review)
  → server.ts: validate HMAC-SHA256, filter for coderabbitai[bot], upsert Supabase row
  → fix-session.ts: clone repo (treeless), fetch CR prompt, run agent, push fixes
  → agent.ts: Claude Agent SDK query() with claude_code preset, bypassPermissions
  → back to waiting_review — webhook re-fires on CodeRabbit re-review
```

**State machine:** `pending → fixing → waiting_review → clean | stuck | failed | cancelled`

**Concurrency:** In-memory Map prevents duplicate sessions for the same PR. One active session per repo+PR at a time.

**Key patterns:**
- Fire-and-forget: webhook returns 200 immediately, fix session runs async
- Treeless clone (`--filter=blob:none --no-single-branch`) for memory efficiency while keeping all branch refs
- Local base branch ref created before agent runs so `git diff base...HEAD` works
- Re-trigger from terminal states resets `current_round` to 0
- Agent errors prefer SDK result messages over process exit codes; stderr captured via callback (last 20 lines)

## Deployment

Railway service using Dockerfile. `oven/bun:1` base image with git installed. Runs as non-root `agent` user. Health check at `GET /health`. Restart policy: on_failure, max 5 retries.

## Supabase Tables

- `cr_fix_requests` — one row per repo+PR, tracks status/rounds/timing
- `cr_fix_rounds` — one row per fix attempt, tracks commit SHA/duration/errors
