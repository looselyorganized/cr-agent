import { createClient, type RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { config } from "./config";

export const supabase = createClient(config.supabaseUrl, config.supabaseSecretKey);

export interface FixRequest {
  id: string;
  repo: string;
  pr_number: number;
  pr_url: string;
  branch: string;
  base_branch: string;
  status: string;
  current_round: number;
  max_rounds: number;
  triggered_by: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export function subscribeToPendingRequests(
  onPending: (row: FixRequest) => void
): void {
  let retryDelay = 1000;
  const maxDelay = 30000;

  function connect() {
    const channel = supabase
      .channel("cr-fix-requests")
      .on<FixRequest>(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "cr_fix_requests",
          filter: "status=eq.pending",
        },
        (payload: RealtimePostgresChangesPayload<FixRequest>) => {
          if (payload.new && "id" in payload.new) {
            onPending(payload.new as FixRequest);
          }
        }
      )
      .subscribe((status) => {
        console.log(`[realtime] status: ${status}`);
        if (status === "SUBSCRIBED") {
          retryDelay = 1000;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error(`[realtime] connection lost, reconnecting in ${retryDelay}ms`);
          setTimeout(() => {
            channel.unsubscribe();
            retryDelay = Math.min(retryDelay * 2, maxDelay);
            connect();
          }, retryDelay);
        }
      });
  }

  connect();
}
