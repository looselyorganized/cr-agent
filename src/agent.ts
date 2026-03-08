import { query } from "@anthropic-ai/claude-agent-sdk";
import { config } from "./config";
import { log } from "./log";

export interface AgentResult {
  success: boolean;
  error?: string;
}

export async function runAgent(
  prompt: string,
  cwd: string
): Promise<AgentResult> {
  // Capture stderr output for diagnostics — console.error goes to container
  // logs but doesn't surface in the error returned to fix-session.
  const stderrLines: string[] = [];

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
          if (line) {
            stderrLines.push(line);
            log("debug", "agent_stderr", { line });
          }
        },
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append:
            "You are fixing CodeRabbit review comments. Make minimal, focused changes. Do not refactor surrounding code.",
        },
      },
    })) {
      if (message.type === "error") {
        log("error", "agent_error_message", { message: JSON.stringify(message) });
      }
    }
    return { success: true };
  } catch (err) {
    const errorMsg = String(err);
    const stderr = stderrLines.slice(-20).join("\n"); // Last 20 lines
    const detail = stderr
      ? `${errorMsg}\n--- stderr (last 20 lines) ---\n${stderr}`
      : errorMsg;
    return { success: false, error: detail };
  }
}
