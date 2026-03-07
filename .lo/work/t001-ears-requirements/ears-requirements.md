---
task: t001
date: 2026-03-07
status: draft
audience: claude-agents
---

# EARS Requirements — cr-agent v1

Minimal viable system: GitHub Action trigger (f002), Railway agent service (f001), Supabase schema (f003). Audience is Claude agents implementing from these requirements.

## Scope

**In:** Autonomous fix loop (trigger -> agent -> fix -> push -> wait -> loop), Supabase data contract enabling downstream UI.

**Out (v2+):** canUseTool interactive approval, cr_approval_requests table, escalation guard (comments increasing detection), stuck PR escalation comment, event feed UI (/ops/cr), evals/analytics (f004), notifications, per-repo config table.

## Key Design Decisions

- CodeRabbit provides a pre-built prompt section ("Prompt for all review comments with AI agents") in each review. The agent extracts this directly rather than fetching and parsing individual comments.
- CodeRabbit automatically re-reviews when it sees a new push. No GitHub commenting or @coderabbitai tagging needed from the agent.
- canUseTool is deferred to v2 alongside the response UI. V1 relies on Agent SDK's allowedTools, maxTurns, and maxBudgetUsd for safety.
- Max rounds defaults to 3. Most CR reviews resolve in 1-2 rounds.
- Supabase uses publishable key (read-only) and secret key (full access). service_role is deprecated.

---

## 1. GitHub Action Trigger (f002)

### Event Detection

REQ-T01: When a `pull_request_review` event fires and the review author is `coderabbitai[bot]`, the Action shall insert a row into `cr_fix_requests` with status `pending`, populating: repo, pr_number, pr_url, branch, base_branch, triggered_by, created_at.

REQ-T02: When a `pull_request_review` event fires and the review author is not `coderabbitai[bot]`, the Action shall take no action.

### Deduplication

REQ-T03: When a fix request row already exists for the same repo and PR number with status `waiting_review`, the Action shall update that row's status to `pending`.

REQ-T04: When a fix request row already exists for the same repo and PR number with status `pending` or `fixing`, the Action shall take no action.

### Configuration

REQ-T05: The Action shall read `SUPABASE_URL` and `SUPABASE_SECRET_KEY` from GitHub Actions secrets.

REQ-T06: The Action shall be a single composite action YAML file requiring no modification beyond secrets configuration to add to a new repository.

---

## 2. Railway Agent Service (f001)

### Subscription

REQ-A01: While the service is running, it shall maintain a Supabase Realtime subscription on the `cr_fix_requests` table filtered to status `pending`.

REQ-A02: When a row transitions to status `pending`, the service shall start a fix session for that row.

### Fix Session

REQ-A03: When a fix session starts, the service shall update the row's status to `fixing` and increment `current_round`.

REQ-A04: The service shall fetch the latest CodeRabbit review from the PR and extract the "Prompt for all review comments with AI agents" section as the fix prompt.

REQ-A05: The service shall clone the PR branch and invoke Claude Agent SDK with the extracted prompt, passing `allowedTools`, `maxTurns`, and `maxBudgetUsd` from environment configuration.

REQ-A06: When Claude Agent SDK completes successfully, the service shall commit and push the changes to the PR branch.

REQ-A07: When a fix round push succeeds, the service shall update the row's status to `waiting_review`.

### Multi-Round

REQ-A08: While a fix request has status `waiting_review` and a new CodeRabbit review arrives (row returns to `pending` via the Action), the service shall start another fix round on the same row.

REQ-A09: When `current_round` reaches `max_rounds` (default: 3), the service shall update the row's status to `stuck`.

### Concurrency

REQ-A10: The service shall process at most one fix session per PR at a time.

REQ-A11: The service shall support concurrent fix sessions across different PRs.

### Error Handling

REQ-A12: If Claude Agent SDK exits with a non-zero status, then the service shall update the round's status to `failed` and log the error.

REQ-A13: If a git push fails, then the service shall update the round's status to `failed` and log the error.

REQ-A14: If the PR is closed or merged during a fix session, then the service shall update the fix request status to `cancelled` and stop the session.

REQ-A15: If the Supabase Realtime connection drops, then the service shall attempt to reconnect with exponential backoff.

### Configuration

REQ-A16: The service shall read `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `ANTHROPIC_API_KEY`, and `GITHUB_TOKEN` from environment variables.

REQ-A17: The service shall support environment variable configuration for `max_rounds` (default: 3), `max_turns`, `max_budget_usd`, `model`, and `allowed_tools`.

---

## 3. Supabase Schema (f003)

### Tables

REQ-S01: The schema shall include a `cr_fix_requests` table with columns: id (uuid pk), repo (text), pr_number (int), pr_url (text), branch (text), base_branch (text), status (text), current_round (int, default 0), max_rounds (int, default 3), triggered_by (text), created_at (timestamptz), updated_at (timestamptz), completed_at (timestamptz).

REQ-S02: The schema shall include a `cr_fix_rounds` table with columns: id (uuid pk), request_id (uuid fk to cr_fix_requests), round_number (int), commit_sha (text), started_at (timestamptz), finished_at (timestamptz), duration_ms (int), status (text), error (text).

### State Machine

REQ-S03: The `cr_fix_requests.status` column shall accept only: `pending`, `fixing`, `waiting_review`, `clean`, `stuck`, `failed`, `cancelled`.

REQ-S04: The `cr_fix_rounds.status` column shall accept only: `running`, `completed`, `failed`.

### Realtime

REQ-S05: The `cr_fix_requests` table shall be added to the Supabase Realtime publication.

### Security

REQ-S06: The schema shall include RLS policies that restrict the publishable key to read-only access on all tables.

REQ-S07: The schema shall include RLS policies that allow the secret key full access to all tables.

---

## 4. Cross-Cutting

### Logging

REQ-X01: The service shall log each state transition with timestamp, repo, PR number, and round number.

### Data Contract

REQ-X02: Every state transition and round completion shall be reflected in the Supabase tables, enabling downstream consumers to reconstruct the full timeline by querying `cr_fix_requests` and `cr_fix_rounds`.
