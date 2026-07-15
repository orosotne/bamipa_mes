// Správa používateľov (M/§4) — DB vrstva (priradenie roly, aktivácia). TDD nad
// PGlite. Vytvorenie auth účtu (Supabase admin API) je v action, tu nie.
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import * as schema from "@/db/schema";
import { createTestDb, seedZaklad, type TestDb } from "@/test/pglite";
import {
  nastavAktivny,
  vytvorUsersZaznam,
  zmenRolu,
  zoznamPouzivatelov,
} from "./service";

let db: TestDb;
let zaklad: Awaited<ReturnType<typeof seedZaklad>>;

const NOVY_ID = "00000000-0000-0000-0000-0000000000e1";

beforeEach(async () => {
  ({ db } = await createTestDb());
  zaklad = await seedZaklad(db); // Test Admin (admin)
});

describe("vytvorUsersZaznam", () => {
  test("vytvorí záznam s rolou + audit", async () => {
    const user = await vytvorUsersZaznam(db, {
      adminId: zaklad.adminId,
      id: NOVY_ID,
      displayName: "Eva Laborantka",
      email: "eva@bamipa.local",
      role: "laborant",
    });
    expect(user.id).toBe(NOVY_ID);
    expect(user.role).toBe("laborant");
    expect(user.isActive).toBe(true);

    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.recordId, NOVY_ID));
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });

  test("duplicitný email → chyba", async () => {
    await vytvorUsersZaznam(db, {
      adminId: zaklad.adminId,
      id: NOVY_ID,
      displayName: "Eva",
      email: "eva@bamipa.local",
      role: "laborant",
    });
    await expect(
      vytvorUsersZaznam(db, {
        adminId: zaklad.adminId,
        id: "00000000-0000-0000-0000-0000000000e2",
        displayName: "Iná Eva",
        email: "eva@bamipa.local",
        role: "ekonom",
      }),
    ).rejects.toThrow();
  });
});

describe("zmenRolu", () => {
  test("zmení rolu + audit", async () => {
    await vytvorUsersZaznam(db, {
      adminId: zaklad.adminId,
      id: NOVY_ID,
      displayName: "Eva",
      email: "eva@bamipa.local",
      role: "laborant",
    });
    const upraveny = await zmenRolu(db, {
      adminId: zaklad.adminId,
      id: NOVY_ID,
      role: "ekonom",
    });
    expect(upraveny.role).toBe("ekonom");
  });
});

describe("nastavAktivny", () => {
  test("deaktivuje používateľa + audit", async () => {
    await vytvorUsersZaznam(db, {
      adminId: zaklad.adminId,
      id: NOVY_ID,
      displayName: "Eva",
      email: "eva@bamipa.local",
      role: "laborant",
    });
    const po = await nastavAktivny(db, {
      adminId: zaklad.adminId,
      id: NOVY_ID,
      isActive: false,
    });
    expect(po.isActive).toBe(false);
  });

  test("deaktivácia vlastného účtu → chyba (nezamkni sa)", async () => {
    await expect(
      nastavAktivny(db, {
        adminId: zaklad.adminId,
        id: zaklad.adminId,
        isActive: false,
      }),
    ).rejects.toThrow(/vlastn/i);
  });
});

describe("lockout invariant — posledný aktívny admin", () => {
  const ADMIN2 = "00000000-0000-0000-0000-0000000000d1";

  async function pridajAdmina2() {
    await db.insert(schema.users).values({
      id: ADMIN2,
      displayName: "Admin dva",
      role: "admin",
      createdBy: zaklad.adminId,
    });
  }

  test("zmenRolu: demotion posledného admina (aj sám sebe) → chyba", async () => {
    // seeded admin je jediný admin
    await expect(
      zmenRolu(db, { adminId: zaklad.adminId, id: zaklad.adminId, role: "ekonom" }),
    ).rejects.toThrow(/posledný|admin/i);
  });

  test("s druhým adminom demotion prvého prejde, posledného už nie", async () => {
    await pridajAdmina2();
    // 2 admini → demotion prvého OK
    await zmenRolu(db, {
      adminId: ADMIN2,
      id: zaklad.adminId,
      role: "ekonom",
    });
    // teraz je ADMIN2 posledný → demotion blokovaná
    await expect(
      zmenRolu(db, { adminId: ADMIN2, id: ADMIN2, role: "laborant" }),
    ).rejects.toThrow(/posledný/i);
  });

  test("nastavAktivny: deaktivácia posledného admina (iným účtom) → chyba", async () => {
    await pridajAdmina2();
    // deaktivácia jedného z dvoch adminov OK
    await nastavAktivny(db, {
      adminId: zaklad.adminId,
      id: ADMIN2,
      isActive: false,
    });
    // seeded admin je teraz jediný aktívny → deaktivácia (cez ADMIN2) blokovaná
    await expect(
      nastavAktivny(db, {
        adminId: ADMIN2,
        id: zaklad.adminId,
        isActive: false,
      }),
    ).rejects.toThrow(/posledný/i);
  });
});

describe("zoznamPouzivatelov", () => {
  test("vráti všetkých vrátane admina", async () => {
    await vytvorUsersZaznam(db, {
      adminId: zaklad.adminId,
      id: NOVY_ID,
      displayName: "Eva",
      email: "eva@bamipa.local",
      role: "laborant",
    });
    const zoznam = await zoznamPouzivatelov(db);
    expect(zoznam.length).toBe(2);
    expect(zoznam.map((u) => u.role)).toContain("admin");
    expect(zoznam.map((u) => u.role)).toContain("laborant");
  });
});
