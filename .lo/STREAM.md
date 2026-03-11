---
type: stream
---

<entry>
date: 2026-03-10
title: "CodeRabbit review coverage failure and local loop architecture"
<description>
Discovered that GitHub's comment re-parenting causes CodeRabbit to silently skip reviews after multiple fix rounds — unreviewed code lands in main. Documented the full RCA on lo-plugin PR #6 and designed v0.2.0: move the review-fix loop off GitHub entirely using CodeRabbit CLI locally. One push, one commit, no comment re-parenting.
</description>
</entry>

<entry>
date: 2026-03-07
title: "Webhook trigger refactor"
<description>
Replaced Supabase Realtime subscription with Hono HTTP server on Bun. GH Action now POSTs PR metadata to cr-agent's `/webhook` endpoint instead of writing to Supabase directly. Simplifies repo onboarding to 2 secrets (CR_AGENT_URL + CR_WEBHOOK_SECRET), removes Realtime reconnection logic. EARS updated with 5 new requirements (REQ-A18–A22) covering auth, validation, health checks, upsert logic, and async response.
</description>
</entry>

<entry>
date: 2026-03-07
title: "v1 implementation: autonomous CR fix loop"
<description>
Full v1 shipped in a single session. Supabase schema with state machine constraints, GitHub Action trigger that detects CodeRabbit reviews and writes fix requests, Bun service subscribing via Realtime that clones repos, extracts CR's pre-built AI prompt, and runs Claude Agent SDK to fix and push. Multi-round lifecycle loops until clean or stuck (max 3 rounds). PR #1 open with auto-merge.
</description>
</entry>

<entry>
date: 2026-03-07
title: "First e2e test: agent fixes a PR"
<description>
Deployed to Railway and ran the full pipeline end-to-end on a test PR in the cr-agent repo itself. Fixed three container issues: missing git binary, Agent SDK stderr API expecting a callback not a string, and Claude Code refusing --dangerously-skip-permissions as root. After those fixes, the agent autonomously cloned a PR branch, read CodeRabbit's review comments, fixed the code issues, and pushed — commit `23cf65c` landed on PR #4 without human intervention.
</description>
</entry>

<entry>
date: 2026-03-04
title: "Project initialized"
<description>
LO project structure created. Project tracking begins.
</description>
</entry>
