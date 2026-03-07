import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _browserClient: SupabaseClient | null = null;
let _serverClient: SupabaseClient | null = null;

export function getSupabaseBrowser(): SupabaseClient | null {
  if (_browserClient) return _browserClient;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  _browserClient = createClient(url, key);
  return _browserClient;
}

export function getSupabaseServer(): SupabaseClient | null {
  if (_serverClient) return _serverClient;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  _serverClient = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return _serverClient;
}

export const supabaseBrowser = { get: getSupabaseBrowser };
export const supabaseServer = { get: getSupabaseServer };
