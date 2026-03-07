import { createClient } from "@supabase/supabase-js";
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
