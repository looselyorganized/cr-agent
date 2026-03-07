import { config } from "./config";
import { subscribeToPendingRequests } from "./supabase";

console.log("cr-agent starting...");
console.log(`max_rounds=${config.maxRounds} model=${config.model}`);

subscribeToPendingRequests((row) => {
  console.log(`[trigger] fix request for ${row.repo}#${row.pr_number}`);
  // handleFixRequest(row) — wired in Task 5
});
