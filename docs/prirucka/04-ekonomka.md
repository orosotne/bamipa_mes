# Príručka — Ekonómka (rola „Ekonóm / back-office")

## Čo vidíš po prihlásení

Pristaneš na **Prehľade**: faktúry po splatnosti (upozornenie hneď hore, bez klikania), výrobné KPI, cash-flow kalendár splatných faktúr, náklad na kg zmesi a na pár v čase, marže, top materiály a **Exporty pre účtovníčku (CSV)**. V ľavom paneli máš: **Prehľad, Faktúry, Dodávatelia, Sklad, Kalkulácie**.

## Denné úkony

### 1. Zaevidovať došlú faktúru

1. **Faktúry** → **Nová faktúra**.
2. **Hlavička faktúry**: Dodávateľ, Číslo faktúry, Dátum vystavenia, Dátum dodania, **Dátum splatnosti**, **Suma bez DPH (€)**, **DPH (€)** — suma s DPH sa dopočíta.
3. **Položky (kategorizácia + stredisko)**: pre každú položku Popis, **Kategória** (Materiál / Energia / Služby / Investícia / Réžia), **Stredisko** (valcovňa, lisovňa, labák, správa) a Suma bez DPH. Ďalší riadok cez **Pridať položku**.
4. Sleduj riadok **Súčet položiek** — musí sedieť so sumou bez DPH (inak: *„… nesedí so sumou bez DPH (…)"*).
5. Ťukni na **Zaevidovať faktúru**.

Nového dodávateľa najprv založ: **Dodávatelia** → **Nový dodávateľ**.

### 2. Schváliť faktúru a evidovať platby

1. V detaile faktúry v stave **Nová** ťukni **Schváliť faktúru**.
2. Platba: **Pridať platbu** → **Dátum platby**, **Suma (€)** → **Zaevidovať platbu**. Stav sa prepne na **Čiastočne zaplatená** alebo **Zaplatená** podľa súčtu platieb.
3. Splatnosti stráž filtrami v zozname: **Všetky / Po splatnosti / Splatné do 7 dní / 14 dní / 30 dní** — riadky po splatnosti sú červené.

### 3. Príjemka — materiál z faktúry na sklad

1. **Sklad** → **Príjemky** → **Nová príjemka**.
2. Zdroj: **Príjem z faktúry** (bežný prípad) alebo **Počiatočný stav skladu**.
3. Pri príjme z faktúry vyber **Faktúru** a ťukni **Predvyplniť položky** — riadky sa naplnia množstvami a cenami z faktúry; **pre každý riadok vyber materiál**.
4. Skontroluj **Dátum príjmu (FIFO poradie)**, doplň **Šaržu dodávateľa**.
5. Ťukni na **Zaevidovať príjemku** → *„Príjemka zaevidovaná — šarže sú na sklade."* Číslo príjemky pridelí systém (P-RRRR-NNNN). Každý riadok = skladová šarža s vlastnou cenou.

Nový materiál založíš cez **Sklad** → **Nový materiál** (Kód, Merná jednotka, Názov, Kategória, Min. zásoba, Predvolení dodávatelia, Poznámka).

### 4. Sklad a korekcie

- Karta materiálu (klik na kód): **Vývoj nákupnej ceny**, **Šarže (FIFO poradie čerpania)**.
- **Inventúrne manko** (tlačidlo nad šaržami) — odpis rozdielu z inventúry vo FIFO poradí, na vrub strediska.
- Pri každej šarži: **Cenová korekcia** (ikona €, napr. dobropis — poznámka „číslo dobropisu") a **Inventúrna korekcia** (ikona váhy). Korekcie ceny v uzavretých mesiacoch sa premietnu ako korekčná položka do aktuálneho obdobia.

### 5. Mesačná uzávierka (Kalkulácie)

1. **Kalkulácie** — zoznam mesiacov s réžiami z faktúr, počtom dávok a cyklov, stav **Otvorený / Uzavretý**.
2. Pri otvorenom mesiaci ťukni **Uzavrieť** a potvrď: *„Uzavrieť mesiac …? Réžie mesiaca … sa alokujú podľa D2 kľúčov a doklady mesiaca sa uzamknú. Otvoriť ho potom môže len admin."*
3. Po uzávierke má každá dávka a artikel **plný náklad** (s réžiami); detail mesiaca ukazuje réžie a sadzby. **Marže artiklov** nájdeš pod rovnomenným tlačidlom.

### 6. Exporty pre účtovníčku

Na **Prehľade**, karta **Exporty pre účtovníčku (CSV)**: Cash-flow — nezaplatené faktúry, Marže per artikel, Náklad na kg zmesi po mesiacoch, Náklad na pár po mesiacoch, Prestoje, Nepodarky, Nákupné ceny surovín (top 10).

## Na čo si dať pozor

- *„Faktúru najprv schváľte — platby sa evidujú na schválené doklady."*
- *„Faktúra s číslom „…" od tohto dodávateľa už existuje."* — duplicitná evidencia.
- Pri príjemke k faktúre, ktorá už príjemku má, svieti výstraha *„(už prijatá!)"* — skontroluj, či nejde o duplicitný príjem (čiastočné dodávky sú v poriadku).
- **Uzávierky idú chronologicky**: *„Najprv uzavri starší mesiac …"*; mesiac musí byť celý minulý: *„Mesiac … ešte neskončil — uzavrieť možno len celý minulý mesiac."*
- *„Dávky bez vyrobených kg blokujú uzávierku …: V-… Dokonči ich alebo zmaž."* — dorieš s majstrom valcovne.
- **Uzavretý mesiac sa nedá meniť**: *„Mesiac … je uzavretý alebo pod hranicou poslednej uzávierky — … nemožno meniť. Opravy patria do aktuálneho obdobia (korekčná položka), reopen smie len admin."*

## Mini-FAQ

**Prečo majster hlási „Nedostatok zásoby" pri navážke?**
Materiál nemá na sklade dosť množstva v šaržiach — chýba príjemka (alebo inventúrny odpis prebral viac). Zaeviduj príjemku z faktúry.

**Zaevidovala som platbu s zlou sumou.**
Platby sa v aplikácii nedajú mazať — obráť sa na admina.

**Kedy uzatvárať mesiac?**
Po skončení mesiaca, keď sú zaevidované všetky faktúry (réžie) a výroba je kompletná. Skoršia uzávierka = réžie sa alokujú bez chýbajúcich faktúr.

**Ako zistím, z ktorej faktúry je šarža?**
Sklad → karta materiálu → šarža je viazaná na príjemku a príjemka na faktúru; z detailu faktúry vidíš naviazané príjemky.

**Kde nastavím alokačné kľúče?**
**Kalkulácie → Nastavenia** vidí len admin (podiel valcovne na energiách v %). Ostatné kľúče (D2) sú pevné: valcovňa per kg zmesi, lisovňa per lisovací cyklus, labák a správa prirážkou.
