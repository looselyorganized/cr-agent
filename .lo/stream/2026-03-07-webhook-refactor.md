---
type: "milestone"
date: "2026-03-07"
title: "Webhook trigger refactor"
feature_id: "t004"
commits: 5
---

Replaced Supabase Realtime subscription with Hono HTTP server on Bun. GH Action now POSTs PR metadata to cr-agent's `/webhook` endpoint instead of writing to Supabase directly. Simplifies repo onboarding to 2 secrets (CR_AGENT_URL + CR_WEBHOOK_SECRET), removes Realtime reconnection logic. EARS updated with 5 new requirements (REQ-A18–A22) covering auth, validation, health checks, upsert logic, and async response.
