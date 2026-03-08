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
  const stderrLines: string[] = [];
  let lastResult: { is_error?: boolean; result?: string } | null = null;

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
        stderr: (data: string) => {
          const line = data.trim();
          if (line) stderrLines.push(line);
        },
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append:
            "You are fixing CodeRabbit review comments. Make minimal, focused changes. Do not refactor surrounding code.",
        },
      },
    })) {
      if (message.type === "result") {
        lastResult = message as any;
      }
    }

    // The iterator completed without throwing, but the result may indicate
    // an application-level error (e.g. credit balance, rate limit).
    if (lastResult?.is_error) {
      return { success: false, error: lastResult.result ?? "Unknown agent error" };
    }
    return { success: true };
  } catch (err) {
    // If we got a result message before the process crashed, prefer that —
    // it's more informative than "process exited with code 1".
    if (lastResult?.is_error && lastResult.result) {
      return { success: false, error: lastResult.result };
    }

    const errorMsg = String(err);
    const stderr = stderrLines.slice(-20).join("\n");
    const detail = stderr
      ? `${errorMsg}\n--- stderr (last 20 lines) ---\n${stderr}`
      : errorMsg;
    return { success: false, error: detail };
  }
}
