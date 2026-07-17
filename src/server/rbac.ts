// RBAC — mapovanie rola → moduly (SPEC §4). Čistá logika bez DB/server-only
// importov (používa ju aj klientská navigácia). Autorizácia sa opiera VÝHRADNE
// o rolu z DB users.role (nie z JWT/user_metadata — bezpečnostné pravidlo).
import type { UserRole } from "@/lib/enums";

export const MODULY = [
  "prehlad",
  "faktury",
  "dodavatelia",
  "sklad",
  "receptury",
  "vyroba",
  "labak",
  "lisovna",
  "kalkulacie",
  "ciselniky",
  "pouzivatelia",
  "manual",
] as const;

export type Modul = (typeof MODULY)[number];

// Ktoré roly majú prístup ku ktorému modulu (SPEC §4 + zadanie Kroku 2).
// admin má všetko (rieši sa v smieVidiet bez potreby vypisovať ho všade).
const POVOLENIA: Record<Modul, UserRole[]> = {
  // M8: dashboard — plný obsah admin+ekonóm; majstri vidia len výrobné KPI a
  // prestoje (finančné sekcie filtruje stránka podľa roly). Laborant má domov
  // v labáku a prehľad nemá.
  prehlad: ["ekonom", "majster_valcovne", "majster_lisovne"],
  faktury: ["ekonom"],
  dodavatelia: ["ekonom"],
  // SPEC §4: sklad je doména ekonóma. Majster valcovne robí výdaj navážky v
  // /vyroba (materiály servíruje server query, nie prístup do /sklad) — nedáva
  // mu prístup na nákupné ceny a cenovú históriu.
  sklad: ["ekonom"],
  receptury: [], // technická konfigurácia + QC limity → len admin
  vyroba: ["majster_valcovne"],
  labak: ["laborant"],
  // SPEC §4: príkazy, výkony, nepodarky, expedícia. Artikel mutácie sú v
  // actions zúžené na admina (predajná cena) — majster artikle len číta.
  lisovna: ["majster_lisovne"],
  // M7: uzávierky, náklady, marže — citlivé čísla len ekonóm (+ admin);
  // majstri kalkulácie nevidia (predajné ceny, marže).
  kalkulacie: ["ekonom"],
  ciselniky: [], // len admin
  pouzivatelia: [], // len admin
  // Používateľská príručka (/manual) — číta ju každá prihlásená rola.
  manual: ["ekonom", "majster_valcovne", "laborant", "majster_lisovne"],
};

// Prefix routy → modul (najdlhší prefix má prednosť netreba — prefixy sú
// disjunktné). Domovská „/“ je prístupná každej prihlásenej role.
const ROUTA_MODUL: { prefix: string; modul: Modul }[] = [
  { prefix: "/faktury", modul: "faktury" },
  { prefix: "/dodavatelia", modul: "dodavatelia" },
  { prefix: "/sklad", modul: "sklad" },
  { prefix: "/receptury", modul: "receptury" },
  { prefix: "/vyroba", modul: "vyroba" },
  { prefix: "/labak", modul: "labak" },
  { prefix: "/lisovna", modul: "lisovna" },
  { prefix: "/kalkulacie", modul: "kalkulacie" },
  { prefix: "/ciselniky", modul: "ciselniky" },
  { prefix: "/pouzivatelia", modul: "pouzivatelia" },
  { prefix: "/manual", modul: "manual" },
];

/** Smie daná rola vidieť/používať modul? Admin vždy áno. */
export function smieVidiet(role: UserRole, modul: Modul): boolean {
  if (role === "admin") return true;
  return POVOLENIA[modul].includes(role);
}

/**
 * Smie rola vstúpiť na routu (podľa prefixu)? „/“ je pre všetkých; neznáma
 * routa je povolená len adminovi (bezpečný default — deny pre ostatných).
 */
export function smieVidietRoute(role: UserRole, pathname: string): boolean {
  if (pathname === "/") return true;
  const zaznam = ROUTA_MODUL.find(
    (r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`),
  );
  if (!zaznam) return role === "admin";
  return smieVidiet(role, zaznam.modul);
}

/**
 * Domovský modul roly (kam presmerovať po prihlásení / z „/"). null = rola
 * nemá pridelený modul; takého používateľa necháme na „/" s neutrálnou
 * hláškou (žiadny loop).
 */
export function domovModul(role: UserRole): string | null {
  // M8: admin a ekonóm pristávajú na dashboarde — faktúry po splatnosti
  // musia byť viditeľné bez jediného kliku (SPEC §12).
  if (role === "admin" || role === "ekonom") return "/";
  if (role === "majster_valcovne") return "/vyroba";
  if (role === "laborant") return "/labak";
  if (role === "majster_lisovne") return "/lisovna";
  return null;
}

/**
 * Guard pre server actions — hodí doménovú chybu, ak rola nie je admin ani v
 * zozname povolených. Presnejší než modul (napr. sklad mutácie = len ekonom,
 * hoci /sklad modul vidí aj majster). Bez povolených rolí = len admin.
 */
export function overRolu(role: UserRole, ...povolene: UserRole[]): void {
  if (role === "admin") return;
  if (!povolene.includes(role)) {
    throw new Error("Nedostatočné oprávnenie pre túto akciu.");
  }
}
