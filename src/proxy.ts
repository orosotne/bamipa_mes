// Next.js 16 Proxy (predtým middleware) — obnova Supabase session + login gate.
// Statické assety a Next interné cesty sa preskakujú PRIAMO vo funkcii (nie iba
// cez matcher) — inak by sa CSS/JS chunky presmerovali na /login a stránky by
// ostali bez štýlov. RBAC per rola sa vynucuje v (app) layoute a v actions.
import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy-session";

const STATICKE = /\.(css|js|map|json|svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|eot)$/;

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    STATICKE.test(pathname)
  ) {
    return NextResponse.next();
  }
  return updateSession(request);
}

export const proxyConfig = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
