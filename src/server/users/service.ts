// Správa používateľov (SPEC §4) — DB vrstva. Auth účet vzniká v action cez
// Supabase admin API; tu sa vedie záznam v našej users tabuľke (rola, aktivita)
// + audit_log. Rola pre autorizáciu žije VÝHRADNE tu (nie v JWT).
import { asc, eq } from "drizzle-orm";
import type { DbClient } from "@/db";
import * as schema from "@/db/schema";
import type { UserRole } from "@/lib/enums";

export type PouzivatelRiadok = {
  id: string;
  displayName: string;
  email: string | null;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
};

/** Všetci používatelia (aj neaktívni) pre správu — zoradení podľa mena. */
export async function zoznamPouzivatelov(
  db: DbClient,
): Promise<PouzivatelRiadok[]> {
  const riadky = await db
    .select({
      id: schema.users.id,
      displayName: schema.users.displayName,
      email: schema.users.email,
      role: schema.users.role,
      isActive: schema.users.isActive,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users)
    .orderBy(asc(schema.users.displayName));
  return riadky;
}

/** Založí users záznam pre existujúce auth id (po Supabase createUser) + audit. */
export async function vytvorUsersZaznam(
  db: DbClient,
  vstup: {
    adminId: string;
    id: string;
    displayName: string;
    email: string;
    role: UserRole;
  },
): Promise<typeof schema.users.$inferSelect> {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(schema.users)
      .values({
        id: vstup.id,
        displayName: vstup.displayName,
        email: vstup.email,
        role: vstup.role,
        createdBy: vstup.adminId,
      })
      .returning();

    await tx.insert(schema.auditLog).values({
      tableName: "users",
      recordId: vstup.id,
      action: "insert",
      changedBy: vstup.adminId,
      changes: { new: { displayName: vstup.displayName, role: vstup.role } },
    });

    return user;
  });
}

/** Zmena roly používateľa + audit. */
export async function zmenRolu(
  db: DbClient,
  vstup: { adminId: string; id: string; role: UserRole },
): Promise<typeof schema.users.$inferSelect> {
  return db.transaction(async (tx) => {
    const [povodny] = await tx
      .select({ role: schema.users.role })
      .from(schema.users)
      .where(eq(schema.users.id, vstup.id));
    if (!povodny) throw new Error("Používateľ neexistuje.");

    const [user] = await tx
      .update(schema.users)
      .set({ role: vstup.role })
      .where(eq(schema.users.id, vstup.id))
      .returning();

    await tx.insert(schema.auditLog).values({
      tableName: "users",
      recordId: vstup.id,
      action: "update",
      changedBy: vstup.adminId,
      changes: { old: { role: povodny.role }, new: { role: vstup.role } },
    });

    return user;
  });
}

/** Aktivácia/deaktivácia používateľa + audit. Nedovolí deaktivovať sám seba. */
export async function nastavAktivny(
  db: DbClient,
  vstup: { adminId: string; id: string; isActive: boolean },
): Promise<typeof schema.users.$inferSelect> {
  if (!vstup.isActive && vstup.id === vstup.adminId) {
    throw new Error("Nemôžeš deaktivovať vlastný účet.");
  }

  return db.transaction(async (tx) => {
    const [user] = await tx
      .update(schema.users)
      .set({ isActive: vstup.isActive })
      .where(eq(schema.users.id, vstup.id))
      .returning();
    if (!user) throw new Error("Používateľ neexistuje.");

    await tx.insert(schema.auditLog).values({
      tableName: "users",
      recordId: vstup.id,
      action: "status_change",
      changedBy: vstup.adminId,
      changes: { new: { isActive: vstup.isActive } },
    });

    return user;
  });
}
