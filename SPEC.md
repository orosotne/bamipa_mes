# PROMPT: BAMIPA — interný výrobno-nákladový systém (ERP/MES-lite)

> Použitie: vlož celý tento dokument ako zadanie do Claude Code (ideálne ako `SPEC.md` v koreňovom adresári nového repa + odkáž naň v `CLAUDE.md`). Pred spustením vyplň všetky bloky označené **[ROZHODNÚŤ]** a **[DOPLNIŤ]**.

---

## 1. ROLA

Si senior full-stack architekt a vývojár so skúsenosťami s MES/ERP systémami pre malé výrobné firmy. Tvojou úlohou je navrhnúť a implementovať internú webovú aplikáciu presne podľa tejto špecifikácie. Nepridávaj funkcie nad rámec zadania (sekcia 9 — Ne-ciele). Pri nejasnostiach sa najprv pýtaj (sekcia 11), až potom implementuj.

## 2. KONTEXT FIRMY A VÝROBNÉHO PROCESU

**BAMIPA** je slovenský výrobca gumárenských zmesí a lisovaných gumených podošiev. Hlavný odberateľ: **LOWA** (outdoorová obuv). Výroba má tri prevádzky, ktoré musí systém verne modelovať:

### 2.1 Valcovňa (výroba zmesí)
- Vyrába gumárenské zmesi **od nuly** z primárnych surovín: kaučuky, silika, sadze, oleje, urýchľovače, síra, ďalšie chemikálie.
- Každá zmes má **konkrétnu receptúru** (kusovník / BOM).
- Nákladové vstupy valcovne: materiál podľa receptu, práca obsluhy, energia, prestoje, odpisy/investície.
- Výstup: **výrobná dávka zmesi** (šarža) v kg, ktorá čaká na schválenie labákom.

### 2.2 Labák (laboratórium — QC brána)
- Testuje **každú dávku zmesi** pred uvoľnením do lisovne.
- Sleduje sa **5 základných fyzikálnych parametrov** — reometria (napr. ML, MH, ts2, t90) a trhacie skúšky (pevnosť, ťažnosť, tvrdosť). Parametre a ich tolerančné limity musia byť **konfigurovateľné per zmes**.
- Verdikty: SCHVÁLENÉ / ZAMIETNUTÉ (+ voliteľne PODMIENEČNE). Zamietnutá dávka je **tvrdo blokovaná** pre lisovňu — systém nesmie dovoliť jej spotrebu.
- Pri zamietnutí labák iniciuje **úpravu dávky vo valcovni** (dodatočné miešanie / prídavky materiálu) — dodatočné náklady sa pripočítavajú k tej istej dávke a nasleduje nové testovanie.

### 2.3 Lisovňa (výroba podošiev)
Tok schválenej zmesi:
1. **Kalandrovanie** zmesi
2. **Barwell** (preformy) ALEBO **sekanie** zmesi — dve alternatívne vetvy prípravy
3. **Lisovanie** — 9 lisovacích staníc (LIS1–LIS9) + 1 gumový **vstrekolis (strekolis)** s odlišným procesom **[DOPLNIŤ: v čom presne sa proces strekolisu líši — forma vstupu zmesi, takt, obsluha]**
4. **Orezávanie** pretokov (výronkov)
5. **Zapravovanie**
6. **Výstupná kontrola kvality**
7. **Balenie**
8. **Expedícia** odberateľovi

## 3. CIEĽ SYSTÉMU (jedna veta)

Systém, ktorý zachytí **každé euro vstupujúce do firmy** (faktúry, materiál, práca, energie, réžie), priradí ho konkrétnej výrobnej dávke a produktu, a odpovie na otázku: **koľko skutočne stojí 1 kg zmesi X a 1 pár podošvy Z** — nie odhadom, ale z reálnych dát.

„SAP-like, ale nie SAP": okresané funkcie, žiadna zbytočná komplexita, rýchle zadávanie dát aj z dielne.

