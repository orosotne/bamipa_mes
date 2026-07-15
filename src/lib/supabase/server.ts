// Supabase server klient (@supabase/ssr) — číta/píše session cookies cez
// next/headers. Používa sa v Server Components, server actions a Proxy.
// Kľúč = PUBLISHABLE (bezpečný pre klienta); rola pre autorizáciu sa berie
// VÝHRADNE z DB users.role, NIE z JWT/user_metadata.
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          // V Server Component je cookie store read-only → set hodí a ignoruje
          // sa; refresh session rieši Proxy (má mutovateľnú response).
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Component render — ignorovať.
          }
        },
      },
    },
  );
}
