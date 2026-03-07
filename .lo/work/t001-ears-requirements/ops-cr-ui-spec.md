---
date: 2026-03-07
for: platform repo
status: spec
---

# /ops/cr — CodeRabbit Fix Status Page

Minimal read-only event feed showing what cr-agent is doing across all repos. No actions, no approval UI — just visibility.

## Data Source

Reads from cr-agent's Supabase tables (same project, already connected in platform):

**`cr_fix_requests`** — one row per PR fix lifecycle
- id, repo, pr_number, pr_url, branch, status, current_round, max_rounds, triggered_by, created_at, updated_at, completed_at

**`cr_fix_rounds`** — one row per fix attempt
- id, request_id (fk), round_number, commit_sha, started_at, finished_at, duration_ms, status, error

**Realtime:** Both tables are in the Supabase Realtime publication. Subscribe for live updates.

## Page Layout

```
/ops/cr

┌─────────────────────────────────────────────────┐
│ CR Agent Status                          3 active│
├─────────────────────────────────────────────────┤
│                                                  │
│ ● fixing   platform #12  round 2/3     12s ago  │
│   looselyorganized/platform                      │
│   Round 1: ✓ completed  abc1234  45s             │
│   Round 2: ⟳ running...                          │
│                                                  │
│ ● waiting  cr-agent #1   round 1/3      3m ago  │
│   looselyorganized/cr-agent                      │
│   Round 1: ✓ completed  def5678  32s             │
│                                                  │
│ ✓ clean    platform #11  round 1/3     28m ago  │
│   looselyorganized/platform                      │
│   Round 1: ✓ completed  ghi9012  28s             │
│                                                  │
│ ✗ stuck    dashboard #7  round 3/3      2h ago  │
│   looselyorganized/dashboard                     │
│   Round 1: ✓ completed  23s                      │
│   Round 2: ✓ completed  41s                      │
│   Round 3: ✗ failed    "Agent SDK timeout"       │
│                                                  │
└─────────────────────────────────────────────────┘
```

## Status Badges

| Status | Color | Icon |
|--------|-------|------|
| pending | muted | ○ |
| fixing | amber/warning | ⟳ |
| waiting_review | blue/info | ● |
| clean | green/positive | ✓ |
| stuck | red/negative | ✗ |
| failed | red/negative | ✗ |
| cancelled | muted | — |

Use StockTaper design tokens — `bg-positive`, `bg-negative`, `bg-warning`, `bg-muted`.

## Behavior

1. **Initial load:** Fetch all `cr_fix_requests` ordered by `updated_at desc`, with their `cr_fix_rounds` joined.
2. **Realtime:** Subscribe to both tables. On change, update the relevant card in place.
3. **Sorting:** Active items (pending, fixing, waiting_review) at top, completed items below.
4. **PR link:** Each card's PR number links to `pr_url` on GitHub.
5. **Commit link:** Each round's commit SHA links to the commit on GitHub.
6. **Duration:** Show human-readable relative time ("12s ago", "3m ago") for updated_at. Show round duration in seconds.
7. **Empty state:** "No fix requests yet. cr-agent will appear here when CodeRabbit reviews a PR."

## Implementation Notes

- Single page: `src/app/ops/cr/page.tsx`
- One hook: `useCRFixRequests()` — fetches initial data + subscribes to Realtime
- One component: `<FixRequestCard />` — renders a single PR's status + rounds
- Use existing Supabase client from platform's lib
- No server actions needed — this is read-only
- Fits the dashed-border card pattern from StockTaper design system

## Out of Scope

- Approval/response UI (v2 — when canUseTool is added to cr-agent)
- Filtering by repo
- Historical analytics
- Notifications