### Primárne otázky, na ktoré systém odpovedá
1. Koľko skutočne stojí 1 kg zmesi X (konkrétna dávka aj priemer za obdobie)?
2. Koľko skutočne stojí 1 pár podošvy modelu Z (materiál + práca + réžie)?
3. Aké faktúry treba zaplatiť, komu a kedy (cash-flow kalendár)?
4. Za koľko, kedy a od koho sme nakupovali materiál M (cenová história a porovnanie dodávateľov)?
5. Kde vznikajú prestoje, nepodarky a nadspotreba?
6. Je dávka zmesi schválená labákom? Kto a kedy ju schválil?
7. Traceabilita: z ktorej dávky zmesi a z ktorých šarží surovín je konkrétna dodávka podošiev?

## 4. POUŽÍVATELIA A ROLY (RBAC)

| Rola | Práva |
|---|---|
| Admin / konateľ | všetko, správa používateľov, sadzby, alokačné kľúče |
| Ekonóm / back-office | faktúry, príjemky, ceny, sklad, reporty |
| Majster valcovne | výrobné dávky zmesí, navážky, prestoje, výkazy práce |
| Laborant | výsledky skúšok, schvaľovanie/blokovanie dávok |
| Majster lisovne | výrobné príkazy, výkony lisov, nepodarky, balenie, expedícia |

Každý zápis má audit trail (kto, kedy, čo zmenil). **[DOPLNIŤ: počet používateľov celkovo a koľko ich bude zadávať dáta priamo na dielni]**

## 5. FUNKČNÉ MODULY

### M1 — Došlé faktúry a záväzky (AP)
- Evidencia faktúry: dodávateľ, číslo, dátum vystavenia / dodania / splatnosti, suma bez DPH / DPH / s DPH, mena (EUR), príloha (PDF/foto).
- Kategorizácia každej faktúry (alebo položky): **materiál / energia / služby / investícia / réžia** + priradenie **nákladovému stredisku** (valcovňa, lisovňa, labák, správa).
- Stavy: nová → schválená → zaplatená (čiastočne/úplne). Filter „splatné do 7/14/30 dní", upozornenia na po splatnosti.
- Faktúra za materiál sa **páruje s príjemkou na sklad** (M2) — jednotkové ceny položiek faktúry sa stávajú skladovými cenami šarží.
- **[DOPLNIŤ: účtovný softvér firmy (Pohoda / Omega / iný) — v F3 export/import, aby sa faktúry nezadávali dvakrát]**

### M2 — Sklad materiálov a cenová história
- Karta materiálu: kód, názov, merná jednotka (kg/l/ks), kategória (kaučuk, plnivo, olej, chemikália, obalový materiál…), predvolení dodávatelia, minimálna zásoba.
- **Príjemka** viazaná na faktúru: množstvo, jednotková cena, dátum, šarža dodávateľa → vzniká **skladová šarža (lot)** s vlastnou cenou.
- **Výdajka** viazaná na výrobnú dávku zmesi (M4) — nikdy „do vzduchu".
- Ocenenie skladu: **[ROZHODNÚŤ: FIFO alebo vážený aritmetický priemer — musí byť konzistentné s účtovníctvom firmy; ovplyvňuje všetky kalkulácie]**
- **Cenová história**: graf vývoja nákupnej ceny per materiál a per dodávateľ v čase; porovnanie dodávateľov.
- Inventúra s korekciami (manko/prebytok ako nákladová položka strediska).

### M3 — Receptúry zmesí (BOM)
- Receptúra: kód zmesi, verzia, položky (materiál + množstvo — **[ROZHODNÚŤ: zadávanie v phr na 100 dielov kaučuku, alebo v kg na štandardnú dávku?]**), technologické poznámky.
- **Verzovanie**: úprava receptu vytvára novú verziu; každá výrobná dávka si pamätá presnú verziu, z ktorej vznikla.
- **Živá teoretická kalkulácia**: materiálová cena dávky podľa aktuálnych skladových cien — okamžite viditeľné, ako zmena ceny suroviny prepisuje náklad zmesi.

