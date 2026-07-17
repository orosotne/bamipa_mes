# Príručka — Majster valcovne

## Čo vidíš po prihlásení

Pristaneš na **Prehľade** (výrobné KPI, prestoje a nepodarky). V ľavom paneli máš dva moduly: **Prehľad** a **Výroba** — pracuješ vo **Výrobe** (nadpis „Výroba — valcovňa"). Zoznam dávok má stĺpce: Číslo dávky, Zmes, Dátum, Zmena, Stroj, Obsluha, Stav. Stavy dávky: **Rozpracovaná → Čaká na labák → Schválená / Zamietnutá**.

## Denný postup: kompletná dávka

### 1. Založiť dávku

1. Vo **Výrobe** ťukni na **Nová dávka**.
2. Vyber **Zmes** (ponúkajú sa len zmesi s aktívnou verziou receptu).
3. Skontroluj **Dátum výroby** (predvyplnený dnešok) a **Násobok dávky (scale factor)** — napr. `1` alebo `2,5`.
4. Ťukni na **Zmenu**: Ranná / Poobedná / Nočná.
5. Vyber **Stroj** a **Obsluhu**, prípadne dopíš **Poznámku**.
6. Ťukni na **Založiť dávku** — systém pridelí číslo dávky a otvorí jej detail.

### 2. Vydať navážku

1. V detaile dávky nájdi kartu **Navážka — plán vs. skutočnosť**.
2. Stĺpec **Vydať teraz (kg)** je predvyplnený zostatkom podľa receptu (plán − už vydané). Uprav na skutočne navážené množstvá.
3. Ťukni na **Vydať zo skladu** → hláška *„Navážka vydaná zo skladu."* Výdaj automaticky odpíše materiál zo skladových šarží (FIFO).
4. Vydané množstvá vidíš nižšie v časti **Skutočné výdaje (traceabilita)**. Omyl opravíš tlačidlom **Storno** pri riadku a novým výdajom.

Navážku môžeš vydávať aj po častiach — opakovaným zápisom do **Vydať teraz (kg)**.

### 3. Zapísať prácu, prestoje a čas

1. **Práca obsluhy**: vyber pracovníka, dátum, zadaj **Hodiny** → **Pridať**.
2. **Prestoje**: vyber **Dôvod prestoja** z číselníka, zadaj **Minúty** → **Pridať**.
3. **Čas miešania (minúty)**: zadaj celkový čas → **Uložiť**.

### 4. Odovzdať na labák

1. Ťukni na veľké tlačidlo **Odovzdať na labák**.
2. V dialógu **Odovzdanie dávky na labák** zadaj **Skutočná výroba (kg)**.
3. Ťukni na **Potvrdiť a odovzdať** → dávka prejde do stavu **Čaká na labák** a záznam sa uzamkne.

### 5. Ak labák dávku zamietne (úprava dávky)

1. Dávka je v stave **Zamietnutá**; v jej detaile sa objaví karta **Úprava dávky (rework)** s textom **Inštrukcia labáku** (čo treba spraviť).
2. Dodatočný materiál: vyber materiál, zadaj kg → **Vydať**.
3. Dodatočná práca: vyber pracovníka, dátum, hodiny → **Pridať**.
4. Po úprave ťukni na **Znovu odovzdať na labák** a zadaj skutočnú výrobu (kg). Všetky vícenáklady zostávajú na tej istej dávke.

## Na čo si dať pozor

- *„Dávka čaká na vyhodnotenie labákom — záznam je uzamknutý."* — po odovzdaní už dávku nemeníš; čakaj na verdikt labáku.
- *„Dávka je uzamknutá (stav „…") — záznam nemožno upraviť."* — zapisovať možno len do dávky v stave Rozpracovaná (alebo do reworku zamietnutej).
- *„Nedostatok zásoby: požadované X kg, dostupné Y kg — chýba Z kg."* — materiál nie je na sklade; výdaj sa nevykoná vôbec. Rieš s ekonómkou (chýba príjemka).
- *„Zmes nemá aktívnu verziu receptu — najprv ju aktivuj v Receptúrach."* — receptúry spravuje admin; požiadaj ho o aktiváciu verzie.
- Uzavretý mesiac sa nedá meniť — hláška *„Mesiac … je uzavretý … nemožno meniť."* Opravy patria do aktuálneho obdobia; reopen smie len admin.
- Bez verdiktu **SCHVÁLENÉ** od labáku sa dávka nedá použiť v lisovni — schválenie neurýchliš, len cez laboranta.

## Mini-FAQ

**Pomýlil som sa v navážke — čo teraz?**
Kým je dávka Rozpracovaná: pri riadku výdaja v „Skutočné výdaje (traceabilita)" ťukni **Storno** a vydaj správne množstvo.

**Zabudol som zapísať prestoj a dávka je už na labáku.**
Záznam je uzamknutý. Ak labák ešte nevyniesol verdikt, nedá sa to v aplikácii vrátiť — nahlás to adminovi.

**Prečo mi systém neponúka zmes, ktorú chcem miešať?**
Zmes nemá aktívnu verziu receptu. Aktivuje ju admin v Receptúrach.

**Kde vidím, koľko dávka stojí?**
V detaile dávky, karta **Náklad dávky**: materiál, práca, prípadné vícenáklady úprav (rework) a priamy náklad na 1 kg. Réžie a plný náklad sa doplnia po mesačnej uzávierke.

**Vypol sa tablet uprostred zápisu — prišiel som o údaje?**
Nie, rozpísaný formulár sa na tom istom zariadení obnoví (pozri spoločné pokyny, bod 5).
