---
updated: 2026-03-04
---

## Features

### f001 — Railway Agent Service
Long-running Bun service on Railway that subscribes to Supabase Realtime for fix requests, runs Claude Agent SDK to resolve CodeRabbit comments, and manages the full PR lifecycle (pending → fixing → waiting_review → clean).
Status: backlog

### f002 — GitHub Action Trigger
Copy-pasteable GitHub Action YAML that fires on `pull_request_review` events from CodeRabbit, writes a "fix needed" row to Supabase. Zero infrastructure — replaces the webhook server from the original f004 design.
Status: backlog

### f003 — Supabase Schema
Tables for `cr_fix_requests`, approval state, and timeline events. Powers both the agent service (read/write) and the platform `/ops/cr` dashboard (read). Includes Realtime subscriptions and RLS policies.
Status: backlog

## Tasks

- [ ] t001 Write EARS requirements for minimal feature set
- [ ] t002 Scaffold Bun project with Agent SDK and Supabase client dependencies
- [ ] t003 Create Supabase project and initial migration for cr_fix_requests
