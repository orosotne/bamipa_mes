// CSV exporty dashboardu pre účtovníčku (SPEC M8: „všetky tabuľky
// exportovateľné do CSV/XLSX" — CSV s BOM + bodkočiarkou pre Excel sk-SK).
// Server-side generovanie; RBAC guard priamo tu (route handlery nechráni
// per-modul layout) — citlivé čísla len ekonóm + admin.
import { NextResponse } from "next/server";
import { db } from "@/db";
import { marzeArtiklov } from "@/server/calc/margins";
import { cenaCsv, ciarka, csvSubor, eurCsv, eurCsv2 } from "@/server/dashboard/csv";
import {
  nakladNaKgMesacne,
  nakladNaParMesacne,
  nepodarky,
  plusDni,
  prestoje,
  topMaterialy,
} from "@/server/dashboard/queries";
import { zoznamFaktur } from "@/server/invoices/service";
import { overRolu } from "@/server/rbac";
import { dnesnyDatum, getCurrentUser } from "@/server/session";

export const dynamic = "force-dynamic";

const ANO_NIE = (v: boolean) => (v ? "áno" : "nie");

async function zostavCsv(report: string, dnes: string, dni: number): Promise<string | null> {
  switch (report) {
    case "cashflow": {
      const faktury = (await zoznamFaktur(db, { dnes })).filter(
        (f) => f.zostatokCents > 0,
      );
      return csvSubor(
        ["Číslo", "Dodávateľ", "Splatnosť", "Suma s DPH (€)", "Zostatok (€)", "Stav", "Po splatnosti"],
        faktury.map((f) => [
          f.invoiceNumber,
          f.supplierName,
          f.dueDate,
          eurCsv(f.totalGrossCents),
          eurCsv(f.zostatokCents),
          f.status,
          ANO_NIE(f.dueDate < dnes),
        ]),
      );
    }
    case "marze": {
      const marze = await marzeArtiklov(db);
      return csvSubor(
        ["Artikel", "Názov", "Predajná cena (€)", "Náklad na pár (€)", "Marža (€)", "Marža (%)", "Dobré páry", "Teoretická zmes (€)", "Skutočná zmes (€)", "Norma kg/pár", "Skutočná kg/pár"],
        marze.map((m) => [
          m.code,
          m.name,
          m.salePriceCents === null ? "" : eurCsv(m.salePriceCents),
          eurCsv2(m.costPerPairCents),
          eurCsv2(m.marginCents),
          m.marginPct === null ? "" : ciarka(m.marginPct),
          m.dobreParov,
          m.teoretickaZmesCents === null ? "" : eurCsv(m.teoretickaZmesCents),
          eurCsv2(m.skutocnaZmesCents),
          ciarka(m.normaKgNaPar),
          m.skutocnaKgNaPar === null ? "" : ciarka(m.skutocnaKgNaPar),
        ]),
      );
    }
    case "naklady-kg": {
      const riadky = await nakladNaKgMesacne(db);
      return csvSubor(
        ["Mesiac", "Zmes", "Názov", "Vyrobené kg", "Priamy náklad (€/kg)", "Plný náklad (€/kg)", "Mesiac uzavretý"],
        riadky.map((r) => [
          r.period.slice(0, 7),
          r.mixtureCode,
          r.mixtureName,
          ciarka(r.kg),
          eurCsv2(r.directPerKg),
          eurCsv2(r.fullPerKg),
          ANO_NIE(r.uzavrety),
        ]),
      );
    }
    case "naklady-par": {
      const riadky = await nakladNaParMesacne(db);
      return csvSubor(
        ["Mesiac", "Artikel", "Názov", "Dobré páry", "Náklad na pár (€)", "Kompletná kalkulácia"],
        riadky.map((r) => [
          r.period.slice(0, 7),
          r.soleModelCode,
          r.soleModelName,
          r.pary,
          eurCsv2(r.costPerPair),
          ANO_NIE(r.kompletne),
        ]),
      );
    }
    case "prestoje": {
      const riadky = await prestoje(db, { od: plusDni(dnes, -(dni - 1)), do: dnes });
      return csvSubor(
        ["Dôvod", "Stroj", "Prevádzka", "Minúty"],
        riadky.map((r) => [r.reasonName, `${r.machineCode} — ${r.machineName}`, r.prevadzka, r.minutes]),
      );
    }
    case "nepodarky": {
      const riadky = await nepodarky(db, { od: plusDni(dnes, -(dni - 1)), do: dnes });
      return csvSubor(
        ["Dôvod", "Stroj", "Páry"],
        riadky.map((r) => [r.reasonName, `${r.machineCode} — ${r.machineName}`, r.qtyPairs]),
      );
    }
    case "materialy": {
      const materialy = await topMaterialy(db, { od: plusDni(dnes, -364), do: dnes });
      return csvSubor(
        ["Kód", "Názov", "MJ", "Nákupy 12 mes. (€)", "Posledná cena (€/MJ)", "Predošlá cena (€/MJ)", "Zmena (%)"],
        materialy.map((m) => [
          m.code,
          m.name,
          m.unit,
          eurCsv(m.hodnotaCents),
          cenaCsv(m.poslednaCena),
          m.predoslaCena === null ? "" : cenaCsv(m.predoslaCena),
          m.zmenaPct === null ? "" : ciarka(m.zmenaPct),
        ]),
      );
    }
    default:
      return null;
  }
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ report: string }> },
) {
  // getCurrentUser NECHÁVAME mimo try — jeho redirect(/login, /odhlasit)
  // hádže NEXT_REDIRECT a musí propagovať (holý catch by deaktivovanému
  // používateľovi vrátil 403 namiesto invalidácie session cez /odhlasit).
  const user = await getCurrentUser(db);
  try {
    overRolu(user.role, "ekonom");
  } catch {
    return new NextResponse("Nedostatočné oprávnenie.", { status: 403 });
  }

  const { report } = await ctx.params;
  const dniParam = new URL(request.url).searchParams.get("dni");
  const dni = dniParam === "1" ? 1 : dniParam === "30" ? 30 : 7;
  const dnes = dnesnyDatum();

  const csv = await zostavCsv(report, dnes, dni);
  if (csv === null) {
    return new NextResponse("Neznámy report.", { status: 404 });
  }

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="bamipa-${report}-${dnes}.csv"`,
    },
  });
}
