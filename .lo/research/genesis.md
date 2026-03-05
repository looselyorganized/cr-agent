# CR Agent: Genesis and Architecture

**Date:** 2026-03-04
**Context:** Design conversation during claude-dashboard work on `feat/stable-project-ids` branch

---

## How We Got Here

This project emerged from a conversation about upgrading the security gate in the LO `/ship` skill. While updating Gate 4 to include a two-phase vulnerability sweep, we audited the claude-dashboard backlog and found f004 — a design for CodeRabbit fix automation that had never been implemented.

The original f004 design (415 lines, living in `claude-dashboard/.lo/work/f004-coderabbit-fix-automation/design.md`) spec'd a distributed system: a Railway webhook server, a local launchd daemon, 3 Supabase tables, a 6-state state machine, round-based retry loops, ntfy notifications, and a new dashboard tab. Eight implementation tasks, none started.

We questioned whether this was over-engineered. The answer: yes, for a personal tool — but LORF isn't building personal tools.

---

## Why We're Building It

LORF's ethos is creating experiments that other teams can learn from. A module that:

1. Enables Claude Code to ingest CodeRabbit reviews and resolve them autonomously
2. Gives users visibility into when Claude and CR are working or when they need human help
3. Works at scale — N engineers across Y repos

That's a reference implementation worth publishing. The stuck/escalation data is arguably the most valuable output: "CR + Claude autonomously resolves X% of review comments; here are the categories that need humans" — that's a research finding.

---

## Architecture Evolution

### Original f004 (rejected)

```
GitHub → Railway webhook server → Supabase → Realtime → local daemon
→ worktree → claude --print → git push → wait → re-review → loop
```

Six network hops, four new components, a launchd service. Over-engineered.

### GitHub Action idea (rejected)

```
GitHub Action fires on CR review → runs claude --print → pushes fix
```

~40 lines of YAML. Simple, but:
- No visibility across repos/engineers
- No "Claude needs help" escalation
- No aggregate metrics
- Dies between CR re-review rounds — each round is a disconnected run
- Burns Action minutes while waiting for human responses

### Final architecture (selected)

```
GitHub Action (trigger)  →  writes "fix needed" row to Supabase
Railway service (Bun)    →  subscribes via Supabase Realtime
                         →  runs Claude Agent SDK
                         →  canUseTool routes approval requests through Supabase
                         →  pushes fixes, updates status
Platform /ops/cr         →  reads from Supabase, shows live timeline + approval UI
```

Three components. No local daemon. No webhook server.

---

## Key Design Decisions

### Why Railway service over GitHub Action for the agent?

The Action model has a fundamental problem: it fires, Claude fixes, pushes, and the action exits. When CR re-reviews, you need another trigger, another cold start. Each round is disconnected. And if Claude asks a question via `canUseTool`, the action burns minutes waiting for a response.

A Railway service subscribes to Supabase Realtime, stays alive across the full PR lifecycle (`pending → fixing → waiting_review → fixing → clean`), and handles responses instantly.

### Why GitHub Action for the trigger?

The original design had a Railway webhook server (~200 lines) to receive GitHub `pull_request_review` events, validate HMAC signatures, and write a Supabase row. A GitHub Action does the same thing in ~10 lines of YAML with zero infrastructure: no server to deploy, no signature verification needed (it *is* GitHub), no allowlist to maintain. Adding a new repo = copy the YAML file.

### Why Claude Agent SDK over claude --print?

The Agent SDK provides `canUseTool` — a programmatic permission handler that enables interactive approval mid-session. When Claude needs to run a tool or ask a question, `canUseTool` writes an approval request to Supabase. The `/ops/cr` UI shows it. The user responds. Claude continues.

`claude --print` is fire-and-forget with no interaction channel. The interactive approval loop is crucial to the UX.

### Why Agent SDK over LangChain?

