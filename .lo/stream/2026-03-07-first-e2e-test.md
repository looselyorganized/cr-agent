---
type: "milestone"
date: "2026-03-07"
title: "First e2e test: agent fixes a PR"
commits: 6
---

Deployed to Railway and ran the full pipeline end-to-end on a test PR in the cr-agent repo itself. Fixed three container issues: missing git binary, Agent SDK stderr API expecting a callback not a string, and Claude Code refusing --dangerously-skip-permissions as root. After those fixes, the agent autonomously cloned a PR branch, read CodeRabbit's review comments, fixed the code issues, and pushed — commit `23cf65c` landed on PR #4 without human intervention.
