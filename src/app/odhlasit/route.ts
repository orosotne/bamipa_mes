// Server-side odhlásenie — invaliduje Supabase session (vyčistí cookies) a
// presmeruje na /login. Používa sa keď je JWT ešte platný, ale používateľ už
// nemá aktívny účet (deaktivovaný / soft-deleted / osirelý auth účet bez users
// riadku) — inak by vznikol nekonečný redirect loop medzi Proxy a (app) layoutom.
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url));
}
