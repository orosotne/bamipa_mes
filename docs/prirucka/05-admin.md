# Príručka — Administrátor / konateľ

## Čo vidíš po prihlásení

Pristaneš na **Prehľade** (rovnaký plný dashboard ako ekonómka: cash-flow, náklady, marže, exporty). V ľavom paneli vidíš **všetky moduly**: Prehľad, Faktúry, Dodávatelia, Sklad, Receptúry, Výroba, Labák, Lisovňa, Kalkulácie, Číselníky, Používatelia. Máš práva na všetko, čo robia ostatné roly, plus úlohy nižšie.

## 1. Používatelia (/pouzivatelia)

### Nový účet

1. **Používatelia** → karta **Nový používateľ**.
2. Vyplň **Email**, **Meno**, vyber **Rolu** (Administrátor / konateľ, Ekonóm / back-office, Majster valcovne, Laborant, Majster lisovne) a zadaj **Dočasné heslo** (min. 8 znakov).
3. Ťukni na **Vytvoriť používateľa** — vznikne prihlasovací účet v Supabase Auth s priradenou rolou.
4. Dočasné heslo odovzdaj používateľovi osobne.

### Správa účtov

- **Zmena roly**: v tabuľke **Účty** vyber novú rolu priamo v riadku → *„Rola zmenená."* Rola určuje moduly aj práva okamžite.
- **Deaktivovať / Aktivovať**: deaktivovaný účet sa nevie prihlásiť (pri najbližšej požiadavke ho systém odhlási). Vlastný účet deaktivovať nemôžeš.

### Zabudnuté heslo (reset)

Aplikácia reset hesla **nemá** — ani na prihlasovacej stránke, ani v /pouzivatelia. Postup:

