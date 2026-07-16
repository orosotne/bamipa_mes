// Korekcie (M2/M4): storno chybnej navážky (kritický nález z návrhu),
// inventúrne manko/prebytok (per šarža aj per materiál vo FIFO — D1),
// cenová korekcia dokladu s audit stopou.
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import * as schema from "@/db/schema";
import {
  createTestDb,
  seedDavka,
  seedZaklad,
  type TestDb,
} from "@/test/pglite";
import {
  cenovaKorekcia,
  inventurnaKorekcia,
  inventurnaKorekciaMaterialu,
  stornoVydaja,
} from "./corrections";
import { NedostatokZasobyError } from "./fifo";
import { vydajNavazky } from "./issue";
import { pociatocnyStav } from "./receipts";

let db: TestDb;
let zaklad: Awaited<ReturnType<typeof seedZaklad>>;
let davka: Awaited<ReturnType<typeof seedDavka>>;
let lotId: string;

beforeEach(async () => {
  ({ db } = await createTestDb());
  zaklad = await seedZaklad(db);
  davka = await seedDavka(db, zaklad);
  const prijem = await pociatocnyStav(db, {
    userId: zaklad.adminId,
    receiptNumber: "P-001",
    receivedAt: "2026-07-01",
    polozky: [
      { materialId: zaklad.material.id, qty: "1000.000", unitPrice: "40.0000" },
    ],
  });
  lotId = prijem.loty[0].id;
});

async function zostatok(id = lotId): Promise<string> {
  const [lot] = await db
    .select({ qty: schema.materialLots.qtyRemaining })
    .from(schema.materialLots)
    .where(eq(schema.materialLots.id, id));
  return lot.qty;
}

async function materialCentsDavky(): Promise<number> {
  const view = await db.execute(
    sql`SELECT material_cents FROM v_batch_costs WHERE batch_id = ${davka.id}`,
  );
  return Number(view.rows[0].material_cents);
}

describe("stornoVydaja (oprava preklepu z tabletu)", () => {
  test("vráti zostatok šarže A ZNÍŽI náklad dávky (kritický nález z návrhu)", async () => {
    const vydaj = await vydajNavazky(db, {
      userId: zaklad.adminId,
      batchId: davka.id,
      materialId: zaklad.material.id,
      qty: "500.000", // preklep — malo byť 50
    });
    expect(await zostatok()).toBe("500.000");
    expect(await materialCentsDavky()).toBe(20_000); // 500 × 40,0000

    const storno = await stornoVydaja(db, {
      userId: zaklad.adminId,
      moveId: vydaj.pohyby[0].id,
      note: "Preklep: 500 namiesto 50",
    });

    // Protipohyb: korekcia, kladné delta, batch aj cena z pôvodného pohybu.
    expect(storno.pohyb.moveType).toBe("korekcia");
    expect(storno.pohyb.qtyDelta).toBe("500.000");
    expect(storno.pohyb.batchId).toBe(davka.id);
    expect(storno.pohyb.unitPrice).toBe("40.0000");
    expect(storno.pohyb.reversedMoveId).toBe(vydaj.pohyby[0].id);

    expect(await zostatok()).toBe("1000.000");
    expect(await materialCentsDavky()).toBe(0); // náklad dávky klesol na nulu
  });

  test("stornovať možno len vydaj pohyb", async () => {
    const [prijemPohyb] = await db
      .select()
      .from(schema.stockMoves)
      .where(eq(schema.stockMoves.moveType, "prijem"));

    await expect(
      stornoVydaja(db, { userId: zaklad.adminId, moveId: prijemPohyb.id }),
    ).rejects.toThrow(/vydaj/);
  });

  test("dvojité storno toho istého pohybu → chyba", async () => {
    const vydaj = await vydajNavazky(db, {
      userId: zaklad.adminId,
      batchId: davka.id,
      materialId: zaklad.material.id,
      qty: "100.000",
    });
    await stornoVydaja(db, { userId: zaklad.adminId, moveId: vydaj.pohyby[0].id });

    await expect(
      stornoVydaja(db, { userId: zaklad.adminId, moveId: vydaj.pohyby[0].id }),
    ).rejects.toThrow(/stornovaný/);
  });

  test("storno výdaja na dávke mimo rozpracovana → chyba (server-side zámok, nielen UI)", async () => {
    const { odovzdajNaLabak } = await import("@/server/batches/service");
    const vydaj = await vydajNavazky(db, {
      userId: zaklad.adminId,
      batchId: davka.id,
      materialId: zaklad.material.id,
      qty: "100.000",
    });
    await odovzdajNaLabak(db, {
      userId: zaklad.adminId,
      batchId: davka.id,
      outputKg: "95.000",
    });

    await expect(
      stornoVydaja(db, { userId: zaklad.adminId, moveId: vydaj.pohyby[0].id }),
    ).rejects.toThrow(/uzamknut/);
  });
});

