// Exporty CSV pre účtovníčku (SPEC M8: „všetky tabuľky exportovateľné").
// UTF-8 BOM + bodkočiarka → Excel sk-SK otvorí dvojklikom.
import { Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const EXPORTY: { report: string; label: string }[] = [
  { report: "cashflow", label: "Cash-flow — nezaplatené faktúry" },
  { report: "marze", label: "Marže per artikel" },
  { report: "naklady-kg", label: "Náklad na kg zmesi po mesiacoch" },
  { report: "naklady-par", label: "Náklad na pár po mesiacoch" },
  { report: "prestoje", label: "Prestoje per dôvod a stroj" },
  { report: "nepodarky", label: "Nepodarky per dôvod a stroj" },
  { report: "materialy", label: "Nákupné ceny surovín (top 10)" },
];

export function ExportyCard({ dni }: { dni: number }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Exporty pre účtovníčku (CSV)</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {EXPORTY.map((e) => (
            <li key={e.report}>
              <a
                href={`/api/export/${e.report}?dni=${dni}`}
                className="inline-flex items-center gap-2 text-sm underline-offset-4 hover:underline"
              >
                <Download className="h-4 w-4 text-muted-foreground" aria-hidden />
                {e.label}
              </a>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">
          Súbory sú v CSV s bodkočiarkou a desatinnou čiarkou — Excel ich otvorí
          priamo.
        </p>
      </CardContent>
    </Card>
  );
}
