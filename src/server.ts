import { Hono } from "hono";
import { config } from "./config";
import { supabase, type FixRequest } from "./supabase";
import { handleFixRequest } from "./fix-session";
import { log } from "./log";

const app = new Hono();

// REQ-A20: Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// HMAC-SHA256 signature verification for GitHub webhooks
async function verifySignature(
  secret: string,
  payload: string,
  signature: string,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  const expected =
    "sha256=" +
    Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  // Constant-time comparison
  if (expected.length !== signature.length) return false;
  let result = 0;
  for (let i = 0; i < expected.length; i++) {
    result |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return result === 0;
}

// REQ-A18: GitHub org webhook — accepts native pull_request_review events
app.post("/webhook", async (c) => {
  // HMAC-SHA256 signature verification
  const signature = c.req.header("X-Hub-Signature-256");
  if (!signature) {
    return c.json({ error: "missing signature" }, 401);
  }

  const rawBody = await c.req.text();
  const valid = await verifySignature(
    config.webhookSecret,
    rawBody,
    signature,
  );
  if (!valid) {
    return c.json({ error: "invalid signature" }, 401);
  }

  const body = JSON.parse(rawBody);

  // Filter: only pull_request_review events with action "submitted"
  if (body.action !== "submitted") {
    return c.json({ action: "ignored", reason: "not a submitted review" });
  }

  // Filter: only reviews from coderabbitai[bot]
  const reviewAuthor = body.review?.user?.login;
  if (reviewAuthor !== "coderabbitai[bot]") {
    return c.json({
      action: "ignored",
      reason: `review by ${reviewAuthor}, not coderabbitai[bot]`,
    });
  }

  // Extract fields from GitHub's native payload
  const repo = body.repository?.full_name;
  const pr_number = body.pull_request?.number;
  const pr_url = body.pull_request?.html_url;
  const branch = body.pull_request?.head?.ref;
  const base_branch = body.pull_request?.base?.ref;
  const actor = reviewAuthor;

  const missing = [];
  if (!repo) missing.push("repo");
  if (!pr_number) missing.push("pr_number");
  if (!pr_url) missing.push("pr_url");
  if (!branch) missing.push("branch");
  if (!base_branch) missing.push("base_branch");

  if (missing.length > 0) {
    return c.json({ error: `missing fields: ${missing.join(", ")}` }, 400);
  }

  log("info", "webhook_received", { repo, pr: pr_number, reviewer: reviewAuthor });

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
