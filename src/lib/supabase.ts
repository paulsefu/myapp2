import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const config = window.__OBIECTIVE_CONFIG__ ?? {};
const url = config.supabaseUrl?.trim() ?? "";
const anonKey = config.supabaseAnonKey?.trim() ?? "";

export const isSupabaseConfigured =
  /^https:\/\/.+\.supabase\.co$/i.test(url) &&
  anonKey.length > 40 &&
  !anonKey.startsWith("PASTE_");

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error("Completează public/config.js cu datele proiectului Supabase.");
  }
  return supabase;
}
