import { supabase, type FixRequest } from "./supabase";
import { config } from "./config";
import { log } from "./log";
import { fetchCRPrompt, isPROpen } from "./github";
import { runAgent } from "./agent";

/** Concurrency guard: one session per PR (REQ-A10) */
const activeSessions = new Map<string, boolean>();

function sessionKey(repo: string, prNumber: number): string {
  return `${repo}#${prNumber}`;
}

export function handleFixRequest(row: FixRequest): void {
  const key = sessionKey(row.repo, row.pr_number);

  if (activeSessions.has(key)) {
    log("info", "session_already_active", {
      repo: row.repo,
      pr: row.pr_number,
    });
    return;
  }

  activeSessions.set(key, true);

  runFixSession(row)
    .catch((err) => {
      log("error", "session_unhandled_error", {
        repo: row.repo,
        pr: row.pr_number,
        error: String(err),
      });
    })
    .finally(() => {
      activeSessions.delete(key);
    });
}

async function updateRequest(
  id: string,
  data: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase
    .from("cr_fix_requests")
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`Failed to update request: ${error.message}`);
}

async function spawn(cmd: string[]): Promise<{ stdout: string; exitCode: number }> {
  const proc = Bun.spawn(cmd, {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { stdout: stdout.trim(), exitCode };
}

async function runFixSession(row: FixRequest): Promise<void> {
  const nextRound = row.current_round + 1;
  const ctx = { repo: row.repo, pr: row.pr_number, round: nextRound };

  // REQ-A09: Check max rounds
  if (nextRound > row.max_rounds) {
    log("info", "max_rounds_exceeded", ctx);
    await updateRequest(row.id, {
      status: "stuck",
      completed_at: new Date().toISOString(),
    });
    return;
  }

  // REQ-A03: Update to fixing status, increment round
  log("info", "round_start", ctx);
  await updateRequest(row.id, {
    status: "fixing",
    current_round: nextRound,
  });

  // Insert cr_fix_rounds row
  const roundStart = new Date().toISOString();
  const { data: roundRow, error: roundInsertErr } = await supabase
    .from("cr_fix_rounds")
    .insert({
      request_id: row.id,
      round_number: nextRound,
      status: "running",
      started_at: roundStart,
    })
    .select("id")
    .single();

  if (roundInsertErr) {
    throw new Error(
      `Failed to insert round: ${roundInsertErr.message}`
    );
  }

  const roundId = roundRow.id;
  const workdir = `/tmp/cr-agent/${row.repo}-pr${row.pr_number}`;

  try {
    // REQ-A14: Check if PR is still open
    const open = await isPROpen(row.repo, row.pr_number);
    if (!open) {
      log("info", "pr_closed", ctx);
      await supabase
        .from("cr_fix_rounds")
        .update({ status: "failed", error: "PR closed", finished_at: new Date().toISOString() })
        .eq("id", roundId);
      await updateRequest(row.id, {
        status: "cancelled",
        completed_at: new Date().toISOString(),
      });
      return;
    }

    // Fetch CR prompt
    const crPrompt = await fetchCRPrompt(row.repo, row.pr_number);
    if (!crPrompt) {
      log("info", "no_cr_comments", ctx);
      await supabase
        .from("cr_fix_rounds")
        .update({ status: "completed", finished_at: new Date().toISOString() })
        .eq("id", roundId);
      await updateRequest(row.id, {
        status: "clean",
        completed_at: new Date().toISOString(),
      });
      return;
    }

    // Clone the repo
    log("info", "cloning_repo", { ...ctx, branch: row.branch });
    await spawn(["rm", "-rf", workdir]);
    const cloneResult = await spawn([
      "git",
      "clone",
      "--depth",
      "1",
      "--branch",
      row.branch,
      `https://x-access-token:${config.githubToken}@github.com/${row.repo}.git`,
      workdir,
    ]);
    if (cloneResult.exitCode !== 0) {
      throw new Error(`git clone failed (exit ${cloneResult.exitCode}): ${cloneResult.stdout}`);
    }

    // Fetch base branch ref so Claude Code's git diff works on shallow clones
    await spawn(["git", "-C", workdir, "fetch", "origin", `${row.base_branch}:${row.base_branch}`]);

    // Build prompt
    const fullPrompt = [
      `You are working on PR #${row.pr_number} in ${row.repo} (round ${nextRound}/${row.max_rounds}).`,
      `Branch: ${row.branch} (base: ${row.base_branch})`,
      "",
      "CodeRabbit has left the following review comments that need to be addressed:",
      "",
      crPrompt,
      "",
      "After making changes, commit them with a clear message and push to the branch.",
      `Use: git push origin ${row.branch}`,
    ].join("\n");

    // Run the agent
    log("info", "agent_start", ctx);
    const agentStart = Date.now();
    const result = await runAgent(fullPrompt, workdir);
    const durationMs = Date.now() - agentStart;

    if (!result.success) {
      // REQ-A12: Agent failed
      log("error", "agent_failed", { ...ctx, error: result.error });
      await supabase
        .from("cr_fix_rounds")
        .update({
          status: "failed",
          error: result.error,
          duration_ms: durationMs,
          finished_at: new Date().toISOString(),
        })
        .eq("id", roundId);
      await updateRequest(row.id, { status: "failed" });
      return;
    }

    // Get HEAD sha
    const headResult = await spawn(["git", "-C", workdir, "rev-parse", "HEAD"]);
    const commitSha = headResult.exitCode === 0 ? headResult.stdout : null;

    // REQ-A06, REQ-A07: Success — update round and request
    log("info", "round_complete", { ...ctx, commit_sha: commitSha, duration_ms: durationMs });
    await supabase
      .from("cr_fix_rounds")
      .update({
        status: "completed",
        commit_sha: commitSha,
        duration_ms: durationMs,
        finished_at: new Date().toISOString(),
      })
      .eq("id", roundId);

    await updateRequest(row.id, { status: "waiting_review" });
  } finally {
    // Cleanup workdir
    await spawn(["rm", "-rf", workdir]).catch(() => {});
  }
}
