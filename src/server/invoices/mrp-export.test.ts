// F3: export došlých faktúr do MRP XML 2.0 (agenda IncomingInvoices).
// generujMrpXml sa testuje proti RUČNE zostavenému očakávanému súboru
// podľa oficiálnej špecifikácie (docs/mrp/mrp_xml_2_0_doc_fp.txt).
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import * as schema from "@/db/schema";
import { createTestDb, seedZaklad, type TestDb } from "@/test/pglite";
import {
  exportujFakturyPreMrp,
  generujMrpXml,
  nacitajFakturyPreMrp,
  type MrpFaktura,
} from "./mrp-export";

// ─────────────────────────────────────────────── generujMrpXml (čistá) ──

function faktura(overrides: Partial<MrpFaktura> = {}): MrpFaktura {
  return {
    invoiceNumber: "FA-2026-100",
    issueDate: "2026-07-01",
    deliveryDate: "2026-07-03",
    dueDate: "2026-08-15",
    totalNetCents: 10_000,
    totalVatCents: 2_300,
    note: null,
    dodavatel: {
      name: "Gumex Slovakia s.r.o.",
      ico: "12345678",
      dic: "2020123456",
      icDph: "SK2020123456",
      email: "faktury@gumex.sk",
      phone: "+421 905 111 222",
    },
    polozky: [
      { description: "Sadze N330", qty: "250.000", unit: "kg", totalNetCents: 6_000 },
      { description: "Doprava", qty: null, unit: null, totalNetCents: 4_000 },
    ],
    ...overrides,
  };
}

