# DECISIONS.md — BAMIPA CTR

> Záväzné odpovede na blokujúce otázky zo SPEC.md, sekcia 11. Claude Code: toto je zdroj pravdy — pri konflikte so všeobecnými defaultami platí tento súbor. Položky PENDING nesmú blokovať Krok 1–2; implementuj s uvedeným defaultom a označ miesta v kóde komentárom `// DECISION-PENDING`.

## D1 — Ocenenie skladu: FIFO · ✅ ROZHODNUTÉ (zhodné s MRP)
- Výdajky čerpajú zo šarží (lotov) v poradí príjmu — najstaršia
  prvá, za jej skutočnú nákupnú cenu.
- Jedna navážka môže čerpať z viacerých šarží → riadky spotreby
  viazané na lot_id, každý s vlastnou cenou.
- Každá šarža drží zostatok (qty_remaining); výdaj pod nulu zakázaný.
- Procesné pravidlo: príjemka sa zadáva PRED navážkou — inak
  systém nemá z čoho vydávať.
- Inventúrne korekcie sa odpisujú tiež vo FIFO poradí.

## D2 — Alokačné kľúče réžií · ✅ ROZHODNUTÉ (revízia po 3 mesiacoch reálnych dát)
- Valcovňa: réžie strediska / kg vyrobenej zmesi za mesiac.
- Lisovňa: réžie strediska / počet lisovacích cyklov za mesiac.
- Labák: percentuálna prirážka k priamemu nákladu dávky zmesi.
- Správa: percentuálna prirážka k celkovým výrobným nákladom.
- Spresnenie (schválené 2026-07-16, M7): prirážky labáku a správy sa NEZADÁVAJÚ
  ručne — počítajú sa pri mesačnej uzávierke ako efektívna prirážka
  (réžie strediska za mesiac / základ mesiaca), takže alokácie sedia
  na cent s faktúrami. Réžie strediska = položky faktúr kategórií
  réžia + služby daného strediska (+ energia podľa D4); kategória
  investícia do réžií nevstupuje (odpisy = F3), materiál ide skladom.
  Nákladový mesiac faktúry = delivery_date, inak issue_date, inak due_date.

## D3 — Účtovný softvér: MRP · ✅ ROZHODNUTÉ
- F1–F2: bez integrácie. Faktúry sa evidujú v našom systéme kvôli kalkuláciám a cash-flow (duplicitne s MRP — vedomé rozhodnutie).
- F3: preveriť exportné/importné formáty MRP a postaviť import faktúr, aby duplicitné zadávanie zaniklo.

## D4 — Energie: len celková faktúra · ✅ ROZHODNUTÉ
- Žiadne pole kWh na dávke — z M4 vypadáva priamy vstup energie.
- Mesačná faktúra za elektrinu vstupuje ako réžia stredísk; rozdelenie valcovňa/lisovňa fixným pomerom podľa inštalovaného príkonu strojov — **60/40** (schválené 2026-07-16; editovateľné adminom v /kalkulacie/nastavenia, tabuľka calc_settings).
- Ak v budúcnosti pribudnú merače na strojoch, prechod na priamy vstup (F3+).

## D5 — Pretoky a orez: likvidácia · ✅ ROZHODNUTÉ
- Kalkulačne 100 % strata — náklad zlikvidovanej zmesi ostáva v náklade na pár.
- Evidovať hmotnosť odpadu (kg) per výrobný príkaz → KPI odpadovosti na dashboarde (priama páka na maržu).
- Poznámka: pri nasadení devulkanizácie sa D5 reviduje (odpad → vratný materiál so zápočtom hodnoty).

## D6 — Recepty: kg na dávku · ✅ ROZHODNUTÉ
- Receptúra = položky v kg na štandardnú dávku. Žiadne phr prepočty.
- Navážka v M4 sa predvypĺňa v kg podľa verzie receptu.

## D7 — Podošvy: pár ako jednotka · ✅ ROZHODNUTÉ
- Žiadne veľkostné čísla ani veľkostné krivky. Artikel = model podošvy, jednotka = pár.

## D8 — Zadávanie dát z dielne: majstri na tabletoch pri stroji · ✅ ROZHODNUTÉ
- UI modulov M4/M5/M6 je tablet-first: veľké dotykové prvky, číselníky namiesto voľného textu, kompletný záznam dávky do 3 minút (akceptačné kritérium).
- Hardvér: 2–3 tablety, odolné puzdrá do prašného prostredia (sadze), umiestnenie mimo najšpinavšej zóny.

## D9 — Používatelia · ⏳ PENDING (upresniť)
- Odhad: 1 admin/konateľ, 1 ekonóm, 1–2 majstri valcovne, 1–2 majstri lisovne, 1 laborant (≈ 5–7 účtov).
- **[DOPLNIŤ presné počty pred Krokom 3 — Auth.]**

## D10 — Migrácia existujúcich dát · ⏳ PENDING
- **[DOPLNIŤ: zoznam existujúcich súborov — recepty, zoznam materiálov, dodávatelia, artikle (Excel/papier?).]**
- Ak existujú v Exceli → v Kroku 2 pripraviť CSV importy namiesto ručného zadávania; seed dáta stavať z reálnych receptov.
