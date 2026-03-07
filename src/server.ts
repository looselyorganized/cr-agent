import { Hono } from "hono";
import { config } from "./config";
import { supabase, type FixRequest } from "./supabase";
import { handleFixRequest } from "./fix-session";
import { log } from "./log";

const app = new Hono();

// REQ-A20: Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// REQ-A18: Auth middleware for webhook
app.post("/webhook", async (c) => {
  const auth = c.req.header("Authorization");
  if (!auth || auth !== `Bearer ${config.webhookSecret}`) {
    return c.json({ error: "unauthorized" }, 401);
  }

  // REQ-A19: Validate payload
  const body = await c.req.json().catch(() => null);
  if (!body) {
    return c.json({ error: "invalid json" }, 400);
  }

  const { repo, pr_number, pr_url, branch, base_branch, actor } = body;
  const missing = [];
  if (!repo) missing.push("repo");
  if (!pr_number) missing.push("pr_number");
  if (!pr_url) missing.push("pr_url");
  if (!branch) missing.push("branch");
  if (!base_branch) missing.push("base_branch");
  if (!actor) missing.push("actor");

  if (missing.length > 0) {
    return c.json({ error: `missing fields: ${missing.join(", ")}` }, 400);
  }

  // REQ-A21: Upsert logic
  const { data: existing, error: queryErr } = await supabase
    .from("cr_fix_requests")
    .select("id, status")
    .eq("repo", repo)
    .eq("pr_number", pr_number);

  if (queryErr) {
    log("error", "webhook_query_failed", { repo, pr: pr_number, error: queryErr.message });
    return c.json({ error: "query failed" }, 500);
  }

  const row = existing?.[0];
  if (row) {
    // No-op if pending or fixing
    if (row.status === "pending" || row.status === "fixing") {
      log("info", "webhook_noop", { repo, pr: pr_number, status: row.status });
      return c.json({ action: "noop", status: row.status });
    }

    // Patch to pending if waiting_review or terminal status (clean/stuck/failed/cancelled)
    const { error: patchErr } = await supabase
      .from("cr_fix_requests")
      .update({
        status: "pending",
        triggered_by: actor,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    if (patchErr) {
      log("error", "webhook_patch_failed", { repo, pr: pr_number, error: patchErr.message });
      return c.json({ error: "patch failed" }, 500);
    }

    log("info", "webhook_patched", { repo, pr: pr_number, from: row.status });

    // Fetch full row for fix session
    const { data: fullRow } = await supabase
      .from("cr_fix_requests")
      .select("*")
      .eq("id", row.id)
      .single();

    if (fullRow) {
      handleFixRequest(fullRow as FixRequest);
    }

    return c.json({ action: "patched", id: row.id });
  }

  // Insert new row (no existing row for this repo+pr_number)
  const { data: inserted, error: insertErr } = await supabase
    .from("cr_fix_requests")
    .insert({
      repo,
      pr_number,
      pr_url,
      branch,
      base_branch,
      triggered_by: actor,
      status: "pending",
    })
    .select("*")
    .single();

  if (insertErr) {
    log("error", "webhook_insert_failed", { repo, pr: pr_number, error: insertErr.message });
    return c.json({ error: "insert failed" }, 500);
  }

  log("info", "webhook_inserted", { repo, pr: pr_number, id: inserted.id });

  // REQ-A22: Fire-and-forget fix session
  handleFixRequest(inserted as FixRequest);

  return c.json({ action: "created", id: inserted.id });
});

export { app };
