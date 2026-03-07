# cr-agent v1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the autonomous CodeRabbit fix loop — GitHub Action trigger writes fix requests to Supabase, Railway agent service subscribes and runs Claude Agent SDK to fix them.

**Architecture:** GitHub Action fires on CR review → inserts/updates row in Supabase `cr_fix_requests` → Railway Bun service subscribes via Supabase Realtime → clones repo, extracts CR's AI prompt, runs Agent SDK → commits and pushes fix → CR auto-re-reviews → loop until clean or max rounds (3).

**Tech Stack:** Bun, TypeScript, `@anthropic-ai/claude-agent-sdk`, `@supabase/supabase-js`, GitHub Actions

**Requirements:** `.lo/work/t001-ears-requirements/ears-requirements.md`

---

## Task 1: Supabase Schema Migration (f003)

**Files:**
- Create: `supabase/migrations/001_cr_fix_tables.sql`

**Step 1: Write the migration**

```sql
-- cr_fix_requests: one row per PR fix lifecycle
create table cr_fix_requests (
  id            uuid primary key default gen_random_uuid(),
  repo          text not null,
  pr_number     int not null,
  pr_url        text not null,
  branch        text not null,
  base_branch   text not null,
  status        text not null default 'pending'
                check (status in ('pending', 'fixing', 'waiting_review', 'clean', 'stuck', 'failed', 'cancelled')),
  current_round int not null default 0,
  max_rounds    int not null default 3,
  triggered_by  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  completed_at  timestamptz,
  unique (repo, pr_number)
);

-- cr_fix_rounds: one row per fix attempt
create table cr_fix_rounds (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null references cr_fix_requests(id) on delete cascade,
  round_number  int not null,
  commit_sha    text,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  duration_ms   int,
  status        text not null default 'running'
                check (status in ('running', 'completed', 'failed')),
  error         text
);

-- Enable Realtime on fix_requests (REQ-S05)
alter publication supabase_realtime add table cr_fix_requests;

-- RLS: publishable key = read-only (REQ-S06)
alter table cr_fix_requests enable row level security;
alter table cr_fix_rounds enable row level security;

create policy "read_fix_requests" on cr_fix_requests
  for select using (true);

create policy "read_fix_rounds" on cr_fix_rounds
  for select using (true);

-- Secret key (service role) bypasses RLS automatically (REQ-S07)
```

**Step 2: Apply migration**

Run via Supabase dashboard SQL editor or `supabase db push` if using the CLI locally. Verify tables exist and Realtime is enabled.

**Step 3: Commit**

```bash
git add supabase/migrations/001_cr_fix_tables.sql
git commit -m "feat(f003): add cr_fix_requests and cr_fix_rounds schema"
```

**Satisfies:** REQ-S01, REQ-S02, REQ-S03, REQ-S04, REQ-S05, REQ-S06, REQ-S07

---

## Task 2: GitHub Action Trigger (f002)

**Files:**
- Create: `action/cr-fix-trigger/action.yml`

**Step 1: Write the composite action**

