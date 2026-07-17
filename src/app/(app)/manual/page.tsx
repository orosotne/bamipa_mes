import { MANUAL_HTML } from "./manual-obsah";

export const dynamic = "force-dynamic";

// MANUAL for BAMIPA_MES — príručka ako interná stránka appky (so sidebar-om).
// Obsah je vlastný dôveryhodný HTML fragment z manual-obsah.ts (nie user input),
// preto dangerouslySetInnerHTML; tlačidlo Tlačiť vo fragmente používa inline
// onclick=window.print() — aside má print:hidden, vytlačí sa len obsah.
export default function ManualPage() {
  return (
    <div
      className="manual-root"
      dangerouslySetInnerHTML={{ __html: MANUAL_HTML }}
    />
  );
}
