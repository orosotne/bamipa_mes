// Refresh Supabase session v Proxy (Next.js 16). Vzor @supabase/ssr:
// medzi createServerClient a getClaims() NEsmie byť žiadny kód a musí sa vrátiť
// tá istá response, do ktorej setAll zapísal obnovené cookies — inak sa session
// nespoľahlivo obnovuje. Táto vrstva rieši autentifikáciu (login gate) a do
// request hlavičiek pridá `x-pathname`, aby (app) layout mohol vynútiť RBAC
// per routa (server layout inak pathname nepozná).
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

function hlavickySPathname(request: NextRequest): Headers {
  const h = new Headers(request.headers);
  h.set("x-pathname", request.nextUrl.pathname);
  return h;
}

export async function updateSession(
  request: NextRequest,
): Promise<NextResponse> {
  let response = NextResponse.next({
    request: { headers: hlavickySPathname(request) },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({
            request: { headers: hlavickySPathname(request) },
          });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getClaims() validuje JWT podpis (bezpečné v server kóde, na rozdiel od
  // getSession). Nesmie byť oddelené od createServerClient iným kódom.
  const { data } = await supabase.auth.getClaims();
  const prihlaseny = Boolean(data?.claims?.sub);

  const { pathname } = request.nextUrl;
  const jeLogin = pathname === "/login";

  // Redirect musí niesť práve obnovené session cookies zo `response` — inak sa
  // pri prechode stratia (Supabase vzor: vracať tú istú response).
  const presmeruj = (cesta: string): NextResponse => {
    const url = request.nextUrl.clone();
    url.pathname = cesta;
    const r = NextResponse.redirect(url);
    for (const cookie of response.cookies.getAll()) {
      r.cookies.set(cookie);
    }
    return r;
  };

  if (!prihlaseny && !jeLogin) return presmeruj("/login");
  if (prihlaseny && jeLogin) return presmeruj("/");

  return response;
}
