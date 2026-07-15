import { db } from "@/db";
import { listMaterials } from "@/server/materials/service";
import { dnesnyDatum } from "@/server/session";
import { fakturyNaParovanie } from "@/server/warehouse/queries";
import { ReceiptForm } from "./receipt-form";

export const dynamic = "force-dynamic";

export default async function NovaPrijemkaPage() {
  const [materialy, faktury] = await Promise.all([
    listMaterials(db),
    fakturyNaParovanie(db),
  ]);

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Nová príjemka</h1>
      <ReceiptForm
        materialy={materialy.map((m) => ({
          id: m.id,
          code: m.code,
          name: m.name,
          unit: m.unit,
        }))}
        faktury={faktury}
        dnes={dnesnyDatum()}
      />
    </div>
  );
}
