// Horizontálny bar list (jedna séria, bez identity) — jedna farba z palety,
// hodnoty priamo pri baroch v text tokenoch, zaoblený dátový koniec.
const FARBA = "#2a78d6";

export function BarList({
  titulok,
  polozky,
}: {
  titulok: string;
  polozky: { label: string; poznamka?: string; hodnota: string; mnozstvo: number }[];
}) {
  const max = Math.max(...polozky.map((p) => p.mnozstvo), 1);
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium text-muted-foreground">{titulok}</h3>
      <ul className="space-y-2">
        {polozky.map((p) => (
          <li key={p.label + (p.poznamka ?? "")}>
            <div className="mb-0.5 flex items-baseline justify-between gap-2 text-sm">
              <span>
                {p.label}
                {p.poznamka && (
                  <span className="ml-1 text-xs text-muted-foreground">
                    ({p.poznamka})
                  </span>
                )}
              </span>
              <span className="tabular-nums text-muted-foreground">{p.hodnota}</span>
            </div>
            <div className="h-2 rounded-sm bg-muted">
              <div
                className="h-2 rounded-r-sm"
                style={{
                  width: `${Math.max((p.mnozstvo / max) * 100, 1)}%`,
                  backgroundColor: FARBA,
                }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
