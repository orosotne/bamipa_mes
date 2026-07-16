// Cenová korekcia dokladu PO uzávierke (M7 — „dorieš" z corrections.ts):
// snapshoty pohybov uzavretého mesiaca sa NEPREPISUJÚ; cenový rozdiel sa
// zaúčtuje ako cost_corrections do aktuálneho otvoreného mesiaca (stredisko:
// dávkové pohyby → valcovňa, inventúrne → stredisko pohybu). Otvorené pohyby
// a cena šarže sa prepisujú ako doteraz. TDD PRED implementáciou.
//
// Ručný prepočet: lot 45,3500 → 50,0000 c/kg (Δ = +4,65 c/kg).
//   Uzavreté júnové výdaje: D1 50 kg + D2 30 kg → (50+30) × 4,65 = 372,0
//   → +372 c valcovni. Inventúrna korekcia −2 kg (jún, lisovňa):
//   2 × 4,65 = 9,3 → +9 c lisovni (zaokrúhlenie RAZ per stredisko).
import { and, eq, isNull, sql } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import * as schema from "@/db/schema";
import { cenovaKorekcia } from "@/server/inventory/corrections";
import {
  seedLisovnaZaklad,
  type LisovnaZaklad,
  type Zaklad,
} from "@/server/press/fixtures";
import { createTestDb, seedZaklad, type TestDb } from "@/test/pglite";
import { uzavriMesiac } from "./close";
import {
  pripravDavkuSNakladmi,
  seedKalkulacieZaklad,
  seedRezijneFakturyJun,
  seedVyrobaJun,
  type KalkZaklad,
  type VyrobaJun,
} from "./fixtures";

const DNES = "2026-07-16";

let db: TestDb;
let z: Zaklad;
let lz: LisovnaZaklad;
let kz: KalkZaklad;
let vyroba: VyrobaJun;
let d5: typeof schema.productionBatches.$inferSelect;

beforeEach(async () => {
  ({ db } = await createTestDb());
  z = await seedZaklad(db);
  lz = await seedLisovnaZaklad(db, z);
  kz = await seedKalkulacieZaklad(db, z);
  await seedRezijneFakturyJun(db, z, lz, kz);
  vyroba = await seedVyrobaJun(db, z, lz);
  // Inventúrna korekcia v júni na strednisku lisovňa (antedatovaný doklad
  // knihy — priamy INSERT, služba dátum antedatovať nevie).
  await db.insert(schema.stockMoves).values({
    lotId: vyroba.lot.id,
    moveType: "korekcia",
    qtyDelta: "-2.000",
    costCenterId: lz.lisovna.id,
    unitPrice: "45.3500",
    createdAt: new Date("2026-06-15T10:00:00Z"),
    createdBy: z.adminId,
  });
  // TZ hranica (review nález): 30. 6. 22:30 UTC = 1. 7. 00:30 Europe/
  // Bratislava — pohyb patrí do JÚLA (otvorený), snapshot sa má prepísať.
  await db.insert(schema.stockMoves).values({
    lotId: vyroba.lot.id,
    moveType: "korekcia",
    qtyDelta: "-1.000",
    costCenterId: lz.lisovna.id,
    unitPrice: "45.3500",
    createdAt: new Date("2026-06-30T22:30:00Z"),
    createdBy: z.adminId,
  });
  // Júlová dávka čerpá z TOHO ISTÉHO lotu — otvorený mesiac.
  d5 = await pripravDavkuSNakladmi(db, z, lz, {
    cislo: "V-2026-0201",
    productionDate: "2026-07-05",
    vydajKg: "10.000",
    pracaHodiny: "1.00",
    pracaSadzbaCents: 1000,
    outputKg: "20.000",
  });
  await uzavriMesiac(db, {
    period: "2026-06-01",
    userId: z.adminId,
    dnes: DNES,
  });
});

async function snapshotyPodlaMesiaca() {
  const pohyby = await db
    .select({
      id: schema.stockMoves.id,
      unitPrice: schema.stockMoves.unitPrice,
      qtyDelta: schema.stockMoves.qtyDelta,
      batchId: schema.stockMoves.batchId,
      moveType: schema.stockMoves.moveType,
    })
    .from(schema.stockMoves)
    .where(eq(schema.stockMoves.lotId, vyroba.lot.id));
  return pohyby;
}

async function materialCents(batchId: string): Promise<number> {
  const res = await db.execute(
    sql`SELECT material_cents FROM v_batch_costs WHERE batch_id = ${batchId}`,
  );
  const rows = (Array.isArray(res) ? res : res.rows) as {
    material_cents: string | number;
  }[];
  return Number(rows[0].material_cents);
}

