# Import číselníkov — šablóny CSV

Tieto 4 súbory sú šablóny na hromadné naplnenie systému BAMIPA MES z Excelu.
Do každého súboru doplň reálne dáta (vzorové riadky prepíš alebo zmaž),
hlavičkový riadok **nechaj tak, ako je**. Hotové súbory nahrá admin
v systéme na stránke **Číselníky → Import**.

## Ako uložiť z Excelu

1. Otvor šablónu v Exceli, doplň riadky.
2. **Súbor → Uložiť ako → typ „CSV UTF-8 (oddelený čiarkami)"**.
3. Nič viac netreba — systém si poradí s bodkočiarkou aj čiarkou ako
   oddeľovačom a s desatinnou čiarkou (napr. `65,5`).

## Poradie importu (dôležité!)

Súbory sa importujú v tomto poradí, lebo na seba odkazujú:

1. **1-dodavatelia.csv** — dodávatelia
2. **2-materialy.csv** — materiály (môžu odkazovať na dodávateľov)
3. **3-receptury.csv** — receptúry zmesí (odkazujú na materiály)
4. **4-artikle.csv** — artikle podošiev (odkazujú na zmesi)

Systém pri nahratí najprv všetko **skontroluje a ukáže zoznam chýb**
(nič sa nezapíše). Až po kontrole bez chýb sa import potvrdí.

Ako sa spoznajú už existujúce záznamy: materiály, zmesi a artikle **podľa
kódu**, dodávatelia **podľa IČO** (ak je vyplnené), inak podľa názvu.
Predvolene sa existujúce záznamy **neprepisujú** — v prehľade sa ukážu ako
„preskočené". Ak admin pri importe zaškrtne **„Aktualizovať existujúce
záznamy"**, vyplnené políčka sa prepíšu hodnotami zo súboru (prázdne políčko
nič nemaže) a receptúram vznikne **nová verzia** — staré verzie ostávajú.

---

## 1-dodavatelia.csv

| Stĺpec | Povinný | Popis |
|---|---|---|
| `nazov` | ✅ | Obchodné meno dodávateľa |
| `ico` | — | IČO — odporúčame vyplniť, slúži na rozpoznanie už existujúceho dodávateľa |
| `dic` | — | DIČ |
| `ic_dph` | — | IČ DPH (napr. `SK2021234567`) |
| `adresa` | — | Adresa v jednom riadku |
| `email` | — | Kontaktný e-mail |
| `telefon` | — | Telefón |
| `poznamka` | — | Ľubovoľná poznámka |

## 2-materialy.csv

| Stĺpec | Povinný | Popis |
|---|---|---|
| `kod` | ✅ | Jedinečný kód materiálu (napr. `SBR-1502`) |
| `nazov` | ✅ | Názov materiálu |
| `mj` | ✅ | Merná jednotka: `kg`, `l` alebo `ks` |
| `kategoria` | ✅ | Jedna z: `kaucuk`, `plnivo`, `olej`, `chemikalia`, `obalovy_material`, `ine` |
| `min_zasoba` | — | Minimálna zásoba v MJ, desatinná čiarka (napr. `500` alebo `12,5`) |
| `predvoleni_dodavatelia` | — | Názvy (alebo IČO) dodávateľov oddelené zvislou čiarou `\|` — musia už existovať |
| `poznamka` | — | Ľubovoľná poznámka |

**Pozor:** materiály, ktoré budú v receptúrach, musia mať `mj` = `kg`
(receptúry sa zadávajú v kg na dávku).

## 3-receptury.csv

Jeden riadok = **jedna položka receptúry**. Riadky tej istej zmesi idú
pod sebou; údaje o zmesi (`nazov_zmesi`, `standardna_davka_kg`,
`tech_poznamka`) stačí vyplniť v prvom riadku zmesi.

| Stĺpec | Povinný | Popis |
|---|---|---|
| `kod_zmesi` | ✅ | Kód zmesi (napr. `A-01`) — v každom riadku |
| `nazov_zmesi` | ✅ (1. riadok zmesi) | Názov zmesi |
| `standardna_davka_kg` | ✅ (1. riadok zmesi) | Veľkosť štandardnej dávky v kg |
| `tech_poznamka` | — | Technologická poznámka k receptúre |
| `kod_materialu` | ✅ | Kód materiálu z 2-materialy.csv (musí existovať a byť v kg) |
| `mnozstvo_kg` | ✅ | Množstvo v kg na štandardnú dávku, desatinná čiarka, max. 3 des. miesta |
| `poradie` | — | Poradie položky v receptúre (ak chýba, platí poradie riadkov) |

Import vytvorí **novú verziu** receptúry — existujúce verzie sa nikdy
neprepisujú (každá výrobná dávka si pamätá svoju verziu).

## 4-artikle.csv

| Stĺpec | Povinný | Popis |
|---|---|---|
| `kod` | ✅ | Jedinečný kód artikla (napr. `TREK-01`) |
| `nazov` | ✅ | Názov modelu podošvy |
| `kod_zmesi` | ✅ | Kód zmesi z 3-receptury.csv (musí existovať) |
| `norma_kg_na_par` | ✅ | Norma spotreby zmesi na pár v kg, desatinná čiarka (napr. `0,450`) |
| `cielovy_cas_cyklu_s` | — | Cieľový čas lisovacieho cyklu v sekundách (celé číslo) |
| `predajna_cena_eur` | — | Predajná cena za pár v €, desatinná čiarka (napr. `4,20`) |

---

## Časté chyby, ktoré kontrola odhalí

- duplicitný kód v súbore alebo kód, ktorý už v systéme existuje,
- neznáma merná jednotka alebo kategória (preklep),
- chýbajúce povinné pole,
- receptúra odkazuje na materiál, ktorý neexistuje alebo nie je v kg,
- artikel odkazuje na zmes, ktorá neexistuje,
- zle zapísané číslo (napr. dve desatinné čiarky).

Pri každej chybe systém ukáže **číslo riadku, stĺpec a popis po slovensky** —
súbor oprav v Exceli a nahraj znova.