describe("generujMrpXml — očakávaný súbor podľa špecifikácie", () => {
  test("dve faktúry (23 % s položkami + oslobodená minimálna) — presný XML", () => {
    const bezna = faktura({ note: "Objednávka č. 42" });
    const oslobodena = faktura({
      invoiceNumber: "2026/055",
      issueDate: null,
      deliveryDate: null,
      dueDate: "2026-08-01",
      totalNetCents: 5_000,
      totalVatCents: 0,
      dodavatel: {
        name: "Prenajímateľ SK",
        ico: null,
        dic: null,
        icDph: null,
        email: null,
        phone: null,
      },
      polozky: [
        { description: "Nájomné 7/2026", qty: null, unit: null, totalNetCents: 5_000 },
      ],
    });

    const ocakavane = `<?xml version="1.0" encoding="UTF-8"?>
<MRPKSData>
  <IncomingInvoices>
    <Invoice>
      <OriginalDocumentNumber>FA-2026-100</OriginalDocumentNumber>
      <VariableSymbol>2026100</VariableSymbol>
      <IssueDate>2026-07-01</IssueDate>
      <DeliveryDate>2026-07-03</DeliveryDate>
      <PaymentDueDate>2026-08-15</PaymentDueDate>
      <CurrencyCode>EUR</CurrencyCode>
      <ValuesWithTax>F</ValuesWithTax>
      <BaseTaxRateAmount>100.00</BaseTaxRateAmount>
      <BaseTaxRateTax>23.00</BaseTaxRateTax>
      <Note>Objednávka č. 42</Note>
      <Company>
        <CompanyId>12345678</CompanyId>
        <Name>Gumex Slovakia s.r.o.</Name>
        <VatNumber>2020123456</VatNumber>
        <VatNumberSK>SK2020123456</VatNumberSK>
        <Email>faktury@gumex.sk</Email>
        <Phone>+421 905 111 222</Phone>
      </Company>
      <Items>
        <Item>
          <Description>Sadze N330 — 250 kg</Description>
          <RowType>1</RowType>
          <Quantity>1</Quantity>
          <UnitPrice>60.00</UnitPrice>
          <TaxPercent>23</TaxPercent>
        </Item>
        <Item>
          <Description>Doprava</Description>
          <RowType>1</RowType>
          <Quantity>1</Quantity>
          <UnitPrice>40.00</UnitPrice>
          <TaxPercent>23</TaxPercent>
        </Item>
      </Items>
      <ImportParams>
        <ReCalcTotals>1</ReCalcTotals>
      </ImportParams>
    </Invoice>
    <Invoice>
      <OriginalDocumentNumber>2026/055</OriginalDocumentNumber>
      <VariableSymbol>2026055</VariableSymbol>
      <PaymentDueDate>2026-08-01</PaymentDueDate>
      <CurrencyCode>EUR</CurrencyCode>
      <ValuesWithTax>F</ValuesWithTax>
      <ZeroTaxRateAmount>50.00</ZeroTaxRateAmount>
      <Company>
        <Name>Prenajímateľ SK</Name>
      </Company>
      <Items>
        <Item>
          <Description>Nájomné 7/2026</Description>
          <RowType>1</RowType>
          <Quantity>1</Quantity>
          <UnitPrice>50.00</UnitPrice>
          <TaxPercent>0</TaxPercent>
        </Item>
      </Items>
      <ImportParams>
        <ReCalcTotals>1</ReCalcTotals>
      </ImportParams>
    </Invoice>
  </IncomingInvoices>
</MRPKSData>
`;

    expect(generujMrpXml([bezna, oslobodena])).toBe(ocakavane);
  });

  test("znížená sadzba 19 % ide do Reduced polí", () => {
    const xml = generujMrpXml([
      faktura({ totalNetCents: 10_000, totalVatCents: 1_900 }),
    ]);
    expect(xml).toContain("<ReducedTaxRateAmount>100.00</ReducedTaxRateAmount>");
    expect(xml).toContain("<ReducedTaxRateTax>19.00</ReducedTaxRateTax>");
    expect(xml).toContain("<TaxPercent>19</TaxPercent>");
    expect(xml).not.toContain("BaseTaxRateAmount");
  });

  test("znížená sadzba 5 % ide do Reduced polí", () => {
    const xml = generujMrpXml([
      faktura({ totalNetCents: 10_000, totalVatCents: 500 }),
    ]);
    expect(xml).toContain("<ReducedTaxRateAmount>100.00</ReducedTaxRateAmount>");
    expect(xml).toContain("<ReducedTaxRateTax>5.00</ReducedTaxRateTax>");
  });

  test("centové zaokrúhlenie: odchýlka ±1 cent od sadzby sa toleruje", () => {
    // 23 % z 100,01 € = 23,0023 € → uložených 23,01 € (odchýlka 1 cent nahor).
    const xml = generujMrpXml([
      faktura({ totalNetCents: 10_001, totalVatCents: 2_301 }),
    ]);
    // Hlavička nesie NAŠE evidované sumy, nie prepočet.
    expect(xml).toContain("<BaseTaxRateAmount>100.01</BaseTaxRateAmount>");
    expect(xml).toContain("<BaseTaxRateTax>23.01</BaseTaxRateTax>");
  });

  test("DPH mimo sadzieb 23/19/5 (zmiešané sadzby) → slovenská chyba s číslom faktúry", () => {
    expect(() =>
      generujMrpXml([
        faktura({ invoiceNumber: "FA-2026-999", totalVatCents: 1_500 }),
      ]),
    ).toThrow(/FA-2026-999.*sadzb/);
  });

  test("XML escaping + znaky zakázané schémou (' # | tab) → medzera", () => {
    const xml = generujMrpXml([
      faktura({
        dodavatel: {
          ...faktura().dodavatel,
          name: "Kováč & Syn's #1 <viac|menej>",
        },
      }),
    ]);
    expect(xml).toContain(
      "<Name>Kováč &amp; Syn s  1 &lt;viac menej&gt;</Name>",
    );
  });

  test("znaky mimo Windows-1250 → '?' (spec: DB MRP beží vo win-1250)", () => {
    const xml = generujMrpXml([
      faktura({
        polozky: [
          { description: "Teplomer Ω 🔥", qty: null, unit: null, totalNetCents: 10_000 },
        ],
      }),
    ]);
    expect(xml).toContain("<Description>Teplomer ? ?</Description>");
  });

  test("orez dĺžok: názov firmy max 50 znakov", () => {
    const dlhy = "A".repeat(60);
    const xml = generujMrpXml([
      faktura({ dodavatel: { ...faktura().dodavatel, name: dlhy } }),
    ]);
    expect(xml).toContain(`<Name>${"A".repeat(50)}</Name>`);
  });

  test("OriginalDocumentNumber sa reže na 32 znakov (XSD maxLength, prísnejšie než txt spec)", () => {
    const xml = generujMrpXml([
      faktura({ invoiceNumber: "FAKTURA-ZALOHOVA-2026-0000000123-OPRAVA-A" }),
    ]);
    expect(xml).toContain(
      "<OriginalDocumentNumber>FAKTURA-ZALOHOVA-2026-0000000123</OriginalDocumentNumber>",
    );
  });

  test("orez popisu položky zachová množstvo — reže sa text, nie sufix", () => {
    const xml = generujMrpXml([
      faktura({
        polozky: [
          { description: "A".repeat(95), qty: "250.000", unit: "kg", totalNetCents: 10_000 },
        ],
      }),
    ]);
    // sufix „ — 250 kg" (9 znakov) ostáva celý, popis sa reže na 91.
    expect(xml).toContain(`<Description>${"A".repeat(91)} — 250 kg</Description>`);
  });

  test("záporné sumy (dobropis) sa odmietnu slovenskou chybou", () => {
    expect(() =>
      generujMrpXml([
        faktura({
          invoiceNumber: "DOB-2026-001",
          totalNetCents: -10_000,
          totalVatCents: -2_300,
        }),
      ]),
    ).toThrow(/DOB-2026-001.*dobropis/);
  });

  test("variabilný symbol: bez číslic sa vynechá, dlhý sa reže na posledných 10", () => {
    const bezCislic = generujMrpXml([faktura({ invoiceNumber: "ABC-X" })]);
    expect(bezCislic).not.toContain("VariableSymbol");

    const dlhy = generujMrpXml([faktura({ invoiceNumber: "9912345678901" })]);
    expect(dlhy).toContain("<VariableSymbol>2345678901</VariableSymbol>");
  });
});

