// Klient-safe slovenské labely pre DB enumy (terminológia zo SPEC doslovne).

export const KATEGORIE_FAKTUR = {
  material: "Materiál",
  energia: "Energia",
  sluzby: "Služby",
  investicia: "Investícia",
  rezia: "Réžia",
} as const;

export const STAVY_FAKTUR = {
  nova: "Nová",
  schvalena: "Schválená",
  ciastocne_zaplatena: "Čiastočne zaplatená",
  zaplatena: "Zaplatená",
} as const;

export const KATEGORIE_MATERIALOV = {
  kaucuk: "Kaučuk",
  plnivo: "Plnivo",
  olej: "Olej",
  chemikalia: "Chemikália",
  obalovy_material: "Obalový materiál",
  ine: "Iné",
} as const;

export const MERNE_JEDNOTKY = {
  kg: "kg",
  l: "l",
  ks: "ks",
} as const;

export const ZDROJE_PRIJEMKY = {
  faktura: "Faktúra",
  pociatocny_stav: "Počiatočný stav",
  ine: "Iné",
} as const;

export const STAVY_DAVOK = {
  rozpracovana: "Rozpracovaná",
  caka_na_labak: "Čaká na labák",
  schvalena: "Schválená",
  zamietnuta: "Zamietnutá",
} as const;

export const ZMENY = {
  ranna: "Ranná",
  poobedna: "Poobedná",
  nocna: "Nočná",
} as const;

export const VERDIKTY = {
  schvalene: "Schválené",
  zamietnute: "Zamietnuté",
} as const;

export const STAVY_PRIKAZOV = {
  nova: "Nový",
  vo_vyrobe: "Vo výrobe",
  dokoncena: "Dokončený",
  zrusena: "Zrušený",
} as const;

export const VETVY_PRIPRAVY = {
  barwell: "Barwell",
  sekanie: "Sekanie",
} as const;

export const ROLY = {
  admin: "Administrátor / konateľ",
  ekonom: "Ekonóm / back-office",
  majster_valcovne: "Majster valcovne",
  laborant: "Laborant",
  majster_lisovne: "Majster lisovne",
} as const;

export type KategoriaFaktury = keyof typeof KATEGORIE_FAKTUR;
export type StavFaktury = keyof typeof STAVY_FAKTUR;
export type KategoriaMaterialu = keyof typeof KATEGORIE_MATERIALOV;
export type MernaJednotka = keyof typeof MERNE_JEDNOTKY;
export type StavDavky = keyof typeof STAVY_DAVOK;
export type Zmena = keyof typeof ZMENY;
export type Verdikt = keyof typeof VERDIKTY;
export type StavPrikazu = keyof typeof STAVY_PRIKAZOV;
export type VetvaPripravy = keyof typeof VETVY_PRIPRAVY;
export type UserRole = keyof typeof ROLY;
