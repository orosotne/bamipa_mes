// F3: export došlých faktúr do MRP XML 2.0 (docs/mrp/). RBAC guard priamo
// tu (route handlery nechráni per-modul layout) — ekonóm + admin.
// POST, nie GET: export MUTUJE (označí faktúry ako exportované) — GET by
// mohli spustiť prefetch/link-skenery a SameSite=Lax neblokuje cross-site
// GET navigáciu (CSRF). Volá sa fetch-om z dialógu na /faktury.
import { NextResponse } from "next/server";
import { db } from "@/db";
import { exportujFakturyPreMrp } from "@/server/invoices/mrp-export";
import { overRolu } from "@/server/rbac";
import { getCurrentUser } from "@/server/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // getCurrentUser mimo try — NEXT_REDIRECT (/login, /odhlasit) musí propagovať.
  const user = await getCurrentUser(db);
  try {
    overRolu(user.role, "ekonom");
  } catch {
    return new NextResponse("Nedostatočné oprávnenie.", { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const mesiac = params.get("mesiac") ?? "";
  const ajExportovane = params.get("aj_exportovane") === "1";

  try {
    const vysledok = await exportujFakturyPreMrp(db, {
      mesiac,
      ajExportovane,
      userId: user.id,
      kedy: new Date(),
    });
    if (vysledok === null) {
      return new NextResponse(
        `Žiadne faktúry na export do MRP za mesiac ${mesiac}.`,
        { status: 404 },
      );
    }

    return new NextResponse(vysledok.xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="mrp-fakturyp-${mesiac}.xml"`,
      },
    });
  } catch (e) {
    return new NextResponse(
      e instanceof Error ? e.message : "Export do MRP zlyhal.",
      { status: 400 },
    );
  }
}