```yaml
name: "CR Fix Trigger"
description: "Triggers cr-agent when CodeRabbit reviews a PR"

inputs:
  supabase-url:
    description: "Supabase project URL"
    required: true
  supabase-secret-key:
    description: "Supabase secret key"
    required: true

runs:
  using: "composite"
  steps:
    - name: Trigger cr-agent
      shell: bash
      env:
        SUPABASE_URL: ${{ inputs.supabase-url }}
        SUPABASE_SECRET_KEY: ${{ inputs.supabase-secret-key }}
        REVIEW_AUTHOR: ${{ github.event.review.user.login }}
        PR_NUMBER: ${{ github.event.pull_request.number }}
        PR_URL: ${{ github.event.pull_request.html_url }}
        PR_BRANCH: ${{ github.event.pull_request.head.ref }}
        PR_BASE: ${{ github.event.pull_request.base.ref }}
        REPO: ${{ github.repository }}
        ACTOR: ${{ github.actor }}
      run: |
        # REQ-T02: Only act on CodeRabbit reviews
        if [ "$REVIEW_AUTHOR" != "coderabbitai[bot]" ]; then
          echo "Not a CodeRabbit review, skipping"
          exit 0
        fi

        # Check for existing row
        EXISTING=$(curl -s \
          -H "apikey: $SUPABASE_SECRET_KEY" \
          -H "Authorization: Bearer $SUPABASE_SECRET_KEY" \
          "${SUPABASE_URL}/rest/v1/cr_fix_requests?repo=eq.${REPO}&pr_number=eq.${PR_NUMBER}&select=id,status" \
        )

        STATUS=$(echo "$EXISTING" | jq -r '.[0].status // empty')
        ROW_ID=$(echo "$EXISTING" | jq -r '.[0].id // empty')

        # REQ-T04: Skip if already pending or fixing
        if [ "$STATUS" = "pending" ] || [ "$STATUS" = "fixing" ]; then
          echo "Already $STATUS, skipping"
          exit 0
        fi

        # REQ-T03: Update waiting_review -> pending
        if [ "$STATUS" = "waiting_review" ]; then
          curl -s -X PATCH \
            -H "apikey: $SUPABASE_SECRET_KEY" \
            -H "Authorization: Bearer $SUPABASE_SECRET_KEY" \
            -H "Content-Type: application/json" \
            -d '{"status": "pending", "updated_at": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}' \
            "${SUPABASE_URL}/rest/v1/cr_fix_requests?id=eq.${ROW_ID}"
          echo "Updated existing row to pending"
          exit 0
        fi

        # REQ-T01: Insert new row
        curl -s -X POST \
          -H "apikey: $SUPABASE_SECRET_KEY" \
          -H "Authorization: Bearer $SUPABASE_SECRET_KEY" \
          -H "Content-Type: application/json" \
          -H "Prefer: return=minimal" \
          -d '{
            "repo": "'"$REPO"'",
            "pr_number": '"$PR_NUMBER"',
            "pr_url": "'"$PR_URL"'",
            "branch": "'"$PR_BRANCH"'",
            "base_branch": "'"$PR_BASE"'",
            "triggered_by": "'"$ACTOR"'",
            "status": "pending"
          }' \
          "${SUPABASE_URL}/rest/v1/cr_fix_requests"
        echo "Created new fix request"
```

**Step 2: Write the example workflow consumers copy into their repos**

Create: `action/cr-fix-trigger/example-workflow.yml`

```yaml
# .github/workflows/cr-fix.yml — copy this into any repo
name: CR Fix Trigger
on:
  pull_request_review:
    types: [submitted]

jobs:
  trigger:
    runs-on: ubuntu-latest
    steps:
      - uses: looselyorganized/cr-agent/action/cr-fix-trigger@main
        with:
          supabase-url: ${{ secrets.CR_AGENT_SUPABASE_URL }}
          supabase-secret-key: ${{ secrets.CR_AGENT_SUPABASE_SECRET_KEY }}
```

**Step 3: Commit**

```bash
git add action/cr-fix-trigger/
git commit -m "feat(f002): add GitHub Action trigger for CodeRabbit reviews"
```

**Satisfies:** REQ-T01, REQ-T02, REQ-T03, REQ-T04, REQ-T05, REQ-T06

---

## Task 3: Scaffold Bun Project (f001 foundation)

**Files:**
- Create: `src/index.ts` (entry point, placeholder)
- Create: `src/config.ts` (environment config)
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.env.example`

**Step 1: Initialize project**

```bash
bun init -y
```

**Step 2: Install dependencies**

```bash
bun add @anthropic-ai/claude-agent-sdk @supabase/supabase-js
```

**Step 3: Write config module**

`src/config.ts`:

```typescript
function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

