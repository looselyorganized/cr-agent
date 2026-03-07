---
updated: 2026-03-07
---

## Features

### f001 — Railway Agent Service
Long-running Bun service on Railway that subscribes to Supabase Realtime for fix requests, runs Claude Agent SDK to resolve CodeRabbit comments, and manages the full PR lifecycle (pending → fixing → waiting_review → clean).
Status: done

### f002 — GitHub Action Trigger
Copy-pasteable GitHub Action YAML that fires on `pull_request_review` events from CodeRabbit, writes a "fix needed" row to Supabase. Zero infrastructure — replaces the webhook server from the original f004 design.
Status: done

### f003 — Supabase Schema
Tables for `cr_fix_requests` and `cr_fix_rounds`. Powers the agent service (read/write) and enables downstream UI. Includes Realtime subscriptions and RLS policies.
Status: done

### f004 — Evals
Analytics pipeline tracking CR+Claude resolution efficacy: what percentage of review comments are autonomously resolved, which categories consistently need humans, and aggregate metrics over time.
Status: backlog

## Tasks

- [x] t001 ~~Write EARS requirements for minimal feature set~~ -> 2026-03-07
- [x] t002 ~~Scaffold Bun project with Agent SDK and Supabase client dependencies~~ -> 2026-03-07
- [x] t003 ~~Create Supabase project and initial migration for cr_fix_requests~~ -> 2026-03-07
- [ ] t004 Refactor trigger architecture: replace Realtime subscription with HTTP webhook endpoint on Railway. GH Action POSTs to Railway instead of writing to Supabase directly. Simplifies action to one secret (CR_AGENT_URL), removes Realtime reconnection logic, Railway writes to Supabase.
- [ ] t005 Copy cr-fix workflow into platform repo and configure secrets for end-to-end test
