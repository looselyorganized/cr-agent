import { query } from "@anthropic-ai/claude-agent-sdk";
import { config } from "./config";
import { log } from "./log";
import { existsSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

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

  // Pre-flight diagnostics
  const sdkDir = join(fileURLToPath(import.meta.url), "../../node_modules/@anthropic-ai/claude-agent-sdk");
  const cliPath = join(sdkDir, "cli.js");
  console.log(JSON.stringify({
    event: "agent_preflight",
    cwd,
    cwdExists: existsSync(cwd),
    cliJsExists: existsSync(cliPath),
    sdkDir,
    hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
    keyPrefix: process.env.ANTHROPIC_API_KEY?.slice(0, 10),
    model: config.model,
    homeDir: process.env.HOME,
    user: process.env.USER,
  }));

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
        debug: true,
        stderr: (data: string) => {
          const line = data.trim();
          if (line) {
            stderrLines.push(line);
            console.error(`[agent-stderr] ${line}`);
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
      console.log(JSON.stringify({ event: "agent_message", type: message.type }));
      if (message.type === "error") {
        console.error(JSON.stringify({ event: "agent_error_message", message }));
      }
    }
    return { success: true };
  } catch (err) {
    const errorMsg = String(err);
    const stderr = stderrLines.slice(-20).join("\n"); // Last 20 lines
    const detail = stderr
      ? `${errorMsg}\n--- stderr (last 20 lines) ---\n${stderr}`
      : errorMsg;
    console.error(JSON.stringify({ event: "agent_caught_error", error: errorMsg, stderrLineCount: stderrLines.length, lastStderr: stderrLines.slice(-5) }));
    return { success: false, error: detail };
  }
}
