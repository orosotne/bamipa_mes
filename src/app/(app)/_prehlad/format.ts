// Zobrazovacie helpery dashboardu (M8) — client-safe, zdieľané sekciami.
import { formatCentsToEur } from "@/lib/format";

/** "480.65" (centy, 2 des.) → "4,81 €"; null → "—". Vzor kalkulacie/marze. */
export function eurZDvojDesCentov(cents2: string | null): string {
  if (cents2 === null) return "—";
  return formatCentsToEur(Math.round(Number(cents2)));
}

/** 95 → "1 h 35 min"; 0 → "0 min". */
export function formatMinuty(minuty: number): string {
  const h = Math.floor(minuty / 60);
  const m = minuty % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}
