"use client";

// Supabase browser klient (@supabase/ssr) — singleton (createBrowserClient si
// interne drží jednu inštanciu). Používa sa v client komponentoch (login,
// odhlásenie). Kľúč = PUBLISHABLE (verejný, určený do prehliadača).
import { createBrowserClient } from "@supabase/ssr";

export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
