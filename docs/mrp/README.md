# Export došlých faktúr do MRP (XML 2.0)

Referencie k F3 exportu prijatých faktúr do účtovného softvéru MRP (D3).
Účtovníčka používa **MRP Vizuálny účtovný systém**; formát XML 2.0 je spoločný
s MRP-K/S. Od 1.1.2025 MRP iné importné formáty (XML 1.0, TXT, DBF) nepodporuje.

## Súbory

- `mrp_xml_2_0_doc_fp.txt` — oficiálny popis štruktúry agendy *Faktury přijaté*
  (`IncomingInvoices`), prekódovaný z Windows-1250 do UTF-8. Zdroj: faq.mrp.sk,
  stav k 24.2.2025 (MRP-K/S 6.75, Vizuálny 8.90.1149).
- `MRPFP.xsd` — XSD schéma importného súboru. Validácia počas vývoja:
  `xmllint --noout --schema docs/mrp/MRPFP.xsd subor.xml`

## Zdroje (faq.mrp.sk)

- Výmena faktúr XML 2.0 — Vizuálny systém: https://faq.mrp.sk/Vymena-faktur-v-elektronickej-forme-vo-formate-XML-ver-2-0-Vizualny-system-643
- Výmena faktúr XML 2.0 — MRP-K/S: https://faq.mrp.sk/Uctovny-system-K-S-Podvojne-uctovnictvo/Vymena-faktur-v-elektronickej-forme-vo-formate-XML-ver-2-0-MRP-K-S-644
- Export/Import dát (dokumentácia + vzory): https://faq.mrp.sk/Vizualny-system-Jednoduche-uctovnictvo/Export-Import-dat-Vizualny-system-223

## Postup importu pre účtovníčku (Vizuálny systém)

1. V BAMIPA_MES: Faktúry → **Export do MRP** → zvoliť mesiac → stiahne sa XML.
2. V MRP: **Údržba dát → Export/Import dát**, typ **XML 2.0**, vybrať priečinok
   so stiahnutým súborom.
3. Pri prvom importe založiť **importný profil** (číselný rad prijatých faktúr,
   predvolený typ DPH).
4. Dodávateľov MRP páruje podľa IČO; nových doplní do adresára (voľba
   „Import adries").

## Poznámky k nášmu exportu

- `DocumentNumber` negenerujeme — číslo pridelí MRP z číselného radu profilu.
  Číslo dodávateľskej faktúry ide do `OriginalDocumentNumber` + variabilný
  symbol (číslice z čísla faktúry).
- DPH: evidujeme len celkové sumy, sadzba sa odvodzuje z pomeru DPH/základ
  (23 % základná, 19 %/5 % znížená, 0 → oslobodené). Faktúru so zmiešanými
  sadzbami export odmietne — treba ju exportovať po rozpísaní, alebo zadať
  do MRP ručne.
- Položky sa exportujú ako finančné riadky (Quantity=1, cena = suma riadku
  bez DPH); skutočné množstvo a MJ sú v texte položky.
