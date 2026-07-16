// Zdieľaná seed logika číselníkov — používa ju produkčný seed (src/db/seed.ts)
// aj lokálna dev DB (scripts/dev-db.ts). Idempotentné (ON CONFLICT DO NOTHING).
import { and, eq, isNull } from "drizzle-orm";
import type { DbClient } from "./index";
import {
  calcSettings,
  costCenters,
  defectReasons,
  downtimeReasons,
  labParameters,
  machines,
  users,
} from "./schema";

export async function seedZakladneCiselniky(
  db: DbClient,
  admin: { id: string; email?: string | null; displayName?: string },
): Promise<void> {
  // 1) Bootstrap admin (jediný riadok s created_by = NULL).
  await db
    .insert(users)
    .values({
      id: admin.id,
      displayName: admin.displayName ?? "Admin",
      email: admin.email ?? null,
      role: "admin",
    })
    .onConflictDoNothing({ target: users.id });

  // 2) Nákladové strediská (SPEC M7 / M1 kategorizácia).
  const strediska = [
    { code: "valcovna", name: "Valcovňa" },
    { code: "lisovna", name: "Lisovňa" },
    { code: "labak", name: "Labák" },
    { code: "sprava", name: "Správa" },
  ];
  for (const s of strediska) {
    await db
      .insert(costCenters)
      .values({ ...s, createdBy: admin.id })
      .onConflictDoNothing();
  }

  // 3) Dôvody prestojov (SPEC M4 — číselník).
  const dovody = [
    { code: "porucha", name: "Porucha" },
    { code: "cakanie_na_material", name: "Čakanie na materiál" },
    { code: "prestavba", name: "Prestavba" },
    { code: "ine", name: "Iné" },
  ];
  for (const dovod of dovody) {
    await db
      .insert(downtimeReasons)
      .values({ ...dovod, createdBy: admin.id })
      .onConflictDoNothing();
  }

  // 4) QC parametre (SPEC M5 — reometria + trhačky + tvrdosť).
  const parametre = [
    { code: "ML", name: "Minimálny krútiaci moment (ML)", unit: "dNm", sortOrder: 1 },
    { code: "MH", name: "Maximálny krútiaci moment (MH)", unit: "dNm", sortOrder: 2 },
    { code: "TS2", name: "Čas navulkanizácie (ts2)", unit: "min", sortOrder: 3 },
    { code: "T90", name: "Optimum vulkanizácie (t90)", unit: "min", sortOrder: 4 },
    { code: "PEVNOST", name: "Pevnosť v ťahu", unit: "MPa", sortOrder: 5 },
    { code: "TAZNOST", name: "Ťažnosť", unit: "%", sortOrder: 6 },
    { code: "TVRDOST", name: "Tvrdosť", unit: "ShA", sortOrder: 7 },
  ];
  for (const p of parametre) {
    await db
      .insert(labParameters)
      .values({ ...p, createdBy: admin.id })
      .onConflictDoNothing();
  }

  // 5) Stroje lisovne (SPEC M6 — LIS1–LIS9 + strekolis, stredisko lisovna).
  // DECISION-PENDING: strekolis má odlišný proces (SPEC §2.3 [DOPLNIŤ]) —
  // zatiaľ modelovaný identicky, cykly = alokačný kľúč D2 aj preň.
  const [lisovna] = await db
    .select({ id: costCenters.id })
    .from(costCenters)
    .where(and(eq(costCenters.code, "lisovna"), isNull(costCenters.deletedAt)));
  if (lisovna) {
    const stroje = [
      ...Array.from({ length: 9 }, (_, i) => ({
        code: `LIS${i + 1}`,
        name: `Lis ${i + 1}`,
      })),
      { code: "STREKOLIS", name: "Strekolis" },
    ];
    for (const stroj of stroje) {
      await db
        .insert(machines)
        .values({ ...stroj, costCenterId: lisovna.id, createdBy: admin.id })
        .onConflictDoNothing();
    }
  }

  // 6) Dôvody nepodarkov (SPEC M6 — číselník).
  const dovodyNepodarkov = [
    { code: "nedolisok", name: "Nedolisok" },
    { code: "bublina", name: "Bublina" },
    { code: "prepal", name: "Prepálená zmes" },
    { code: "mechanicke_poskodenie", name: "Mechanické poškodenie" },
    { code: "ine", name: "Iné" },
  ];
  for (const dovod of dovodyNepodarkov) {
    await db
      .insert(defectReasons)
      .values({ ...dovod, createdBy: admin.id })
      .onConflictDoNothing();
  }

  // 7) Alokačné nastavenia M7 (D4: pomer inštalovaného príkonu 60/40).
  await db
    .insert(calcSettings)
    .values({
      code: "default",
      energyValcovnaPct: 60,
      energyLisovnaPct: 40,
      createdBy: admin.id,
    })
    .onConflictDoNothing();
}
