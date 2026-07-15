import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { db } from "@/db";
import { zoznamArtiklov } from "@/server/press/queries";
import { OrderForm } from "./order-form";

export const dynamic = "force-dynamic";

export default async function NovyPrikazPage() {
  const artikle = (await zoznamArtiklov(db)).filter((a) => a.isActive);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Späť na lisovňu"
          nativeButton={false}
          render={<Link href="/lisovna" />}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">
          Nový výrobný príkaz
        </h1>
      </div>
      <OrderForm
        artikle={artikle.map((a) => ({
          id: a.id,
          code: a.code,
          name: a.name,
          zmesCode: a.zmesCode,
        }))}
      />
    </div>
  );
}