describe("inventurnaKorekcia (manko/prebytok ako náklad strediska)", () => {
  test("manko zníži zostatok, pohyb nesie stredisko", async () => {
    const vysledok = await inventurnaKorekcia(db, {
      userId: zaklad.adminId,
      lotId,
      qtyDelta: "-12.500",
      costCenterId: zaklad.stredisko.id,
      note: "Inventúra 07/2026",
    });

    expect(vysledok.pohyb.moveType).toBe("korekcia");
    expect(vysledok.pohyb.costCenterId).toBe(zaklad.stredisko.id);
    expect(vysledok.pohyb.batchId).toBeNull();
    expect(await zostatok()).toBe("987.500");
  });

  test("prebytok smie prekročiť qty_received (horný CHECK zrušený v návrhu)", async () => {
    await inventurnaKorekcia(db, {
      userId: zaklad.adminId,
      lotId,
      qtyDelta: "25.000",
      costCenterId: zaklad.stredisko.id,
    });
    expect(await zostatok()).toBe("1025.000");
  });

  test("inventúrna korekcia NEvstupuje do nákladu žiadnej dávky", async () => {
    await inventurnaKorekcia(db, {
      userId: zaklad.adminId,
      lotId,
      qtyDelta: "-12.500",
      costCenterId: zaklad.stredisko.id,
    });
    expect(await materialCentsDavky()).toBe(0);
  });
});

describe("inventurnaKorekciaMaterialu (manko per materiál — FIFO odpis, D1)", () => {
  /** Druhá, novšia a drahšia šarža toho istého materiálu. */
  async function druhyLot() {
    const prijem = await pociatocnyStav(db, {
      userId: zaklad.adminId,
      receiptNumber: "P-002",
      receivedAt: "2026-07-05",
      polozky: [
        { materialId: zaklad.material.id, qty: "500.000", unitPrice: "45.0000" },
      ],
    });
    return prijem.loty[0];
  }

  test("manko sa odpíše cez šarže vo FIFO poradí, každý pohyb s cenou SVOJEJ šarže", async () => {
    const lotNovsi = await druhyLot();

    const vysledok = await inventurnaKorekciaMaterialu(db, {
      userId: zaklad.adminId,
      materialId: zaklad.material.id,
      qty: "1200.000",
      costCenterId: zaklad.stredisko.id,
      note: "Inventúra 07/2026",
    });

    expect(vysledok.pohyby).toHaveLength(2);
    const [prvy, druhy] = vysledok.pohyby;
    expect(prvy.lotId).toBe(lotId);
    expect(prvy.moveType).toBe("korekcia");
    expect(prvy.qtyDelta).toBe("-1000.000");
    expect(prvy.unitPrice).toBe("40.0000");
    expect(prvy.costCenterId).toBe(zaklad.stredisko.id);
    expect(prvy.batchId).toBeNull();
    expect(prvy.note).toBe("Inventúra 07/2026");
    expect(druhy.lotId).toBe(lotNovsi.id);
    expect(druhy.moveType).toBe("korekcia");
    expect(druhy.qtyDelta).toBe("-200.000");
    expect(druhy.unitPrice).toBe("45.0000");
    expect(druhy.costCenterId).toBe(zaklad.stredisko.id);

    expect(await zostatok()).toBe("0.000");
    expect(await zostatok(lotNovsi.id)).toBe("300.000");
  });

  test("manko v rámci najstaršej šarže nechá novšiu nedotknutú", async () => {
    const lotNovsi = await druhyLot();

    const vysledok = await inventurnaKorekciaMaterialu(db, {
      userId: zaklad.adminId,
      materialId: zaklad.material.id,
      qty: "250.000",
      costCenterId: zaklad.stredisko.id,
    });

    expect(vysledok.pohyby).toHaveLength(1);
    expect(vysledok.pohyby[0].lotId).toBe(lotId);
    expect(await zostatok()).toBe("750.000");
    expect(await zostatok(lotNovsi.id)).toBe("500.000");
  });

  test("vyčerpaná šarža sa preskočí — manko čerpá z ďalšej vo FIFO poradí", async () => {
    const lotNovsi = await druhyLot();
    await inventurnaKorekcia(db, {
      userId: zaklad.adminId,
      lotId,
      qtyDelta: "-1000.000",
      costCenterId: zaklad.stredisko.id,
    });

    const vysledok = await inventurnaKorekciaMaterialu(db, {
      userId: zaklad.adminId,
      materialId: zaklad.material.id,
      qty: "100.000",
      costCenterId: zaklad.stredisko.id,
    });

    expect(vysledok.pohyby).toHaveLength(1);
    expect(vysledok.pohyby[0].lotId).toBe(lotNovsi.id);
    expect(vysledok.pohyby[0].unitPrice).toBe("45.0000");
    expect(await zostatok(lotNovsi.id)).toBe("400.000");
  });

  test("manko nad celkový zostatok → NedostatokZasobyError a ŽIADNA korekcia nevznikne", async () => {
    await druhyLot(); // spolu 1500 kg

    await expect(
      inventurnaKorekciaMaterialu(db, {
        userId: zaklad.adminId,
        materialId: zaklad.material.id,
        qty: "1600.000",
        costCenterId: zaklad.stredisko.id,
      }),
    ).rejects.toThrow(NedostatokZasobyError);

    const korekcie = await db
      .select()
      .from(schema.stockMoves)
      .where(eq(schema.stockMoves.moveType, "korekcia"));
    expect(korekcie).toHaveLength(0);
  });

  test("manko musí byť kladné množstvo", async () => {
    await expect(
      inventurnaKorekciaMaterialu(db, {
        userId: zaklad.adminId,
        materialId: zaklad.material.id,
        qty: "0.000",
        costCenterId: zaklad.stredisko.id,
      }),
    ).rejects.toThrow(/kladné/);
  });

  test("manko per materiál NEvstupuje do nákladu žiadnej dávky", async () => {
    await inventurnaKorekciaMaterialu(db, {
      userId: zaklad.adminId,
      materialId: zaklad.material.id,
      qty: "10.000",
      costCenterId: zaklad.stredisko.id,
    });
    expect(await materialCentsDavky()).toBe(0);
  });
});

