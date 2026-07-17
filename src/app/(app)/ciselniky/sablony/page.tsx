import { ArrowLeft, ArrowRight, Download } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

// Prehľad importných šablón pre kolegu, čo pripravuje dáta. Stĺpce a povinnosť
// sú doslova podľa docs/import-sablony/README.md; súbory na stiahnutie sú
// public/sablony/*.csv (zhodné s docs/, stráži sablony.test.ts). Stránka je pod
// /ciselniky/ → admin-only cez ciselniky layout (vyzadajModul).
type Stlpec = { nazov: string; povinny: string; popis: string };
type Sablona = {
  cislo: number;
  subor: string;
  nazov: string;
  naCo: string;
  stlpce: Stlpec[];
  poznamka?: string;
};

const SABLONY: Sablona[] = [
  {
    cislo: 1,
    subor: "1-dodavatelia.csv",
    nazov: "Dodávatelia",
    naCo: "Firmy, od ktorých nakupujete materiál. Importuj ako prvé — materiály sa na dodávateľov odkazujú.",
    stlpce: [
      { nazov: "nazov", povinny: "áno", popis: "Obchodné meno dodávateľa" },
      {
        nazov: "ico",
        povinny: "—",
        popis:
          "IČO — odporúčame vyplniť, slúži na rozpoznanie už existujúceho dodávateľa",
      },
      { nazov: "dic", povinny: "—", popis: "DIČ" },
      { nazov: "ic_dph", povinny: "—", popis: "IČ DPH (napr. SK2021234567)" },
      { nazov: "adresa", povinny: "—", popis: "Adresa v jednom riadku" },
      { nazov: "email", povinny: "—", popis: "Kontaktný e-mail" },
      { nazov: "telefon", povinny: "—", popis: "Telefón" },
      { nazov: "poznamka", povinny: "—", popis: "Ľubovoľná poznámka" },
    ],
  },
  {
    cislo: 2,
    subor: "2-materialy.csv",
    nazov: "Materiály",
    naCo: "Suroviny a obalový materiál na sklade. Môžu odkazovať na dodávateľov, preto idú po nich.",
    stlpce: [
      { nazov: "kod", povinny: "áno", popis: "Jedinečný kód materiálu (napr. SBR-1502)" },
      { nazov: "nazov", povinny: "áno", popis: "Názov materiálu" },
      { nazov: "mj", povinny: "áno", popis: "Merná jednotka: kg, l alebo ks" },
      {
        nazov: "kategoria",
        povinny: "áno",
        popis:
          "Jedna z: kaucuk, plnivo, olej, chemikalia, obalovy_material, ine",
      },
      {
        nazov: "min_zasoba",
        povinny: "—",
        popis: "Minimálna zásoba v MJ, desatinná čiarka (napr. 500 alebo 12,5)",
      },
      {
        nazov: "predvoleni_dodavatelia",
        povinny: "—",
        popis:
          "Názvy (alebo IČO) dodávateľov oddelené zvislou čiarou | — musia už existovať",
      },
      { nazov: "poznamka", povinny: "—", popis: "Ľubovoľná poznámka" },
    ],
    poznamka:
      "Materiály, ktoré budú v receptúrach, musia mať mj = kg (receptúry sa zadávajú v kg na dávku).",
  },
  {
    cislo: 3,
    subor: "3-receptury.csv",
    nazov: "Receptúry zmesí",
    naCo: "Zloženie zmesí. Jeden riadok = jedna položka receptúry; riadky tej istej zmesi idú pod sebou, údaje o zmesi stačí v prvom riadku. Odkazujú na materiály.",
    stlpce: [
      { nazov: "kod_zmesi", povinny: "áno", popis: "Kód zmesi (napr. A-01) — v každom riadku" },
      { nazov: "nazov_zmesi", povinny: "1. riadok zmesi", popis: "Názov zmesi" },
      {
        nazov: "standardna_davka_kg",
        povinny: "1. riadok zmesi",
        popis: "Veľkosť štandardnej dávky v kg",
      },
      { nazov: "tech_poznamka", povinny: "—", popis: "Technologická poznámka k receptúre" },
      {
        nazov: "kod_materialu",
        povinny: "áno",
        popis: "Kód materiálu z tabuľky Materiály (musí existovať a byť v kg)",
      },
      {
        nazov: "mnozstvo_kg",
        povinny: "áno",
        popis: "Množstvo v kg na štandardnú dávku, desatinná čiarka, max. 3 des. miesta",
      },
      {
        nazov: "poradie",
        povinny: "—",
        popis: "Poradie položky v receptúre (ak chýba, platí poradie riadkov)",
      },
    ],
    poznamka:
      "Import vytvorí novú verziu receptúry — existujúce verzie sa nikdy neprepisujú (každá výrobná dávka si pamätá svoju verziu).",
  },
  {
    cislo: 4,
    subor: "4-artikle.csv",
    nazov: "Artikle podošiev",
    naCo: "Modely podošiev, ktoré sa lisujú. Odkazujú na zmesi, preto idú posledné.",
    stlpce: [
      { nazov: "kod", povinny: "áno", popis: "Jedinečný kód artikla (napr. TREK-01)" },
      { nazov: "nazov", povinny: "áno", popis: "Názov modelu podošvy" },
      {
        nazov: "kod_zmesi",
        povinny: "áno",
        popis: "Kód zmesi z tabuľky Receptúry (musí existovať)",
      },
      {
        nazov: "norma_kg_na_par",
        povinny: "áno",
        popis: "Norma spotreby zmesi na pár v kg, desatinná čiarka (napr. 0,450)",
      },
      {
        nazov: "cielovy_cas_cyklu_s",
        povinny: "—",
        popis: "Cieľový čas lisovacieho cyklu v sekundách (celé číslo)",
      },
      {
        nazov: "predajna_cena_eur",
        povinny: "—",
        popis: "Predajná cena za pár v €, desatinná čiarka (napr. 4,20)",
      },
    ],
  },
];

