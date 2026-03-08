---
updated: 2026-03-07
---

## Features

### f001 — Railway Agent Service
Long-running Bun service on Railway that subscribes to Supabase Realtime for fix requests, runs Claude Agent SDK to resolve CodeRabbit comments, and manages the full PR lifecycle (pending → fixing → waiting_review → clean).
Status: done

### f002 — GitHub Org Webhook Trigger
Direct org-level GitHub webhook sends `pull_request_review` events to cr-agent. Replaces per-repo GitHub Action workflow — zero files per repo, native HMAC-SHA256 auth.
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
- [x] t004 ~~Refactor trigger architecture: replace Realtime subscription with HTTP webhook endpoint on Railway. GH Action POSTs to Railway instead of writing to Supabase directly. Simplifies action to one secret (CR_AGENT_URL), removes Realtime reconnection logic, Railway writes to Supabase.~~ -> 2026-03-07
- [x] t005 ~~Copy cr-fix workflow into platform repo and configure secrets for end-to-end test~~ -> 2026-03-07
- [ ] t006 Create research article on releasing an early version of cr-agent and the first successful e2e run