The Agent SDK runs Claude Code's actual engine — the same tool system, file editing, bash, git, and codebase understanding used daily. LangChain would require rebuilding all of that from scratch as a generic agent framework. You'd be rebuilding Claude Code poorly to avoid using Claude Code directly.

### Why API key billing, not Max subscription?

The Agent SDK requires `ANTHROPIC_API_KEY` — pay-per-use API billing. Using Max subscription OAuth tokens with the SDK technically works but explicitly violates Anthropic's Terms of Service as of February 2026. They're actively enforcing with account bans.

This means every automated fix round costs API tokens, which motivates smart defaults: `--max-turns` caps, `--max-budget-usd` limits, and using Sonnet/Haiku for routine fixes.

### Why no local daemon?

The daemon existed to leverage a Max subscription (local CLI auth + git creds). Since the Agent SDK requires API keys anyway, nothing needs to run locally. The Railway service has Node, git, and API access. Your laptop can be closed.

### Skills and plugins in the Agent SDK

The SDK supports the full Claude Code skill/plugin ecosystem, but nothing loads by default. You opt in:

```typescript
query({
  prompt: "...",
  options: {
    cwd: "/path/to/repo",
    systemPrompt: { type: "preset", preset: "claude_code" },
    settingSources: ["user", "project"],  // loads CLAUDE.md + skills
    allowedTools: ["Skill", "Read", "Edit", "Glob", "Grep", "Bash"],
    plugins: [{ type: "local", path: "/path/to/plugin" }],
    canUseTool: async (toolName, input) => { /* approval logic */ }
  }
})
```

---

## The UX Vision

One continuous timeline per PR, visible on `/ops/cr`:

```
PR #147 opened
├─ CodeRabbit reviewing...
├─ CI: lint passed, types passed
├─ CR: 3 critical, 2 major, 1 minor
├─ Claude fixing (round 1/5)
├─   fixed 5/6, pushed abc1234
├─ CodeRabbit re-reviewing...
├─ CR: 1 major remaining
├─ Claude fixing (round 2/5)
├─ Claude asks: "Should this endpoint require auth?"
├─ You: "Needs auth, use middleware from routes/api.ts"
├─ Claude wants to run: npm test
├─ You: approved
├─   fixed 1/1, pushed def5678
├─ CodeRabbit re-reviewing...
├─ CR: approved
├─ CI: all checks passed
└─ Auto-merged
```

One card per PR. Everything streams into it. Green = handling itself. Orange = needs you.

---

## Relationship to Other LORF Projects

### claude-dashboard f004

The original design document lives at `claude-dashboard/.lo/work/f004-coderabbit-fix-automation/design.md`. It spec'd the daemon + webhook server + dashboard tab approach. This repo (`cr-agent`) supersedes it with the Railway service + Agent SDK + `/ops/cr` approach.

### platform f004 (Web Operations Center)

The platform repo's f004 designs `/ops` — a web dashboard including `/ops/cr` for CodeRabbit fix status. That's the visibility layer that reads from the Supabase tables this service writes to. They're complementary:

- **cr-agent** = the engine (fixes code, manages state)
- **platform /ops/cr** = the dashboard (shows status, handles approvals)

### Infrastructure question

We considered whether LORF needs dedicated hardware (Mac Mini). The answer: no. LORF's architecture is inherently distributed — local dev happens on your laptop, orchestration happens in the cloud (Railway, Supabase, GitHub). A central box would contradict LORF's thesis of decentralized agentic infrastructure. The CR agent running on Railway is consistent with this: agents coordinate through protocols and shared state, not shared hardware.

---

## Next Steps

1. Write EARS requirements for minimal feature set
2. Scaffold the Railway service (Bun + Agent SDK + Supabase client)
3. Create the GitHub Action trigger YAML (copy-pasteable across repos)
4. Build `/ops/cr` on the platform
5. Supabase migration for `cr_fix_requests` and related tables
