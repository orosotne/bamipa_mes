import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { nacitajNastavenia } from "@/server/calc/queries";
import { getCurrentUser } from "@/server/session";
import { NastaveniaForm } from "./nastavenia-form";

export const dynamic = "force-dynamic";

export default async function NastaveniaPage() {
  // Alokačné kľúče spravuje výhradne admin (SPEC §4); ekonóm modul vidí,
  // ale nastavenia nie.
  const user = await getCurrentUser(db);
  if (user.role !== "admin") redirect("/kalkulacie");

  const nastavenia = await nacitajNastavenia(db);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <Link
          href="/kalkulacie"
          className="mb-1 inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Kalkulácie
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          Alokačné nastavenia
        </h1>
        <p className="text-sm text-muted-foreground">
          D4: mesačná faktúra za energie sa delí medzi valcovňu a lisovňu
          fixným pomerom inštalovaného príkonu strojov.
        </p>
      </div>

      <NastaveniaForm valcovnaPct={nastavenia?.energyValcovnaPct ?? 60} />
    </div>
  );
}
