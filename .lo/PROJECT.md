---
title: "cr-agent"
description: "Autonomous CodeRabbit review fixer powered by Claude Agent SDK."
status: "explore"
state: "private"
topics:
  - code-review-automation
  - agentic-infrastructure
  - coderabbit
# repo: ""
stack:
  - Bun
  - TypeScript
  - Claude Agent SDK
infrastructure:
  - Railway
  - Supabase
  - GitHub Actions
agents:
  - name: "claude-code"
    role: "AI coding agent (Claude Code)"
---

Railway service that ingests CodeRabbit review comments, runs Claude Agent SDK to fix them autonomously, and provides visibility into when Claude is working vs. when it needs human help. Reference implementation for agentic code review automation.

## Capabilities

- **Fix Automation** — Subscribes to Supabase Realtime for CR fix requests, runs Agent SDK to resolve comments, pushes fixes
- **Interactive Approval** — Routes Claude's tool-use and clarification requests through Supabase to /ops/cr UI via canUseTool
- **Multi-Round Lifecycle** — Manages full PR lifecycle across CR re-review rounds without disconnected cold starts
- **Escalation Tracking** — Surfaces stuck/needs-human cases with aggregate metrics on autonomous vs. human resolution rates

## Architecture

Bun service on Railway subscribes to Supabase Realtime. GitHub Action trigger writes fix requests. Agent SDK resolves comments with canUseTool routing approvals through Supabase. Platform /ops/cr reads state.