### M4 — Výroba: Valcovňa (dávky zmesí)
- Výrobná dávka: číslo dávky, zmes + verzia receptu, dátum, zmena, stroj, obsluha.
- **Plánovaná vs. skutočná navážka** po položkách receptu → skutočná navážka automaticky generuje výdajky zo skladu (z konkrétnych šarží podľa metódy ocenenia).
- Evidencia časov: čas miešania/valcovania, **prestoje s dôvodom** (porucha, čakanie na materiál, prestavba, iné) — číselník dôvodov.
- Práca: hodiny obsluhy × hodinová sadzba (sadzby spravuje admin, nejde o mzdový systém).
- Energia: **[ROZHODNÚŤ: máte merače spotreby na stroj/prevádzku? Ak áno — priamy vstup kWh na dávku; ak nie — mesačná faktúra za energiu sa alokuje kľúčom (strojhodiny / kg zmesi)]**
- Výstup: skutočne vyrobené kg zmesi → dávka prechádza do stavu **„čaká na labák"**.

### M5 — Labák (QC)
- Ku každej dávke: záznam skúšky s konfigurovateľnou sadou parametrov (min. 5: reometria + trhačky + tvrdosť) a tolerančnými limitmi per zmes.
- Výsledok mimo limitu sa vizuálne zvýrazní; verdikt SCHVÁLENÉ / ZAMIETNUTÉ zapisuje laborant (meno + čas = schvaľovací log).
- Zamietnutie → workflow **úpravy dávky**: dodatočné prídavky materiálu (nové výdajky na tú istú dávku), dodatočný čas, nové meranie. Všetky vícenáklady ostávajú na dávke.
- História meraní a **trendové grafy parametrov per zmes** (jednoduchá SPC vizualizácia — bez štatistických modulov navyše).

