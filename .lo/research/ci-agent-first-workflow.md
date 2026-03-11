---
title: "CI in an Agent-First Workflow"
date: "2026-03-10"
topics:
  - ci
  - agent-workflows
  - engineering-rigor
---

We shipped v0.5.0 of the LO plugin with stage-aware engineering rigor — Explore gets zero gates, Build adds tests and review, Open adds dependency auditing. The implementation worked. Then we audited the full CI system across all ten repos and found something obvious: we were running the same checks twice.

The local `/lo:ship` pipeline runs tests before committing. CI runs the same tests on the PR. The local pipeline runs `npm audit` for Open projects. CI runs the same `npm audit` on the PR. Every check that passed locally would pass again in CI minutes later, burning compute for no new information.

This isn't a problem in a traditional team. Humans forget to run tests. Humans push without checking. Multiple developers' changes can conflict. CI exists because you can't trust the local environment. But in an agent-driven workflow where every push goes through a gated pipeline, the trust model is different. The agent always runs the pipeline. The agent doesn't skip steps.

So we asked: if you're running an all-agent workforce, what's CI actually for?

The answer splits into three layers:

**Local pipeline** owns fast feedback and LLM-powered analysis. Tests run here for speed — you find out about failures before pushing, not after waiting for a CI cycle. Security sweeps, code review, and EARS requirements audits are LLM-powered gates that can only run locally. This is where the intelligence lives.

**CI** owns clean-environment verification and merge authority. A fresh `bun install` in CI catches dependency drift that local might miss. Lint catches formatting. Build proves the artifact compiles outside your machine. CI is the tamper-proof backstop — it can't be bypassed, even accidentally. But it should only run checks that benefit from a clean environment.

**Scheduled jobs** own drift detection. Dependency vulnerabilities appear based on when you check, not what code you changed. A new CVE published on Tuesday affects your Monday deploy whether or not you shipped anything. A weekly audit cron catches this. Per-PR audit doesn't — it only runs when code changes.

The concrete changes: we removed the `Security Audit` job from the reusable CI workflow and the `has-audit` input that triggered it. The sync script no longer generates `has-audit: true` in per-repo CI configs. Instead, Open-status projects get a standalone `audit.yml` with a weekly Monday cron and manual dispatch. The local ship pipeline keeps `npm audit` in Gate 3 for pre-push feedback.

Tests stay in both layers. That's the one intentional duplication — tests are the only mechanical check that catches real regressions, and CI's clean environment adds genuine value over local. Everything else got split cleanly.

The pattern generalizes. When your developer is an agent that follows a defined pipeline, CI stops being the quality gate and becomes the environment gate. The quality decisions — is this code secure? does it meet requirements? is it well-structured? — happen locally where you have LLM capabilities. CI verifies that the artifact works outside the developer's machine. Scheduled jobs catch the world changing around you.
