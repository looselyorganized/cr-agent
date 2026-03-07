# cr-agent

Autonomous CodeRabbit review fixer powered by Claude Agent SDK.

Railway service that ingests CodeRabbit review comments, runs Claude Agent SDK to fix them autonomously, and provides visibility into when Claude is working vs. when it needs human help.

## How it works

1. **GitHub Action** fires on `pull_request_review` events from CodeRabbit
2. **Supabase** stores fix requests and round tracking
3. **Railway agent** picks up pending requests, clones the repo, runs Claude Agent SDK to resolve comments, and pushes fixes
4. If CodeRabbit re-reviews with new comments, the cycle repeats (up to `MAX_ROUNDS`)

## Stack

- [Bun](https://bun.sh) runtime
- [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) for autonomous code fixes
- [Supabase](https://supabase.com) for state management and Realtime subscriptions
- [Railway](https://railway.com) for hosting
- GitHub Actions for triggering

## Setup

```bash
bun install
```

### Environment variables

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SECRET_KEY` | Supabase service role key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `GITHUB_TOKEN` | GitHub PAT with repo access |
| `MAX_ROUNDS` | Max fix rounds per PR (default: 3) |
| `MAX_TURNS` | Max agent turns per round (default: 30) |
| `MAX_BUDGET_USD` | Max spend per agent run (default: 5) |
| `MODEL` | Claude model to use (default: sonnet) |
| `ALLOWED_TOOLS` | Comma-separated agent tools (default: Read,Edit,Write,Bash,Glob,Grep) |

## Running

```bash
bun run src/index.ts
```

## License

Private — [Loosely Organized](https://github.com/looselyorganized)
