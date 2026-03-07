import { config } from "./config";
import { app } from "./server";

console.log("cr-agent starting...");
console.log(`port=${config.port} max_rounds=${config.maxRounds} model=${config.model}`);

export default {
  port: config.port,
  fetch: app.fetch,
};