describe("cenovaKorekcia (oprava dokladu — schválená politika ex-OQ3)", () => {
  test("prepíše cenu lotu + snapshoty pohybov + zapíše audit_log; náklad dávky sadne na novú cenu", async () => {
    await vydajNavazky(db, {
      userId: zaklad.adminId,
      batchId: davka.id,
      materialId: zaklad.material.id,
      qty: "100.000",
    });
    expect(await materialCentsDavky()).toBe(4_000); // 100 × 40,0000

    await cenovaKorekcia(db, {
      userId: zaklad.adminId,
      lotId,
      novaCena: "38.5000",
      note: "Dobropis FA-2026-001",
      dnes: "2026-07-16",
    });

    // Lot má novú cenu.
    const [lot] = await db
      .select()
      .from(schema.materialLots)
      .where(eq(schema.materialLots.id, lotId));
    expect(lot.unitPrice).toBe("38.5000");

    // Všetky pohyby lotu majú prepísaný snapshot.
    const pohyby = await db
      .select()
      .from(schema.stockMoves)
      .where(eq(schema.stockMoves.lotId, lotId));
    for (const p of pohyby) {
      expect(p.unitPrice).toBe("38.5000");
    }

    // Náklad dávky sedí s opraveným dokladom: 100 × 38,5000 = 3850.
    expect(await materialCentsDavky()).toBe(3_850);

    // Audit stopa so starou a novou cenou.
    const zaznamy = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "price_correction"));
    expect(zaznamy).toHaveLength(1);
    expect(zaznamy[0].recordId).toBe(lotId);
    expect(zaznamy[0].changedBy).toBe(zaklad.adminId);
    expect(zaznamy[0].changes).toMatchObject({
      unit_price: { old: "40.0000", new: "38.5000" },
    });
  });

  test("rovnaká cena → chyba (korekcia bez zmeny nedáva zmysel)", async () => {
    await expect(
      cenovaKorekcia(db, {
        userId: zaklad.adminId,
        lotId,
        novaCena: "40.0000",
        dnes: "2026-07-16",
      }),
    ).rejects.toThrow();
  });
});