// ───────────────────────────────────── výber a značenie (PGlite, reálna DB) ──

let db: TestDb;
let zaklad: Awaited<ReturnType<typeof seedZaklad>>;

beforeEach(async () => {
  ({ db } = await createTestDb());
  zaklad = await seedZaklad(db);
});

async function vlozFakturu(opts: {
  cislo: string;
  deliveryDate?: string | null;
  issueDate?: string | null;
  dueDate: string;
  mrpExportedAt?: Date | null;
}) {
  const [f] = await db
    .insert(schema.invoices)
    .values({
      supplierId: zaklad.dodavatel.id,
      invoiceNumber: opts.cislo,
      issueDate: opts.issueDate ?? null,
      deliveryDate: opts.deliveryDate ?? null,
      dueDate: opts.dueDate,
      totalNetCents: 10_000,
      totalVatCents: 2_300,
      totalGrossCents: 12_300,
      mrpExportedAt: opts.mrpExportedAt ?? null,
      createdBy: zaklad.adminId,
    })
    .returning();
  await db.insert(schema.invoiceItems).values({
    invoiceId: f.id,
    description: "Položka",
    category: "material",
    costCenterId: zaklad.stredisko.id,
    totalNetCents: 10_000,
    createdBy: zaklad.adminId,
  });
  return f;
}

describe("nacitajFakturyPreMrp — nákladový mesiac COALESCE(delivery, issue, due)", () => {
  test("vyberá mesiac podľa nákladového dátumu, defaultne len neexportované, radí podľa čísla", async () => {
    await vlozFakturu({ cislo: "FA-C", deliveryDate: "2026-07-03", dueDate: "2026-08-15" });
    await vlozFakturu({ cislo: "FA-A", issueDate: "2026-07-30", dueDate: "2026-09-01" });
    await vlozFakturu({ cislo: "FA-JUN", issueDate: "2026-06-15", dueDate: "2026-07-10" }); // jún — mimo
    await vlozFakturu({ cislo: "FA-DUE", dueDate: "2026-07-20" }); // len splatnosť → júl
    await vlozFakturu({
      cislo: "FA-EXP",
      deliveryDate: "2026-07-05",
      dueDate: "2026-08-01",
      mrpExportedAt: new Date("2026-08-02T10:00:00Z"),
    });

    const vysledok = await nacitajFakturyPreMrp(db, { mesiac: "2026-07" });
    expect(vysledok.map((f) => f.invoiceNumber)).toEqual(["FA-A", "FA-C", "FA-DUE"]);
    expect(vysledok[0].dodavatel.name).toBe("Test dodávateľ s.r.o.");
    expect(vysledok[0].polozky).toHaveLength(1);
    expect(vysledok[0].polozky[0].description).toBe("Položka");
  });

  test("ajExportovane zahrnie aj už exportované faktúry", async () => {
    await vlozFakturu({ cislo: "FA-C", deliveryDate: "2026-07-03", dueDate: "2026-08-15" });
    await vlozFakturu({
      cislo: "FA-EXP",
      deliveryDate: "2026-07-05",
      dueDate: "2026-08-01",
      mrpExportedAt: new Date("2026-08-02T10:00:00Z"),
    });

    const vysledok = await nacitajFakturyPreMrp(db, {
      mesiac: "2026-07",
      ajExportovane: true,
    });
    expect(vysledok.map((f) => f.invoiceNumber)).toEqual(["FA-C", "FA-EXP"]);
  });

  test("zmazané faktúry sa nevyberajú", async () => {
    const f = await vlozFakturu({ cislo: "FA-DEL", deliveryDate: "2026-07-03", dueDate: "2026-08-15" });
    await db
      .update(schema.invoices)
      .set({ deletedAt: new Date() })
      .where(eq(schema.invoices.id, f.id));

    expect(await nacitajFakturyPreMrp(db, { mesiac: "2026-07" })).toEqual([]);
  });

  test("neplatný formát mesiaca → slovenská chyba", async () => {
    await expect(nacitajFakturyPreMrp(db, { mesiac: "júl 2026" })).rejects.toThrow(
      /mesiac/i,
    );
  });
});