### M6 — Výroba: Lisovňa (podošvy)
- **Katalóg artiklov**: model podošvy, priradená zmes, norma spotreby zmesi na pár (kg), **[DOPLNIŤ: evidujete veľkostné čísla / veľkostnú krivku, alebo stačí „pár" ako jednotka?]**, predajná cena pre kalkuláciu marže.
- **Výrobný príkaz**: artikel, množstvo párov, priradené dávky zmesi — systém ponúkne **len dávky schválené labákom** (tvrdá kontrola).
- Evidencia krokov: kalandrovanie → Barwell / sekanie (výber vetvy) → lisovanie → orezávanie → zapravovanie → kontrola → balenie.
- **Výkony per stanica a zmena** (LIS1–LIS9, STREKOLIS): počet cyklov, vyrobené páry, nepodarky s dôvodom (číselník), spotrebované kg zmesi, obsluha, prestoje s dôvodom.
- **Pretoky / orez**: hmotnosť odpadu per príkaz. **[ROZHODNÚŤ: odpad sa likviduje, predáva, alebo sa re-processuje späť (regenerát/devulkanizát do zmesí)? Ak re-processing → odpad dostáva zápornú/vratnú hodnotu a vracia sa na sklad ako materiál]**
- **Expedícia**: dodací list pre odberateľa (LOWA), položky so šaržami → **plný traceability reťazec**: dodávka → výrobný príkaz → dávka zmesi → šarže surovín → faktúry dodávateľov.

### M7 — Kalkulácie a nákladové strediská (jadro systému)
- Nákladové strediská: valcovňa, lisovňa, labák, správa.
- **Priame náklady dávky zmesi** = skutočná navážka × skladová cena šarží + práca (hodiny × sadzba) + meraná energia + vícenáklady z úprav po labáku.
- **Nepriame náklady (réžie)**: mesačné náklady strediska z faktúr (M1) + mzdové sadzby režijných pracovníkov + odpisy — alokované na dávky/produkty podľa kľúča. **[ROZHODNÚŤ: alokačný kľúč — kg vyrobenej zmesi / strojhodiny / lisovacie cykly. Bez tohto rozhodnutia je „náklad na pár" fikcia — navrhnúť default: valcovňa per kg zmesi, lisovňa per lisovací cyklus, labák a správa percentuálnou prirážkou]**
- **Náklad na kg zmesi**: per dávka + vážený priemer za obdobie, rozpad materiál / práca / energia / réžia.
- **Náklad na pár podošvy**: spotreba zmesi (kg × náklad/kg, vrátane pretokov ako strata alebo vratný materiál) + práca lisovne (lisovanie, orez, zapravenie, balenie) + réžia lisovne + podiel správnej réžie.
- **Teoretická (recept) vs. skutočná kalkulácia** — odchýlky zvýraznené; vývoj nákladu v čase; **marža voči predajnej cene per artikel**.
- Mesačná uzávierka: uzamknutie obdobia, prepočet alokácií, archív kalkulácií.

### M8 — Reporting a dashboard
- Denný/týždenný prehľad: kg vyrobených zmesí, páry podošiev, nepodarkovosť %, prestoje (hodiny + dôvody), first-pass yield labáku.
- Cash-flow: splatné faktúry 7/14/30 dní, po splatnosti.
- Vývoj nákupných cien top 10 materiálov.
- Náklad/kg per zmes a náklad/pár per artikel v čase; marže.
- Všetky tabuľky exportovateľné do CSV/XLSX.

## 6. DÁTOVÝ MODEL (jadro — navrhni a rozšír)

`suppliers`, `invoices`, `invoice_items`, `cost_centers`, `materials`, `material_lots` (šarža, množstvo, jedn. cena, väzba na faktúru), `stock_moves` (príjem/výdaj/korekcia), `mixtures`, `recipes` + `recipe_items` (verzované), `production_batches` (dávky zmesí) + `batch_consumptions` + `batch_labor` + `batch_downtimes`, `lab_test_definitions` (parametre + limity per zmes), `lab_tests` + `lab_results` (verdikt, laborant, čas), `sole_models` (artikle), `work_orders` + `press_runs` (per stanica/zmena) + `scrap_records`, `shipments` + `shipment_items`, `labor_rates`, `overhead_allocations` (mesačné, per stredisko, kľúč), `users` + `roles`, `audit_log`.

Zásady: soft delete, všetky peňažné hodnoty v centoch (integer), časové pásmo Europe/Bratislava, každá tabuľka `created_at/updated_at/created_by`.

## 7. KĽÚČOVÉ WORKFLOW (end-to-end, implementuj presne v tomto poradí logiky)

1. **Faktúra → sklad**: ekonóm zaeviduje faktúru za materiál → vytvorí príjemku → vzniknú šarže s cenami → sklad aj záväzky aktuálne jedným tokom.
2. **Dávka zmesi**: majster valcovne založí dávku (zmes + verzia receptu) → systém predvyplní plánovanú navážku → majster zapíše skutočnú → automatický výdaj zo skladu → zapíše časy, prestoje → dávka „čaká na labák".
3. **QC brána**: laborant zapíše výsledky → schváli/zamietne → pri zamietnutí beží slučka úpravy dávky, náklady sa kumulujú.
4. **Lisovanie**: majster lisovne založí výrobný príkaz → vyberie len schválené dávky → zapisuje výkony per lis/zmena, nepodarky, odpad → balenie → expedícia s dodacím listom.
5. **Mesačná uzávierka**: ekonóm potvrdí réžie mesiaca → systém alokuje → prepočíta skutočné náklady/kg a /pár → reporty a porovnanie s teóriou.

## 8. TECHNICKÝ STACK A ŠTANDARDY

- **Next.js (App Router) + React + TypeScript strict**, Tailwind CSS v4 + shadcn/ui, nasadenie Vercel.
- **PostgreSQL (Supabase) + Drizzle ORM**, migrácie verzované v repe. Supabase Auth s RBAC (roly zo sekcie 4) a row-level ochranou citlivých operácií.
- Server Actions / route handlers, validácia **Zod** na vstupe aj výstupe, formuláre react-hook-form.
- **UI kompletne v slovenčine**, formáty sk-SK (dátum, čísla, €). Terminológiu z tejto špecifikácie (valcovňa, lisovňa, labák, dávka, navážka, zapravovanie, pretoky) používaj v UI doslovne — je to jazyk dielne.
- **Dielenské obrazovky (M4, M5, M6) optimalizuj na tablet**: veľké dotykové prvky, minimum klikov, číselníky namiesto voľného textu, offline-tolerantné správanie formulárov (neztratiť rozpísaný záznam).
- Testy aspoň na kalkulačnú logiku (M7) — tá musí byť pokrytá unit testami skôr, než sa jej niekto začne veriť.

## 9. NE-CIELE (v žiadnej fáze nerob bez explicitného zadania)

- Žiadne podvojné účtovníctvo, DPH výkazy, mzdová agenda — to rieši účtovný softvér; my len evidujeme a exportujeme.
- Žiadny CRM, e-shop, údržba strojov, dochádzkový systém.
- Žiadny multitenant, multi-mena, multi-jazyk.
- Žiadna integrácia hardvéru (váhy, reometre) v F1–F2 — manuálny vstup.
- Žiadne AI/ML predikcie — najprv čisté dáta.

## 10. FÁZOVANIE (implementuj postupne, každá fáza nasaditeľná)

- **F1 (MVP)**: M1 faktúry, M2 sklad + cenová história, M3 receptúry, M4 dávky valcovne, M5 labák so schvaľovacou bránou, základný náklad/kg (priame náklady). Cieľ: firma vidí skutočný materiálový náklad každej dávky a má pod kontrolou záväzky.
- **F2**: M6 lisovňa kompletná, M7 plná alokácia réžií + náklad/pár + marže, M8 dashboardy.
- **F3**: expedícia s traceability reportom pre odberateľa, export do účtovného SW, prípadné hardvérové vstupy.

## 11. PRED ZAČATÍM IMPLEMENTÁCIE SA MA SPÝTAJ (blokujúce otázky)

1. FIFO alebo vážený priemer pri ocenení skladu? (konzultovať s účtovníkom)
2. Alokačné kľúče réžií per stredisko — súhlasíš s navrhnutými defaultami v M7?
3. Aký účtovný softvér používame (kvôli F3 exportu)?
4. Merajú sa energie per stroj/prevádzka, alebo len fakturačne?
5. Čo sa deje s pretokmi a nepodarkami — likvidácia, predaj, alebo devulkanizácia/regenerát späť do zmesí?
6. Recepty v phr alebo v kg na dávku? Existujú už v Exceli na migráciu? Aké ďalšie dáta (materiály, dodávatelia, artikle) vieme naimportovať z existujúcich súborov?
7. Veľkostné krivky pri podošvách, alebo len páry?
8. Počet používateľov a kto reálne zadáva dáta na dielni (tablet pri stroji vs. prepis v kancelárii)?

## 12. AKCEPTAČNÉ KRITÉRIÁ (výber — over pred odovzdaním každej fázy)

- [ ] Nie je možné vydať do lisovne zmes bez verdiktu SCHVÁLENÉ od labáku (over aj cez API, nie len UI).
- [ ] Zmena nákupnej ceny suroviny sa okamžite premietne do živej teoretickej kalkulácie receptu.
- [ ] Skutočný náklad dávky = súčet skutočných výdajok × ceny šarží + práca + energia + vícenáklady z úprav; ručne prepočítateľné na dokladoch.
- [ ] Z dodacieho listu sa dá do 3 klikov dostať k šaržiam surovín a faktúram dodávateľov (traceabilita).
- [ ] Faktúra po splatnosti je viditeľná na dashboarde bez jediného kliku navyše.
- [ ] Majster zapíše kompletnú dávku (navážka + časy + prestoje) na tablete do 3 minút.
- [ ] Mesačná uzávierka je idempotentná — opakované spustenie nezdvojí alokácie.
