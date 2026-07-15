// Zdieľaná seed logika číselníkov — používa ju produkčný seed (src/db/seed.ts)
// aj lokálna dev DB (scripts/dev-db.ts). Idempotentné (ON CONFLICT DO NOTHING).
import type { DbClient } from "./index";
import { costCenters, downtimeReasons, labParameters, users } from "./schema";

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
}