export const config = {
  supabaseUrl: required("SUPABASE_URL"),
  supabaseSecretKey: required("SUPABASE_SECRET_KEY"),
  anthropicApiKey: required("ANTHROPIC_API_KEY"),
  githubToken: required("GITHUB_TOKEN"),
  maxRounds: Number(process.env.MAX_ROUNDS ?? "3"),
  maxTurns: Number(process.env.MAX_TURNS ?? "30"),
  maxBudgetUsd: Number(process.env.MAX_BUDGET_USD ?? "5"),
  model: process.env.MODEL ?? "sonnet",
  allowedTools: (process.env.ALLOWED_TOOLS ?? "Read,Edit,Write,Bash,Glob,Grep").split(","),
};
```

**Step 4: Write .env.example**

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
ANTHROPIC_API_KEY=sk-ant-...
GITHUB_TOKEN=ghp_...
MAX_ROUNDS=3
MAX_TURNS=30
MAX_BUDGET_USD=5
MODEL=sonnet
ALLOWED_TOOLS=Read,Edit,Write,Bash,Glob,Grep
```

**Step 5: Write placeholder entry point**

`src/index.ts`:

```typescript
import { config } from "./config";

console.log("cr-agent starting...");
console.log(`max_rounds=${config.maxRounds} model=${config.model}`);
```

**Step 6: Commit**

```bash
git add package.json bun.lock tsconfig.json src/ .env.example
git commit -m "feat(f001): scaffold Bun project with Agent SDK and Supabase deps"
```

**Satisfies:** REQ-A16, REQ-A17

---

## Task 4: Supabase Realtime Subscription

**Files:**
- Create: `src/supabase.ts` (client + subscription)
- Modify: `src/index.ts` (wire up subscription)

**Step 1: Write Supabase client and subscription**

`src/supabase.ts`:

```typescript
import { createClient, type RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { config } from "./config";

export const supabase = createClient(config.supabaseUrl, config.supabaseSecretKey);

export interface FixRequest {
  id: string;
  repo: string;
  pr_number: number;
  pr_url: string;
  branch: string;
  base_branch: string;
  status: string;
  current_round: number;
  max_rounds: number;
  triggered_by: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export function subscribeToPendingRequests(
  onPending: (row: FixRequest) => void
): void {
  const channel = supabase
    .channel("cr-fix-requests")
    .on<FixRequest>(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "cr_fix_requests",
        filter: "status=eq.pending",
      },
      (payload: RealtimePostgresChangesPayload<FixRequest>) => {
        if (payload.new && "id" in payload.new) {
          onPending(payload.new as FixRequest);
        }
      }
    )
    .subscribe((status) => {
      console.log(`[realtime] subscription status: ${status}`);
    });
}
```

**Step 2: Wire up in index.ts**

```typescript
import { config } from "./config";
import { subscribeToPendingRequests } from "./supabase";
import { handleFixRequest } from "./fix-session";

console.log("cr-agent starting...");
console.log(`max_rounds=${config.maxRounds} model=${config.model}`);

subscribeToPendingRequests((row) => {
  console.log(`[trigger] fix request for ${row.repo}#${row.pr_number}`);
  handleFixRequest(row);
});
```

**Step 3: Commit**

```bash
git add src/supabase.ts src/index.ts
git commit -m "feat(f001): add Supabase Realtime subscription for pending fix requests"
```

**Satisfies:** REQ-A01, REQ-A02, REQ-X02

---

## Task 5: Fix Session — Core Loop

**Files:**
- Create: `src/fix-session.ts` (orchestrator)
- Create: `src/github.ts` (fetch CR prompt, check PR status)
- Create: `src/agent.ts` (Agent SDK wrapper)
- Create: `src/log.ts` (structured logger)

**Step 1: Write the logger**

`src/log.ts`:

```typescript
export function log(
  level: "info" | "error",
  event: string,
  data: { repo: string; pr: number; round?: number; [key: string]: unknown }
): void {
  const entry = {
    ts: new Date().toISOString(),
    event,
    ...data,
  };
  if (level === "error") {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}
```

**Step 2: Write GitHub helper**

`src/github.ts`:

```typescript
import { config } from "./config";

const headers = {
  Authorization: `Bearer ${config.githubToken}`,
  Accept: "application/vnd.github.v3+json",
};

/** Fetch the latest CodeRabbit review and extract the AI agent prompt section. */
export async function fetchCRPrompt(repo: string, prNumber: number): Promise<string | null> {
  const res = await fetch(
    `https://api.github.com/repos/${repo}/pulls/${prNumber}/reviews`,
    { headers }
  );
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);

  const reviews: Array<{ user: { login: string }; body: string }> = await res.json();

  // Find the latest CodeRabbit review (most recent last)
  const crReviews = reviews.filter((r) => r.user.login === "coderabbitai[bot]");
  if (crReviews.length === 0) return null;

  const latestReview = crReviews[crReviews.length - 1];
  return extractAIPrompt(latestReview.body);
}