describe("exportujFakturyPreMrp — atomický export + značenie", () => {
  const kedy = new Date("2026-08-03T08:00:00Z");

  test("vráti XML, označí faktúry a zapíše audit_log; druhé volanie už nemá čo exportovať", async () => {
    const f = await vlozFakturu({ cislo: "FA-C", deliveryDate: "2026-07-03", dueDate: "2026-08-15" });
    await vlozFakturu({ cislo: "FA-A", issueDate: "2026-07-30", dueDate: "2026-09-01" });

    const vysledok = await exportujFakturyPreMrp(db, {
      mesiac: "2026-07",
      userId: zaklad.adminId,
      kedy,
    });
    expect(vysledok?.pocet).toBe(2);
    expect(vysledok?.xml).toContain("<OriginalDocumentNumber>FA-A</OriginalDocumentNumber>");
    expect(vysledok?.xml).toContain("<OriginalDocumentNumber>FA-C</OriginalDocumentNumber>");

    const [po] = await db
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.id, f.id));
    expect(po.mrpExportedAt?.toISOString()).toBe(kedy.toISOString());

    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.recordId, f.id));
    expect(audit.some((a) => a.action === "mrp_export")).toBe(true);

    // Atomický claim: druhý export toho istého mesiaca nemá kandidátov.
    expect(
      await exportujFakturyPreMrp(db, { mesiac: "2026-07", userId: zaklad.adminId, kedy }),
    ).toBeNull();
  });

  test("ajExportovane zopakuje export už označených faktúr", async () => {
    await vlozFakturu({
      cislo: "FA-EXP",
      deliveryDate: "2026-07-05",
      dueDate: "2026-08-01",
      mrpExportedAt: new Date("2026-08-02T10:00:00Z"),
    });

    const vysledok = await exportujFakturyPreMrp(db, {
      mesiac: "2026-07",
      ajExportovane: true,
      userId: zaklad.adminId,
      kedy,
    });
    expect(vysledok?.pocet).toBe(1);
    expect(vysledok?.xml).toContain("<OriginalDocumentNumber>FA-EXP</OriginalDocumentNumber>");
  });

  test("chyba generovania (dobropis) vráti celú transakciu — faktúra ostane neoznačená", async () => {
    const f = await vlozFakturu({ cislo: "FA-DOB", deliveryDate: "2026-07-03", dueDate: "2026-08-15" });
    await db
      .update(schema.invoices)
      .set({ totalNetCents: -10_000, totalVatCents: -2_300, totalGrossCents: -12_300 })
      .where(eq(schema.invoices.id, f.id));

    await expect(
      exportujFakturyPreMrp(db, { mesiac: "2026-07", userId: zaklad.adminId, kedy }),
    ).rejects.toThrow(/dobropis/);

    const [po] = await db
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.id, f.id));
    expect(po.mrpExportedAt).toBeNull();
  });

  test("prejde aj v uzavretom mesiaci (period-lock blokuje len nákladové polia)", async () => {
    const f = await vlozFakturu({ cislo: "FA-C", deliveryDate: "2026-07-03", dueDate: "2026-08-15" });
    await db.insert(schema.periodCloses).values({
      period: "2026-07-01",
      createdBy: zaklad.adminId,
    });

    const vysledok = await exportujFakturyPreMrp(db, {
      mesiac: "2026-07",
      userId: zaklad.adminId,
      kedy,
    });
    expect(vysledok?.pocet).toBe(1);

    const [po] = await db
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.id, f.id));
    expect(po.mrpExportedAt).not.toBeNull();
  });
});
