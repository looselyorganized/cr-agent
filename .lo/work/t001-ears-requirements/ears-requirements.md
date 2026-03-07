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
- The GH Action POSTs to the cr-agent webhook (2 secrets: CR_AGENT_URL + CR_WEBHOOK_SECRET). The cr-agent handles upsert logic internally.

---

## 1. GitHub Action Trigger (f002)

### Event Detection

REQ-T01: When a `pull_request_review` event fires and the review author is `coderabbitai[bot]`, the Action shall POST PR metadata (repo, pr_number, pr_url, branch, base_branch, actor) to the cr-agent webhook endpoint.

REQ-T02: When a `pull_request_review` event fires and the review author is not `coderabbitai[bot]`, the Action shall take no action.

### Deduplication

REQ-T03: When the webhook receives a request for a repo+pr_number that already has status `waiting_review`, the cr-agent shall update that row's status to `pending`.

REQ-T04: When the webhook receives a request for a repo+pr_number that already has status `pending` or `fixing`, the cr-agent shall return a no-op response.

### Configuration

REQ-T05: The Action shall read `CR_AGENT_URL` and `CR_WEBHOOK_SECRET` from GitHub Actions secrets.

REQ-T06: The Action shall be a single composite action YAML file requiring no modification beyond secrets configuration to add to a new repository.

---

## 2. Railway Agent Service (f001)

### HTTP Server

REQ-A01: While the service is running, it shall serve an HTTP server (Hono on Bun) with `/webhook` and `/health` routes.

REQ-A02: When a valid webhook request is received with status that should trigger a fix, the service shall upsert the row in Supabase and start a fix session.

### Webhook Authentication & Validation

REQ-A18: The service shall authenticate inbound webhooks via `Authorization: Bearer <token>` matched against `CR_WEBHOOK_SECRET`. Reject with 401 on mismatch.

REQ-A19: The service shall validate webhook payload fields (repo, pr_number, pr_url, branch, base_branch, actor). Reject with 400 if missing.

REQ-A20: The service shall expose `GET /health` returning 200 for Railway health checks.

### Webhook Upsert Logic

REQ-A21: The webhook shall perform the upsert logic: query existing row for repo+pr_number, no-op if pending/fixing, patch to pending if waiting_review, insert new row otherwise.

REQ-A22: The webhook shall return 200 immediately after upsert. Fix sessions run asynchronously (fire-and-forget).

### Fix Session

REQ-A03: When a fix session starts, the service shall update the row's status to `fixing` and increment `current_round`.

REQ-A04: The service shall fetch the latest CodeRabbit review from the PR and extract the "Prompt for all review comments with AI agents" section as the fix prompt.

REQ-A05: The service shall clone the PR branch and invoke Claude Agent SDK with the extracted prompt, passing `allowedTools`, `maxTurns`, and `maxBudgetUsd` from environment configuration.

REQ-A06: When Claude Agent SDK completes successfully, the service shall commit and push the changes to the PR branch.

REQ-A07: When a fix round push succeeds, the service shall update the row's status to `waiting_review`.

### Multi-Round

REQ-A08: While a fix request has status `waiting_review` and a new CodeRabbit review arrives (row returns to `pending` via the webhook), the service shall start another fix round on the same row.

REQ-A09: When `current_round` reaches `max_rounds` (default: 3), the service shall update the row's status to `stuck`.

### Concurrency

REQ-A10: The service shall process at most one fix session per PR at a time.

REQ-A11: The service shall support concurrent fix sessions across different PRs.

### Error Handling

REQ-A12: If Claude Agent SDK exits with a non-zero status, then the service shall update the round's status to `failed` and log the error.

REQ-A13: If a git push fails, then the service shall update the round's status to `failed` and log the error.

REQ-A14: If the PR is closed or merged during a fix session, then the service shall update the fix request status to `cancelled` and stop the session.

### Configuration

REQ-A16: The service shall read `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, and `CR_WEBHOOK_SECRET` from environment variables.

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

REQ-S05: The `cr_fix_requests` table shall be added to the Supabase Realtime publication. (For downstream UI consumers, not trigger.)

### Security

REQ-S06: The schema shall include RLS policies that restrict the publishable key to read-only access on all tables.

REQ-S07: The schema shall include RLS policies that allow the secret key full access to all tables.

---

## 4. Cross-Cutting

### Logging

REQ-X01: The service shall log each state transition with timestamp, repo, PR number, and round number.

### Data Contract

REQ-X02: Every state transition and round completion shall be reflected in the Supabase tables, enabling downstream consumers to reconstruct the full timeline by querying `cr_fix_requests` and `cr_fix_rounds`.
