import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import * as schema from "@/db/schema";
import { createTestDb, seedZaklad, type TestDb } from "@/test/pglite";
import {
  pripravSchvalenuDavku,
  seedLisovnaZaklad,
  type LisovnaZaklad,
  type Zaklad,
} from "./fixtures";
import { zalozPrikaz } from "./orders";
import { zapisVykon } from "./runs";
import { stornoDodaciList, vytvorDodaciList } from "./shipments";

let db: TestDb;
let z: Zaklad;
let lz: LisovnaZaklad;
let prikazId: string;

beforeEach(async () => {
  ({ db } = await createTestDb());
  z = await seedZaklad(db);
  lz = await seedLisovnaZaklad(db, z);
  const prikaz = await zalozPrikaz(db, {
    userId: z.adminId,
    soleModelId: lz.artikel.id,
    qtyPairsPlanned: 500,
  });
  prikazId = prikaz.id;
  const davka = await pripravSchvalenuDavku(db, z, lz);
  // vyrobených 230 dobrých párov
  await zapisVykon(db, {
    userId: z.adminId,
    workOrderId: prikazId,
    machineId: lz.lis.id,
    batchId: davka.id,
    runDate: "2026-07-15",
    shift: "ranna",
    cyclesCount: 120,
    pairsProduced: 230,
    mixtureKg: "60.000",
    workerId: z.pracovnik.id,
  });
});

describe("vytvorDodaciList", () => {
  test("vytvorí DL s číslom DL-RRRR-NNNN, položkami a auditom", async () => {
    const { shipment, items } = await vytvorDodaciList(db, {
      userId: z.adminId,
      shipDate: "2026-07-16",
      customer: "LOWA",
      polozky: [{ workOrderId: prikazId, qtyPairs: 200 }],
    });

    expect(shipment.shipmentNumber).toMatch(/^DL-\d{4}-0001$/);
    expect(shipment.customer).toBe("LOWA");
    expect(items).toHaveLength(1);
    expect(items[0].qtyPairs).toBe(200);

    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.recordId, shipment.id));
    expect(audit).toHaveLength(1);
    expect(audit[0].tableName).toBe("shipments");
  });

  test("expedícia nad vyrobené množstvo je odmietnutá (DB trigger)", async () => {
    await expect(
      vytvorDodaciList(db, {
        userId: z.adminId,
        shipDate: "2026-07-16",
        customer: "LOWA",
        polozky: [{ workOrderId: prikazId, qtyPairs: 231 }],
      }),
    ).rejects.toSatisfy((e) =>
      plnaHlaska(e).includes("Nedostatok hotových párov"),
    );
  });

  test("súčet cez viac DL nesmie prekročiť vyrobené", async () => {
    await vytvorDodaciList(db, {
      userId: z.adminId,
      shipDate: "2026-07-16",
      customer: "LOWA",
      polozky: [{ workOrderId: prikazId, qtyPairs: 200 }],
    });
    await expect(
      vytvorDodaciList(db, {
        userId: z.adminId,
        shipDate: "2026-07-17",
        customer: "LOWA",
        polozky: [{ workOrderId: prikazId, qtyPairs: 31 }],
      }),
    ).rejects.toSatisfy((e) =>
      plnaHlaska(e).includes("Nedostatok hotových párov"),
    );
  });

  test("bez položiek je odmietnutý", async () => {
    await expect(
      vytvorDodaciList(db, {
        userId: z.adminId,
        shipDate: "2026-07-16",
        customer: "LOWA",
        polozky: [],
      }),
    ).rejects.toThrow(/aspoň jednu položku/);
  });

  test("duplicitný príkaz v položkách je odmietnutý", async () => {
    await expect(
      vytvorDodaciList(db, {
        userId: z.adminId,
        shipDate: "2026-07-16",
        customer: "LOWA",
        polozky: [
          { workOrderId: prikazId, qtyPairs: 10 },
          { workOrderId: prikazId, qtyPairs: 20 },
        ],
      }),
    ).rejects.toThrow(/opakuje/);
  });

  test("z nového príkazu bez výroby nejde expedovať (DB trigger)", async () => {
    const novy = await zalozPrikaz(db, {
      userId: z.adminId,
      soleModelId: lz.artikel.id,
      qtyPairsPlanned: 10,
    });
    await expect(
      vytvorDodaciList(db, {
        userId: z.adminId,
        shipDate: "2026-07-16",
        customer: "LOWA",
        polozky: [{ workOrderId: novy.id, qtyPairs: 1 }],
      }),
    ).rejects.toSatisfy((e) => plnaHlaska(e).includes("nemožno expedovať"));
  });
});

describe("stornoDodaciList", () => {
  test("soft delete hlavičky aj položiek uvoľní kapacitu príkazu", async () => {
    const { shipment } = await vytvorDodaciList(db, {
      userId: z.adminId,
      shipDate: "2026-07-16",
      customer: "LOWA",
      polozky: [{ workOrderId: prikazId, qtyPairs: 230 }],
    });

    await stornoDodaciList(db, { userId: z.adminId, id: shipment.id });

    const [hlavicka] = await db
      .select()
      .from(schema.shipments)
      .where(eq(schema.shipments.id, shipment.id));
    expect(hlavicka.deletedAt).not.toBeNull();

    const polozky = await db
      .select()
      .from(schema.shipmentItems)
      .where(eq(schema.shipmentItems.shipmentId, shipment.id));
    expect(polozky.every((p) => p.deletedAt !== null)).toBe(true);

    // kapacita 230 párov je opäť voľná
    const druhy = await vytvorDodaciList(db, {
      userId: z.adminId,
      shipDate: "2026-07-17",
      customer: "LOWA",
      polozky: [{ workOrderId: prikazId, qtyPairs: 230 }],
    });
    expect(druhy.items[0].qtyPairs).toBe(230);
  });

  test("hard DELETE položky DL zastaví DB trigger", async () => {
    const { items } = await vytvorDodaciList(db, {
      userId: z.adminId,
      shipDate: "2026-07-16",
      customer: "LOWA",
      polozky: [{ workOrderId: prikazId, qtyPairs: 10 }],
    });
    await expect(
      db
        .delete(schema.shipmentItems)
        .where(eq(schema.shipmentItems.id, items[0].id)),
    ).rejects.toSatisfy((e) => plnaHlaska(e).includes("nemožno mazať"));
  });
});

/** Spojí message reťazec chyby vrátane cause (DrizzleQueryError balí PG chybu). */
function plnaHlaska(e: unknown): string {
  const casti: string[] = [];
  let cur = e as { message?: string; cause?: unknown } | undefined;
  while (cur) {
    if (typeof cur.message === "string") casti.push(cur.message);
    cur = cur.cause as { message?: string; cause?: unknown } | undefined;
  }
  return casti.join(" | ");
}