/** Extract the "Prompt for all review comments with AI agents" section. */
function extractAIPrompt(body: string): string | null {
  // CR wraps the prompt in a details/summary block or as a fenced code block
  // Look for the robot emoji section
  const marker = "🤖 Prompt for all review comments with AI agents";
  const idx = body.indexOf(marker);
  if (idx === -1) return null;

  // Extract everything after the marker until end or next major section
  const after = body.slice(idx + marker.length);

  // If it's in a code fence, extract that
  const fenceMatch = after.match(/```\n?([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();

  // Otherwise take the text block
  return after.trim();
}

/** Check if PR is still open. */
export async function isPROpen(repo: string, prNumber: number): Promise<boolean> {
  const res = await fetch(
    `https://api.github.com/repos/${repo}/pulls/${prNumber}`,
    { headers }
  );
  if (!res.ok) return false;
  const pr: { state: string } = await res.json();
  return pr.state === "open";
}
```

**Step 3: Write Agent SDK wrapper**

`src/agent.ts`:

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";
import { config } from "./config";

export interface AgentResult {
  success: boolean;
  error?: string;
}

export async function runAgent(prompt: string, cwd: string): Promise<AgentResult> {
  try {
    let lastResult = "";

    for await (const message of query({
      prompt,
      options: {
        cwd,
        model: config.model,
        allowedTools: config.allowedTools,
        maxTurns: config.maxTurns,
        maxBudgetUsd: config.maxBudgetUsd,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: "You are fixing CodeRabbit review comments. Make minimal, focused changes. Do not refactor surrounding code.",
        },
      },
    })) {
      if ("result" in message) {
        lastResult = String(message.result);
      }
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}
```

**Step 4: Write fix session orchestrator**

`src/fix-session.ts`:

```typescript
import { supabase, type FixRequest } from "./supabase";
import { fetchCRPrompt, isPROpen } from "./github";
import { runAgent } from "./agent";
import { config } from "./config";
import { log } from "./log";

// REQ-A10: One session per PR at a time
const activeSessions = new Map<string, boolean>();

function sessionKey(repo: string, prNumber: number): string {
  return `${repo}#${prNumber}`;
}

export async function handleFixRequest(row: FixRequest): Promise<void> {
  const key = sessionKey(row.repo, row.pr_number);

  // REQ-A10: Skip if already processing this PR
  if (activeSessions.get(key)) {
    log("info", "session_skipped", { repo: row.repo, pr: row.pr_number, reason: "already_active" });
    return;
  }

  activeSessions.set(key, true);
  try {
    await runFixSession(row);
  } finally {
    activeSessions.delete(key);
  }
}

