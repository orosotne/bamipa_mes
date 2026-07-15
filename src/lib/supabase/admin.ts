import "server-only";

// Supabase admin klient (secret key) — LEN na serveri, pre admin operácie
// (createUser). Secret key OBCHÁDZA RLS a NIKDY nesmie ísť do klienta ani do
// NEXT_PUBLIC_. Číta sa zo SUPABASE_SECRET_KEY (mimo NEXT_PUBLIC_).
import { createClient } from "@supabase/supabase-js";

export function createSupabaseAdminClient() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "SUPABASE_SECRET_KEY nie je nastavená — vytvorenie používateľa nie je možné. Doplň secret key do .env.local.",
    );
  }
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