1. Otvor **Supabase Dashboard** projektu → **Authentication → Users**.
2. Nájdi používateľa podľa emailu a nastav mu nové heslo (napr. cez „…" → Reset password / Update user).
3. Nové dočasné heslo odovzdaj používateľovi.

## 2. Receptúry (/receptury) — len admin

1. **Nová zmes** → Kód zmesi, Názov, Poznámka → **Uložiť**.
2. Detail zmesi → **Nová verzia**: **Štandardná dávka (kg)**, **Položky (kg na štandardnú dávku)** — materiál + množstvo, **Technologické poznámky** → **Vytvoriť verziu**.
3. Verziu zapni tlačidlom **Aktivovať verziu N** — dávky valcovne sa zakladajú **vždy z aktívnej verzie (★)**; každá dávka si pamätá, z ktorej verzie vznikla. Úprava receptu = nová verzia (staré sa nemenia).
4. Detail verzie ukazuje **živú teoretickú kalkuláciu** — materiálovú cenu dávky podľa aktuálnych skladových cien.
5. **Limity labáku (QC)** — dole na detaile zmesi: pre každý parameter zadaj **Min** / **Max** → **Uložiť** (per riadok). Prázdne obe polia = limit sa zruší. **Bez definovaných limitov sa dávky tejto zmesi nedajú merať v labáku** — nastav ich pred prvou výrobou.

## 3. Číselníky (/ciselniky) — len admin

- **Stroje**: **Nový stroj** — Kód, Názov, **Stredisko** (valcovňa/lisovňa). Stroje lisovne sa ponúkajú vo výkonoch lisov, stroje valcovne pri dávkach.
- **Pracovníci**: **Nový pracovník** (Meno) a **sadzby**: dialóg **Sadzby — meno** → **Sadzba (€/hod)** + **Platná od** → sadzba sa použije pri výpočte nákladu práce (nejde o mzdový systém).

Dôvody prestojov a nepodarkov sú prednastavené číselníky — v UI sa nespravujú.

### Import CSV (Číselníky → Import CSV, /ciselniky/import)

Hromadné naplnenie číselníkov zo súborov (nábeh systému). Šablóny s návodom
pre prípravu v Exceli sú v repozitári v `docs/import-sablony/` (README:
uložiť ako **CSV UTF-8**, desatinné čiarky, systém zvláda bodkočiarku aj
čiarku ako oddeľovač).

1. Vyber **Typ číselníka** — importuj v poradí **1 — Dodávatelia →
   2 — Materiály → 3 — Receptúry zmesí → 4 — Artikle podošiev** (súbory sa
   na seba odkazujú kódmi).
2. Vyber **CSV súbor**. Checkbox **„Aktualizovať existujúce záznamy"** nechaj
   vypnutý, ak sa existujúce záznamy majú preskočiť (predvolené).
3. **Skontrolovať** — nič sa nezapíše; pri chybách sa ukáže tabuľka
   **Riadok / Stĺpec / Chyba** (oprav súbor v Exceli a nahraj znova), pri
   kontrole bez chýb počty *X nových / Y aktualizovaných / Z preskočených*.
4. **Importovať** (tlačidlo sa objaví až po kontrole bez chýb) → *„Import
   dokončený"* s počtami.

Ako sa spoznajú existujúce záznamy: materiály, zmesi a artikle **podľa kódu**;
dodávatelia **podľa IČO**, bez IČO podľa názvu. Pri aktualizácii sa prepíšu
len vyplnené políčka (prázdne nič nemaže); receptúram vzniká **nová verzia**
(staré verzie a dávky ostávajú nedotknuté). Celý import je jedna transakcia —
pri chybe sa nezapíše nič; každý import má záznam v audit logu.

## 4. Artikle (Lisovňa → Artikle) — mutácie len admin

**Nový artikel**: **Kód**, **Model podošvy**, **Zmes**, **Norma spotreby zmesi (kg/pár)**, **Cieľový čas cyklu (s)**, **Predajná cena (€/pár)** — z nej sa počíta marža. Majster lisovne katalóg len číta.

## 5. Kalkulácie — nastavenia a reopen — len admin

- **Kalkulácie → Nastavenia**: **Podiel valcovne na energiách (%)** → **Uložiť pomer** (lisovňa dostane zvyšok; nový pomer platí pre budúce uzávierky).
- **Reopen mesiaca**: detail uzavretého mesiaca → **Otvoriť mesiac (reopen)** s potvrdením *„… Sadzby a alokácie prestanú platiť a doklady mesiaca sa odomknú — po opravách treba mesiac uzavrieť znova."* Uzávierku potom spraví ekonómka nanovo.

## Na čo si dať pozor

- **Poradie pri nábehu**: dodávatelia a materiály → faktúry a príjemky (sklad má ceny) → zmesi + verzie receptov + **limity labáku** → stroje, pracovníci a sadzby → artikle → potom môže dielňa zapisovať.
- Zmena roly platí okamžite — používateľ uvidí iné moduly po najbližšom načítaní stránky.
- Reopen mesiaca ruší alokácie — používaj len na opravy, po ktorých sa mesiac hneď znovu uzavrie.
- Predajné ceny artiklov a marže vidí len admin a ekonóm (majstri nie) — pri zmene cien netreba nič oznamovať dielni.
- Receptúry a limity meň cez **novú verziu** / úpravu limitov — nikdy nie „narýchlo" počas rozpracovanej dávky (dávka drží snapshot receptu aj limitov z času merania).

## Mini-FAQ

**Používateľ si zabudol heslo.**
Pozri bod 1 — reset v Supabase Dashboard (Authentication → Users), aplikácia ho nevie.

**Majster valcovne nevidí zmes pri zakladaní dávky.**
Zmes nemá aktívnu verziu receptu — Receptúry → detail zmesi → **Aktivovať verziu N**.

**Laborant hlási „Zmes nemá definované limity labáku."**
Receptúry → detail zmesi → **Limity labáku (QC)** → vyplň Min/Max a **Uložiť**.

**Treba opraviť doklad v uzavretom mesiaci.**
Preferuj korekčnú položku v aktuálnom období (napr. oprava ceny šarže). Reopen je krajný prípad: **Otvoriť mesiac (reopen)** → oprava → ekonómka mesiac znovu uzavrie.

**Ako pridám nový lis?**
Číselníky → **Nový stroj**, stredisko **lisovňa** — hneď sa ponúka vo formulári „Nový výkon".
