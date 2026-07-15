import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { db } from "@/db";
import { zoznamPrikazov } from "@/server/press/queries";
import { dnesnyDatum } from "@/server/session";
import { ShipmentForm } from "./shipment-form";

export const dynamic = "force-dynamic";

export default async function NovyDodaciPage() {
  // Expedovať možno z príkazov vo výrobe / dokončených s voľnými pármi.
  const prikazy = (await zoznamPrikazov(db))
    .filter(
      (p) =>
        (p.status === "vo_vyrobe" || p.status === "dokoncena") &&
        p.vyrobenePary - p.expedovanePary > 0,
    )
    .map((p) => ({
      id: p.id,
      orderNumber: p.orderNumber,
      artikelCode: p.artikelCode,
      artikelName: p.artikelName,
      dostupne: p.vyrobenePary - p.expedovanePary,
    }));

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Späť na expedíciu"
          nativeButton={false}
          render={<Link href="/lisovna/expedicia" />}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">
          Nový dodací list
        </h1>
      </div>
      <ShipmentForm prikazy={prikazy} dnes={dnesnyDatum()} />
    </div>
  );
}
