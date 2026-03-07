import { query } from "@anthropic-ai/claude-agent-sdk";
import { config } from "./config";

export interface AgentResult {
  success: boolean;
  error?: string;
}

export async function runAgent(
  prompt: string,
  cwd: string
): Promise<AgentResult> {
  try {
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
        stderr: (data: string) => console.error(`[agent:stderr] ${data.trim()}`),
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append:
            "You are fixing CodeRabbit review comments. Make minimal, focused changes. Do not refactor surrounding code.",
        },
      },
    })) {
      if (message.type === "error") {
        console.error(`[agent] error message: ${JSON.stringify(message)}`);
      }
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}