describe("cenovaKorekcia po uzávierke", () => {
  test("uzavreté snapshoty nedotknuté, rozdiel v cost_corrections per stredisko, otvorené prepísané", async () => {
    await cenovaKorekcia(db, {
      userId: z.adminId,
      lotId: vyroba.lot.id,
      novaCena: "50.0000",
      note: "Dobropis dodávateľa",
      dnes: DNES,
    });

    // Cena šarže: vždy nová (budúce výdaje čerpajú za opravenú cenu).
    const [lot] = await db
      .select()
      .from(schema.materialLots)
      .where(eq(schema.materialLots.id, vyroba.lot.id));
    expect(lot.unitPrice).toBe("50.0000");

    // Júnové výdaje D1/D2 a júnová inventúrna korekcia: snapshot ostáva;
    // júlový výdaj D5 a príjmový pohyb (vznikol dnes): prepísané.
    const pohyby = await snapshotyPodlaMesiaca();
    const junoveVydaje = pohyby.filter(
      (p) =>
        p.moveType === "vydaj" &&
        (p.batchId === vyroba.d1.id || p.batchId === vyroba.d2.id),
    );
    expect(junoveVydaje).toHaveLength(2);
    for (const p of junoveVydaje) {
      expect(p.unitPrice).toBe("45.3500");
    }
    const invKorekciaJun = pohyby.find(
      (p) => p.moveType === "korekcia" && p.qtyDelta === "-2.000",
    );
    expect(invKorekciaJun?.unitPrice).toBe("45.3500");
    // Pohyb z 1. 7. 00:30 Bratislava (30. 6. UTC) patrí júlu → prepísaný.
    const invKorekciaJul = pohyby.find(
      (p) => p.moveType === "korekcia" && p.qtyDelta === "-1.000",
    );
    expect(invKorekciaJul?.unitPrice).toBe("50.0000");
    const julovyVydaj = pohyby.find(
      (p) => p.moveType === "vydaj" && p.batchId === d5.id,
    );
    expect(julovyVydaj?.unitPrice).toBe("50.0000");
    const prijem = pohyby.find((p) => p.moveType === "prijem");
    expect(prijem?.unitPrice).toBe("50.0000");

    // Náklady dávok: uzavretý jún nezmenený, otvorený júl na novej cene.
    expect(await materialCents(vyroba.d1.id)).toBe(2268); // 50 × 45,35
    expect(await materialCents(d5.id)).toBe(500); // 10 × 50,00

    // Korekčné položky: valcovňa +372 (dávkové výdaje), lisovňa +9
    // (inventúrna korekcia), obe v aktuálnom mesiaci 7/2026.
    const korekcie = await db
      .select()
      .from(schema.costCorrections)
      .where(eq(schema.costCorrections.lotId, vyroba.lot.id));
    expect(korekcie).toHaveLength(2);
    const valc = korekcie.find((k) => k.costCenterId === z.stredisko.id);
    const lis = korekcie.find((k) => k.costCenterId === lz.lisovna.id);
    expect(valc).toMatchObject({ amountCents: 372, periodDate: "2026-07-01" });
    expect(lis).toMatchObject({ amountCents: 9, periodDate: "2026-07-01" });

    // Audit stopa nesie starú/novú cenu aj rozpis korekčných položiek.
    const [zaznam] = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "price_correction"));
    expect(zaznam.changes).toMatchObject({
      unit_price: { old: "45.3500", new: "50.0000" },
    });
  });

  test("zníženie ceny → záporná korekčná položka (dobropisový efekt)", async () => {
    await cenovaKorekcia(db, {
      userId: z.adminId,
      lotId: vyroba.lot.id,
      novaCena: "40.0000",
      dnes: DNES,
    });
    // (50+30) × (40 − 45,35) = 80 × −5,35 = −428,0 → −428 c valcovni;
    // inventúrna: 2 × −5,35 = −10,7 → −11 c lisovni (away from zero).
    const korekcie = await db
      .select()
      .from(schema.costCorrections)
      .where(eq(schema.costCorrections.lotId, vyroba.lot.id));
    const valc = korekcie.find((k) => k.costCenterId === z.stredisko.id);
    const lis = korekcie.find((k) => k.costCenterId === lz.lisovna.id);
    expect(valc?.amountCents).toBe(-428);
    expect(lis?.amountCents).toBe(-11);
  });

  test("korekčná položka vstúpi do poolu nasledujúcej uzávierky", async () => {
    await cenovaKorekcia(db, {
      userId: z.adminId,
      lotId: vyroba.lot.id,
      novaCena: "50.0000",
      dnes: DNES,
    });
    const jul = await uzavriMesiac(db, {
      period: "2026-07-01",
      userId: z.adminId,
      dnes: "2026-08-02",
    });
    // Júl: valcovňa pool = 372 (len korekcia), základ 20 kg (D5) →
    // 372 / 20 = 18,6 c/kg.
    const valc = jul.riadky.find((r) => r.code === "valcovna");
    expect(valc).toMatchObject({
      poolCents: 372,
      basis: "20.000",
      rate: "18.600000",
    });
  });

  test("lot bez pohybov v uzavretých mesiacoch: čistý prepis bez korekčných položiek", async () => {
    const { pociatocnyStav } = await import("@/server/inventory/receipts");
    const prijem = await pociatocnyStav(db, {
      userId: z.adminId,
      receiptNumber: "P-JUL-1",
      receivedAt: "2026-07-10",
      polozky: [
        { materialId: z.material.id, qty: "100.000", unitPrice: "10.0000" },
      ],
    });

    await cenovaKorekcia(db, {
      userId: z.adminId,
      lotId: prijem.loty[0].id,
      novaCena: "12.0000",
      dnes: DNES,
    });

    const korekcie = await db
      .select()
      .from(schema.costCorrections)
      .where(eq(schema.costCorrections.lotId, prijem.loty[0].id));
    expect(korekcie).toHaveLength(0);
    const [lot] = await db
      .select()
      .from(schema.materialLots)
      .where(
        and(
          eq(schema.materialLots.id, prijem.loty[0].id),
          isNull(schema.materialLots.deletedAt),
        ),
      );
    expect(lot.unitPrice).toBe("12.0000");
  });
});
