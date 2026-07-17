// F3: export došlých faktúr do MRP XML 2.0 — agenda IncomingInvoices.
// Štruktúra podľa oficiálnej špecifikácie v docs/mrp/ (faq.mrp.sk, 24.2.2025).
// Vzor zo service.ts: DI DbClient, slovenské doménové chyby, audit_log;
// „kedy" sa odovzdáva parametrom — žiadne Date.now v logike.
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DbClient } from "@/db";
import * as schema from "@/db/schema";

export type MrpDodavatel = {
  name: string;
  ico: string | null;
  dic: string | null;
  icDph: string | null;
  email: string | null;
  phone: string | null;
};

export type MrpPolozka = {
  description: string;
  qty: string | null;
  unit: string | null;
  totalNetCents: number;
};

export type MrpFaktura = {
  invoiceNumber: string;
  issueDate: string | null;
  deliveryDate: string | null;
  dueDate: string;
  totalNetCents: number;
  totalVatCents: number;
  note: string | null;
  dodavatel: MrpDodavatel;
  polozky: MrpPolozka[];
};

export type FakturaPreMrp = MrpFaktura & { id: string };

// ────────────────────────────────────────────── formátovanie a sanitizácia ──

/** Centy (integer) → desatinný reťazec s bodkou („12345" → „123.45"). Bez floatov. */
function centyNaDec(cents: number): string {
  const znamienko = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${znamienko}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Množstvo z numeric stringu bez koncových núl („250.000" → „250"). */
function formatMnozstvo(qty: string): string {
  return qty.includes(".") ? qty.replace(/0+$/, "").replace(/\.$/, "") : qty;
}

// Znaky Windows-1250 nad ASCII (spec: DB MRP beží vo win-1250, XML je UTF-8,
// ale hodnoty nesmú obsahovať znaky mimo win-1250). Vrátane NBSP a SHY.
const WIN1250_NAD_ASCII =
  "€‚„…†‡‰Š‹ŚŤŽŹ‘’“”•–—™š›śťžź ˇ˘Ł¤Ą¦§¨©Ş«¬­®Ż°±˛ł´µ¶·¸ąş»Ľ˝ľżŔÁÂĂÄĹĆÇČÉĘËĚÍÎĎĐŃŇÓÔŐÖ×ŘŮÚŰÜÝŢßŕáâăäĺćçčéęëěíîďđńňóôőö÷řůúűüýţ˙";

/**
 * XSD zakazuje ' # | a tab (pattern [^'#|\t]*) → medzera; znaky mimo
 * Windows-1250 → „?". Iteruje sa po code pointoch (emoji = jeden „?").
 */
function sanitizuj(text: string): string {
  let vystup = "";
  for (const znak of text.replace(/['#|\t]/g, " ")) {
    const cp = znak.codePointAt(0) ?? 0;
    if (
      (cp >= 0x20 && cp <= 0x7e) ||
      znak === "\n" ||
      znak === "\r" ||
      WIN1250_NAD_ASCII.includes(znak)
    ) {
      vystup += znak;
    } else {
      vystup += "?";
    }
  }
  return vystup;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Element s hodnotou; null/prázdna hodnota → element sa vynechá. */
function el(
  odsadenie: string,
  tag: string,
  hodnota: string | null | undefined,
  maxDlzka?: number,
): string | null {
  if (hodnota == null || hodnota === "") return null;
  let v = sanitizuj(hodnota);
  if (maxDlzka !== undefined) v = v.slice(0, maxDlzka);
  return `${odsadenie}<${tag}>${escapeXml(v)}</${tag}>`;
}

// ─────────────────────────────────────────────────────────── DPH z pomeru ──

// SK sadzby DPH platné od 1.1.2025: základná 23 %, znížené 19 % a 5 %.
const ZAKLADNA_SADZBA = 23;
const ZNIZENE_SADZBY = [19, 5];

/**
 * Odvodí jednu sadzbu DPH z pomeru DPH/základ (tolerancia ±1 cent na
 * dokladové zaokrúhlenie). 0 = oslobodené. Nesedí → doménová chyba
 * (zmiešané sadzby treba rozpísať alebo zadať do MRP ručne).
 */
function urciSadzbu(f: MrpFaktura): number {
  if (f.totalVatCents === 0) return 0;
  for (const sadzba of [ZAKLADNA_SADZBA, ...ZNIZENE_SADZBY]) {
    const ocakavane = Math.round((f.totalNetCents * sadzba) / 100);
    if (Math.abs(f.totalVatCents - ocakavane) <= 1) return sadzba;
  }
  throw new Error(
    `Faktúru ${f.invoiceNumber} nemožno exportovať do MRP: DPH ` +
      `${centyNaDec(f.totalVatCents)} € zo základu ${centyNaDec(f.totalNetCents)} € ` +
      `nezodpovedá jednej sadzbe (23/19/5 %) — pravdepodobne zmiešané sadzby. ` +
      `Rozpíš faktúru podľa sadzieb alebo ju zadaj do MRP ručne.`,
  );
}

// ────────────────────────────────────────────────────────────── generátor ──

function variabilnySymbol(invoiceNumber: string): string | null {
  const cislice = invoiceNumber.replace(/\D/g, "");
  return cislice === "" ? null : cislice.slice(-10);
}

function polozkaXml(p: MrpPolozka, sadzba: number): string[] {
  const mnozstvo =
    p.qty === null
      ? ""
      : ` — ${formatMnozstvo(p.qty)}${p.unit ? ` ${p.unit}` : ""}`;
  // Orez na limit 100 reže text popisu, sufix s množstvom ostáva vždy celý
  // (odrezané „250 kg" → „25" by bolo fakticky nepravdivé, nie len skrátené).
  const popis = `${p.description.slice(0, 100 - mnozstvo.length)}${mnozstvo}`;
  return [
    "        <Item>",
    el("          ", "Description", popis, 100),
    el("          ", "RowType", "1"),
    el("          ", "Quantity", "1"),
    el("          ", "UnitPrice", centyNaDec(p.totalNetCents)),
    el("          ", "TaxPercent", String(sadzba)),
    "        </Item>",
  ].filter((r): r is string => r !== null);
}

function fakturaXml(f: MrpFaktura): string[] {
  if (f.totalNetCents < 0 || f.totalVatCents < 0) {
    throw new Error(
      `Faktúru ${f.invoiceNumber} nemožno exportovať do MRP: záporné sumy — ` +
        `dobropis zatiaľ do MRP zadávame ručne (potrebuje DocType a väzbu na ` +
        `pôvodný doklad).`,
    );
  }
  const sadzba = urciSadzbu(f);
  const o = "      ";

  const sumy: (string | null)[] = [];
  if (sadzba === 0) {
    sumy.push(el(o, "ZeroTaxRateAmount", centyNaDec(f.totalNetCents)));
  } else if (sadzba === ZAKLADNA_SADZBA) {
    sumy.push(el(o, "BaseTaxRateAmount", centyNaDec(f.totalNetCents)));
    sumy.push(el(o, "BaseTaxRateTax", centyNaDec(f.totalVatCents)));
  } else {
    sumy.push(el(o, "ReducedTaxRateAmount", centyNaDec(f.totalNetCents)));
    sumy.push(el(o, "ReducedTaxRateTax", centyNaDec(f.totalVatCents)));
  }

  const d = f.dodavatel;
  const riadky: (string | null)[] = [
    "    <Invoice>",
    // XSD (MRPFP.xsd) povoľuje max 32 znakov — prísnejšie než txt spec (50).
    el(o, "OriginalDocumentNumber", f.invoiceNumber, 32),
    el(o, "VariableSymbol", variabilnySymbol(f.invoiceNumber), 10),
    el(o, "IssueDate", f.issueDate),
    el(o, "DeliveryDate", f.deliveryDate),
    el(o, "PaymentDueDate", f.dueDate),
    el(o, "CurrencyCode", "EUR"),
    el(o, "ValuesWithTax", "F"),
    ...sumy,
    el(o, "Note", f.note, 32_768),
    "      <Company>",
    el("        ", "CompanyId", d.ico, 12),
    el("        ", "Name", d.name, 50),
    el("        ", "VatNumber", d.dic, 17),
    el("        ", "VatNumberSK", d.icDph, 14),
    el("        ", "Email", d.email, 256),
    el("        ", "Phone", d.phone, 30),
    "      </Company>",
    "      <Items>",
    ...f.polozky.flatMap((p) => polozkaXml(p, sadzba)),
    "      </Items>",
    // Nepřepočítat: MRP nesmie pri importe prepočítať hlavičkové sumy —
    // musia sedieť na cent s našou evidenciou (aj pri tolerancii ±1 cent).
    "      <ImportParams>",
    el("        ", "ReCalcTotals", "1"),
    "      </ImportParams>",
    "    </Invoice>",
  ];
  return riadky.filter((r): r is string => r !== null);
}

/** Čistá funkcia: faktúry → importný súbor MRP XML 2.0 (IncomingInvoices). */
export function generujMrpXml(faktury: MrpFaktura[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<MRPKSData>",
    "  <IncomingInvoices>",
    ...faktury.flatMap(fakturaXml),
    "  </IncomingInvoices>",
    "</MRPKSData>",
    "",
  ].join("\n");
}

// ─────────────────────────────────────────────────────── výber a značenie ──

/** Validácia RRRR-MM → prvý deň mesiaca. */
function zaciatokMesiaca(mesiac: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mesiac)) {
    throw new Error(`Neplatný mesiac „${mesiac}" — očakávam formát RRRR-MM.`);
  }
  return `${mesiac}-01`;
}

/**
 * Podmienky výberu: NÁKLADOVÝ mesiac COALESCE(delivery_date, issue_date,
 * due_date) — rovnaká logika ako uzávierka (D2); defaultne len neexportované.
 */
function podmienkyExportu(zaciatok: string, ajExportovane: boolean | undefined) {
  const nakladovyDatum = sql`COALESCE(${schema.invoices.deliveryDate}, ${schema.invoices.issueDate}, ${schema.invoices.dueDate})`;
  const podmienky = [
    isNull(schema.invoices.deletedAt),
    sql`${nakladovyDatum} >= ${zaciatok}::date`,
    sql`${nakladovyDatum} < (${zaciatok}::date + interval '1 month')`,
  ];
  if (!ajExportovane) {
    podmienky.push(isNull(schema.invoices.mrpExportedAt));
  }
  return podmienky;
}

/** Kompletné dáta faktúr (dodávateľ + položky) podľa id, zoradené podľa čísla. */
async function nacitajFakturyPodlaIds(
  db: DbClient,
  ids: string[],
): Promise<FakturaPreMrp[]> {
  const hlavicky = await db
    .select({
      id: schema.invoices.id,
      invoiceNumber: schema.invoices.invoiceNumber,
      issueDate: schema.invoices.issueDate,
      deliveryDate: schema.invoices.deliveryDate,
      dueDate: schema.invoices.dueDate,
      totalNetCents: schema.invoices.totalNetCents,
      totalVatCents: schema.invoices.totalVatCents,
      note: schema.invoices.note,
      dodavatelName: schema.suppliers.name,
      dodavatelIco: schema.suppliers.ico,
      dodavatelDic: schema.suppliers.dic,
      dodavatelIcDph: schema.suppliers.icDph,
      dodavatelEmail: schema.suppliers.email,
      dodavatelPhone: schema.suppliers.phone,
    })
    .from(schema.invoices)
    .innerJoin(
      schema.suppliers,
      eq(schema.invoices.supplierId, schema.suppliers.id),
    )
    .where(inArray(schema.invoices.id, ids))
    .orderBy(asc(schema.invoices.invoiceNumber));

  if (hlavicky.length === 0) return [];

  const polozky = await db
    .select({
      invoiceId: schema.invoiceItems.invoiceId,
      description: schema.invoiceItems.description,
      qty: schema.invoiceItems.qty,
      unit: schema.invoiceItems.unit,
      totalNetCents: schema.invoiceItems.totalNetCents,
    })
    .from(schema.invoiceItems)
    .where(
      and(
        inArray(
          schema.invoiceItems.invoiceId,
          hlavicky.map((h) => h.id),
        ),
        isNull(schema.invoiceItems.deletedAt),
      ),
    )
    .orderBy(asc(schema.invoiceItems.createdAt), asc(schema.invoiceItems.id));

  const podlaFaktury = new Map<string, MrpPolozka[]>();
  for (const p of polozky) {
    const zoznam = podlaFaktury.get(p.invoiceId) ?? [];
    zoznam.push({
      description: p.description,
      qty: p.qty,
      unit: p.unit,
      totalNetCents: p.totalNetCents,
    });
    podlaFaktury.set(p.invoiceId, zoznam);
  }

  return hlavicky.map((h) => ({
    id: h.id,
    invoiceNumber: h.invoiceNumber,
    issueDate: h.issueDate,
    deliveryDate: h.deliveryDate,
    dueDate: h.dueDate,
    totalNetCents: h.totalNetCents,
    totalVatCents: h.totalVatCents,
    note: h.note,
    dodavatel: {
      name: h.dodavatelName,
      ico: h.dodavatelIco,
      dic: h.dodavatelDic,
      icDph: h.dodavatelIcDph,
      email: h.dodavatelEmail,
      phone: h.dodavatelPhone,
    },
    polozky: podlaFaktury.get(h.id) ?? [],
  }));
}

/** Faktúry na export za mesiac RRRR-MM (náhľad bez značenia). */
export async function nacitajFakturyPreMrp(
  db: DbClient,
  vstup: { mesiac: string; ajExportovane?: boolean },
): Promise<FakturaPreMrp[]> {
  const zaciatok = zaciatokMesiaca(vstup.mesiac);
  const ids = await db
    .select({ id: schema.invoices.id })
    .from(schema.invoices)
    .where(and(...podmienkyExportu(zaciatok, vstup.ajExportovane)));
  return nacitajFakturyPodlaIds(db, ids.map((r) => r.id));
}

/**
 * Atomický export: v JEDNEJ transakcii claimne faktúry mesiaca (UPDATE
 * mrp_exported_at … RETURNING — súbežný druhý export tie isté riadky
 * nedostane), vygeneruje XML a zapíše audit_log. Chyba generovania
 * (napr. dobropis) vráti celú transakciu — nič neostane označené.
 * Period-lock (0007) mrp_exported_at neblokuje — export po uzávierke prejde.
 * Vracia null, keď nie je čo exportovať.
 */
export async function exportujFakturyPreMrp(
  db: DbClient,
  vstup: { mesiac: string; ajExportovane?: boolean; userId: string; kedy: Date },
): Promise<{ xml: string; pocet: number } | null> {
  const zaciatok = zaciatokMesiaca(vstup.mesiac);
  return db.transaction(async (tx) => {
    const claimed = await tx
      .update(schema.invoices)
      .set({ mrpExportedAt: vstup.kedy })
      .where(and(...podmienkyExportu(zaciatok, vstup.ajExportovane)))
      .returning({ id: schema.invoices.id });
    if (claimed.length === 0) return null;

    const faktury = await nacitajFakturyPodlaIds(
      tx,
      claimed.map((r) => r.id),
    );
    const xml = generujMrpXml(faktury);

    await tx.insert(schema.auditLog).values(
      claimed.map((r) => ({
        tableName: "invoices",
        recordId: r.id,
        action: "mrp_export",
        changedBy: vstup.userId,
        changes: { mrpExportedAt: vstup.kedy.toISOString() },
      })),
    );

    return { xml, pocet: claimed.length };
  });
}
