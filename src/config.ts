function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

export const config = {
  supabaseUrl: required("SUPABASE_URL"),
  supabaseSecretKey: required("SUPABASE_SECRET_KEY"),
  anthropicApiKey: required("ANTHROPIC_API_KEY"),
  githubToken: required("GITHUB_TOKEN"),
  webhookSecret: required("CR_WEBHOOK_SECRET"),
  port: Number(process.env.PORT ?? "3000"),
  maxRounds: Number(process.env.MAX_ROUNDS ?? "3"),
  maxTurns: Number(process.env.MAX_TURNS ?? "30"),
  maxBudgetUsd: Number(process.env.MAX_BUDGET_USD ?? "5"),
  model: process.env.MODEL ?? "sonnet",
  allowedTools: (process.env.ALLOWED_TOOLS ?? "Read,Edit,Write,Bash,Glob,Grep").split(","),
};
