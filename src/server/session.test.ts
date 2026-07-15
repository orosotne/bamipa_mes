// pouzivatelPodlaId — načítanie používateľa (rola) podľa auth id. TDD nad PGlite.
// getCurrentUser (číta Supabase session) sa testuje E2E — cookies/GoTrue nie sú
// v PGlite dostupné.
import { beforeEach, describe, expect, test } from "vitest";
import * as schema from "@/db/schema";
import { createTestDb, seedZaklad, type TestDb } from "@/test/pglite";
import { pouzivatelPodlaId } from "./session";

let db: TestDb;
let zaklad: Awaited<ReturnType<typeof seedZaklad>>;

beforeEach(async () => {
  ({ db } = await createTestDb());
  zaklad = await seedZaklad(db); // Test Admin (rola admin)
});

describe("pouzivatelPodlaId", () => {
  test("existujúci aktívny používateľ → vráti riadok s rolou", async () => {
    const user = await pouzivatelPodlaId(db, zaklad.adminId);
    expect(user).not.toBeNull();
    expect(user!.id).toBe(zaklad.adminId);
    expect(user!.role).toBe("admin");
  });

  test("neznáme id → null", async () => {
    const user = await pouzivatelPodlaId(
      db,
      "00000000-0000-0000-0000-00000000dead",
    );
    expect(user).toBeNull();
  });

  test("neaktívny používateľ → null", async () => {
    const [laborant] = await db
      .insert(schema.users)
      .values({
        id: "00000000-0000-0000-0000-0000000000c1",
        displayName: "Neaktívny",
        role: "laborant",
        isActive: false,
        createdBy: zaklad.adminId,
      })
      .returning();
    expect(await pouzivatelPodlaId(db, laborant.id)).toBeNull();
  });

  test("zmazaný používateľ → null", async () => {
    const [ekonom] = await db
      .insert(schema.users)
      .values({
        id: "00000000-0000-0000-0000-0000000000c2",
        displayName: "Zmazaný",
        role: "ekonom",
        deletedAt: new Date(),
        createdBy: zaklad.adminId,
      })
      .returning();
    expect(await pouzivatelPodlaId(db, ekonom.id)).toBeNull();
  });
});