async function runFixSession(row: FixRequest): Promise<void> {
  const { repo, pr_number: pr } = row;
  const nextRound = row.current_round + 1;

  // REQ-A09: Check max rounds
  if (nextRound > (row.max_rounds || config.maxRounds)) {
    log("info", "status_stuck", { repo, pr, round: nextRound });
    await supabase
      .from("cr_fix_requests")
      .update({ status: "stuck", updated_at: new Date().toISOString(), completed_at: new Date().toISOString() })
      .eq("id", row.id);
    return;
  }

  // REQ-A03: Update to fixing, increment round
  log("info", "status_fixing", { repo, pr, round: nextRound });
  await supabase
    .from("cr_fix_requests")
    .update({ status: "fixing", current_round: nextRound, updated_at: new Date().toISOString() })
    .eq("id", row.id);

  // Insert round row
  const { data: roundRow } = await supabase
    .from("cr_fix_rounds")
    .insert({ request_id: row.id, round_number: nextRound, status: "running" })
    .select("id")
    .single();

  const roundId = roundRow?.id;
  const roundStart = Date.now();

  // REQ-A14: Check if PR is still open
  if (!(await isPROpen(repo, pr))) {
    log("info", "status_cancelled", { repo, pr, reason: "pr_closed" });
    await supabase
      .from("cr_fix_requests")
      .update({ status: "cancelled", updated_at: new Date().toISOString(), completed_at: new Date().toISOString() })
      .eq("id", row.id);
    if (roundId) {
      await supabase
        .from("cr_fix_rounds")
        .update({ status: "failed", error: "PR closed", finished_at: new Date().toISOString(), duration_ms: Date.now() - roundStart })
        .eq("id", roundId);
    }
    return;
  }

  // REQ-A04: Fetch CR prompt
  const crPrompt = await fetchCRPrompt(repo, pr);
  if (!crPrompt) {
    // No CR comments found — mark as clean
    log("info", "status_clean", { repo, pr, round: nextRound });
    await supabase
      .from("cr_fix_requests")
      .update({ status: "clean", updated_at: new Date().toISOString(), completed_at: new Date().toISOString() })
      .eq("id", row.id);
    if (roundId) {
      await supabase
        .from("cr_fix_rounds")
        .update({ status: "completed", finished_at: new Date().toISOString(), duration_ms: Date.now() - roundStart })
        .eq("id", roundId);
    }
    return;
  }

  // REQ-A05: Clone and run agent
  const workDir = `/tmp/cr-agent/${repo.replace("/", "-")}-pr${pr}`;
  await cloneRepo(repo, row.branch, workDir);

  const prompt = [
    `You are fixing CodeRabbit review comments on PR #${pr} in ${repo}.`,
    `Branch: ${row.branch}`,
    `Round: ${nextRound} of ${row.max_rounds || config.maxRounds}`,
    "",
    crPrompt,
    "",
    'After fixing all issues, commit with message: "fix: resolve CodeRabbit review comments (round ' + nextRound + ')"',
    "Then push to the remote branch.",
  ].join("\n");

  const result = await runAgent(prompt, workDir);

  const durationMs = Date.now() - roundStart;

  if (!result.success) {
    // REQ-A12: Agent failed
    log("error", "round_failed", { repo, pr, round: nextRound, error: result.error });
    if (roundId) {
      await supabase
        .from("cr_fix_rounds")
        .update({ status: "failed", error: result.error, finished_at: new Date().toISOString(), duration_ms: durationMs })
        .eq("id", roundId);
    }
    return;
  }

  // REQ-A06 + REQ-A07: Get commit SHA and update status
  const commitSha = await getHeadSha(workDir);
  log("info", "status_waiting_review", { repo, pr, round: nextRound, commit: commitSha, duration_ms: durationMs });

  if (roundId) {
    await supabase
      .from("cr_fix_rounds")
      .update({ status: "completed", commit_sha: commitSha, finished_at: new Date().toISOString(), duration_ms: durationMs })
      .eq("id", roundId);
  }

  await supabase
    .from("cr_fix_requests")
    .update({ status: "waiting_review", updated_at: new Date().toISOString() })
    .eq("id", row.id);

  // Cleanup
  await Bun.spawn(["rm", "-rf", workDir]).exited;
}