export default function SablonyPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Šablóny na import číselníkov
          </h1>
          <p className="text-sm text-muted-foreground">
            Stiahni si šablóny, doplň do nich dáta v Exceli a nahraj cez{" "}
            <b>Číselníky → Import</b>. Hlavičkový riadok (prvý) nechaj tak, ako
            je.
          </p>
        </div>
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link href="/ciselniky/import" />}
        >
          Prejsť na import <ArrowRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Spoločné pokyny */}
      <div className="rounded-lg border border-violet-200 bg-violet-50 p-4 dark:border-violet-900 dark:bg-violet-950/30">
        <h2 className="mb-2 text-sm font-semibold text-violet-900 dark:text-violet-200">
          Ako na to
        </h2>
        <ol className="ml-4 list-decimal space-y-1 text-sm text-violet-900/90 dark:text-violet-200/90">
          <li>
            Stiahni šablónu tlačidlom nižšie a otvor ju v Exceli.
          </li>
          <li>
            Prepíš alebo zmaž vzorové riadky a doplň svoje dáta. Desatinné čísla
            píš s čiarkou (napr. <code>65,5</code>).
          </li>
          <li>
            Ulož cez <b>Súbor → Uložiť ako → CSV UTF-8 (oddelený čiarkami)</b>.
          </li>
          <li>
            Nahraj v poradí <b>1 → 2 → 3 → 4</b> (súbory sa na seba odkazujú).
            Systém najprv všetko skontroluje a chyby ukáže po slovensky — nič sa
            nezapíše, kým import nepotvrdíš.
          </li>
        </ol>
      </div>

      {/* Karta na každú šablónu */}
      {SABLONY.map((s) => (
        <section
          key={s.subor}
          className="rounded-lg border bg-card p-5 shadow-sm"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-600 text-sm font-semibold text-white">
                {s.cislo}
              </span>
              <div>
                <h2 className="text-lg font-semibold tracking-tight">
                  {s.nazov}
                </h2>
                <p className="mt-0.5 text-sm text-muted-foreground">{s.naCo}</p>
                <code className="mt-1 inline-block text-xs text-muted-foreground">
                  {s.subor}
                </code>
              </div>
            </div>
            <a
              href={`/sablony/${s.subor}`}
              download
              className="flex shrink-0 items-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700"
            >
              <Download className="h-4 w-4" />
              Stiahnuť
            </a>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-1.5 pr-3 font-medium">Stĺpec</th>
                  <th className="py-1.5 pr-3 font-medium">Povinný</th>
                  <th className="py-1.5 font-medium">Popis</th>
                </tr>
              </thead>
              <tbody>
                {s.stlpce.map((st) => (
                  <tr key={st.nazov} className="border-b last:border-0">
                    <td className="py-1.5 pr-3 align-top">
                      <code className="text-xs">{st.nazov}</code>
                    </td>
                    <td className="py-1.5 pr-3 align-top whitespace-nowrap">
                      {st.povinny === "áno" ? (
                        <span className="font-medium text-violet-700 dark:text-violet-300">
                          áno
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{st.povinny}</span>
                      )}
                    </td>
                    <td className="py-1.5 align-top text-muted-foreground">
                      {st.popis}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {s.poznamka && (
            <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              <b>Pozor:</b> {s.poznamka}
            </p>
          )}
        </section>
      ))}

      <div className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Ako sa spoznajú existujúce záznamy</p>
        <p className="mt-1">
          Materiály, zmesi a artikle podľa <b>kódu</b>, dodávatelia podľa{" "}
          <b>IČO</b> (inak podľa názvu). Predvolene sa existujúce záznamy
          neprepisujú (v prehľade sú „preskočené“). Pri zaškrtnutí{" "}
          <b>„Aktualizovať existujúce záznamy“</b> sa vyplnené políčka prepíšu
          (prázdne nič nemaže) a receptúram vznikne nová verzia.
        </p>
      </div>

      <div>
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link href="/ciselniky" />}
        >
          <ArrowLeft className="h-4 w-4" /> Späť na Číselníky
        </Button>
      </div>
    </div>
  );
}