async function cloneRepo(repo: string, branch: string, dest: string): Promise<void> {
  await Bun.spawn(["rm", "-rf", dest]).exited;
  const proc = Bun.spawn([
    "git", "clone",
    "--depth", "1",
    "--branch", branch,
    `https://x-access-token:${config.githubToken}@github.com/${repo}.git`,
    dest,
  ]);
  const exitCode = await proc.exited;
  if (exitCode !== 0) throw new Error(`git clone failed with exit code ${exitCode}`);
}

async function getHeadSha(cwd: string): Promise<string> {
  const proc = Bun.spawn(["git", "rev-parse", "HEAD"], { cwd });
  const output = await new Response(proc.stdout).text();
  return output.trim();
}
```

**Step 5: Commit**

```bash
git add src/
git commit -m "feat(f001): implement fix session core loop with Agent SDK"
```

**Satisfies:** REQ-A03, REQ-A04, REQ-A05, REQ-A06, REQ-A07, REQ-A08, REQ-A09, REQ-A10, REQ-A11, REQ-A12, REQ-A13, REQ-A14, REQ-X01, REQ-X02

---

## Task 6: Reconnection Logic

**Files:**
- Modify: `src/supabase.ts` (add reconnection with exponential backoff)

**Step 1: Add reconnection handling**

Update `subscribeToPendingRequests` in `src/supabase.ts` to handle disconnection:

```typescript
export function subscribeToPendingRequests(
  onPending: (row: FixRequest) => void
): void {
  let retryDelay = 1000;
  const maxDelay = 30000;

  function connect() {
    const channel = supabase
      .channel("cr-fix-requests")
      .on<FixRequest>(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "cr_fix_requests",
          filter: "status=eq.pending",
        },
        (payload: RealtimePostgresChangesPayload<FixRequest>) => {
          if (payload.new && "id" in payload.new) {
            onPending(payload.new as FixRequest);
          }
        }
      )
      .subscribe((status) => {
        console.log(`[realtime] status: ${status}`);
        if (status === "SUBSCRIBED") {
          retryDelay = 1000; // Reset on successful connection
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error(`[realtime] connection lost, reconnecting in ${retryDelay}ms`);
          setTimeout(() => {
            channel.unsubscribe();
            retryDelay = Math.min(retryDelay * 2, maxDelay);
            connect();
          }, retryDelay);
        }
      });
  }

  connect();
}
```

**Step 2: Commit**

```bash
git add src/supabase.ts
git commit -m "feat(f001): add Realtime reconnection with exponential backoff"
```

**Satisfies:** REQ-A15

---

## Task 7: Railway Deployment Config

**Files:**
- Create: `Dockerfile`
- Create: `railway.toml`

**Step 1: Write Dockerfile**

```dockerfile
FROM oven/bun:1 AS base
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY src/ src/
COPY tsconfig.json ./

CMD ["bun", "run", "src/index.ts"]
```

**Step 2: Write railway.toml**

```toml
[build]
builder = "dockerfile"

[deploy]
healthcheckPath = "/"
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 5
```

**Step 3: Commit**

```bash
git add Dockerfile railway.toml
git commit -m "feat(f001): add Dockerfile and Railway deployment config"
```

---

## Task Order and Dependencies

```
Task 1 (Schema) ─── no deps, do first
Task 2 (Action) ─── no deps, parallel with 1
Task 3 (Scaffold) ── no deps, parallel with 1 and 2
Task 4 (Realtime) ── depends on 3
Task 5 (Fix Session) ── depends on 3 and 4
Task 6 (Reconnection) ── depends on 4
Task 7 (Railway) ── depends on 3
```

Tasks 1, 2, and 3 can be done in parallel. Then 4, 6, and 7 in parallel. Then 5 last.
