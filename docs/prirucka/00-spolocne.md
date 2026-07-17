# BAMIPA — výrobno-nákladový systém: spoločné pokyny

Platí pre všetky roly. Adresa aplikácie: **https://bamipa-mes.vercel.app**

## 1. Prihlásenie

1. Otvor v prehliadači adresu aplikácie. Zobrazí sa stránka **BAMIPA — výrobno-nákladový systém**.
2. Vyplň pole **Email** a pole **Heslo**.
3. Ťukni na **Prihlásiť sa** (alebo stlač Enter).

Možné hlášky:

- *„Zadaj email aj heslo."* — jedno z polí je prázdne.
- *„Nesprávny email alebo heslo."* — preklep v údajoch, skús znova; ak si heslo nepamätáš, pozri bod 3.

Po prihlásení pristaneš na **Prehľade** (dashboard) — výnimkou je **Laborant**, ktorého systém presmeruje rovno do **Labáku**. Majstri vidia na Prehľade výrobné KPI, prestoje a nepodarky; admin a ekonóm aj financie (cash-flow, náklady, marže).

Vľavo je bočný panel s navigáciou — vidíš v ňom len moduly, na ktoré má tvoja rola právo. Úplne dole v paneli je oranžové tlačidlo **Manuál** (s ikonou otáznika ?), pod ním tvoje meno, rola a tlačidlo **Odhlásiť**. Tlačidlo **Manuál** otvorí túto používateľskú príručku priamo v aplikácii (stránka /manual) — späť sa vrátiš navigáciou vľavo alebo šípkou Späť.

## 2. Odhlásenie

1. V ľavom paneli úplne dole ťukni na **Odhlásiť**.
2. Systém ťa vráti na prihlasovaciu stránku.

Na zdieľanom tablete na dielni sa po skončení zmeny vždy odhlás.

## 3. Zabudnuté heslo

Aplikácia nemá samoobslužný reset hesla (žiadne „zabudol som heslo" na prihlasovacej stránke).

1. Obráť sa na **administrátora**.
2. Administrátor ti nastaví nové dočasné heslo (robí to mimo aplikácie, v správe Supabase — pozri príručku admina).
3. Prihlás sa novým heslom.

## 4. Tablet — pridať aplikáciu na plochu

Aplikácia beží v prehliadači; na tablete si ju pridaj na plochu, aby sa otvárala jedným ťuknutím:

**iPad (Safari):**

1. Otvor https://bamipa-mes.vercel.app v Safari.
2. Ťukni na ikonu **Zdieľať** (štvorec so šípkou hore).
3. Vyber **Pridať na plochu** (Add to Home Screen) a potvrď **Pridať**.

**Android (Chrome):**

1. Otvor https://bamipa-mes.vercel.app v Chrome.
2. Ťukni na menu **⋮** vpravo hore.
3. Vyber **Pridať na plochu** a potvrď.

## 5. Rozpísané formuláre sa nestrácajú

Dielenské formuláre (nová dávka, navážka, výkony lisov, merania labáku…) si rozpísané hodnoty priebežne ukladajú **v zariadení**. Keď sa tablet vypne alebo omylom zavrieš prehliadač, po otvorení tej istej obrazovky nájdeš údaje predvyplnené. Pozor: koncept platí len na tom istom zariadení a prehliadači — nedokončený zápis sa neprenáša na iný tablet.

## 6. Kto čo robí (rýchla orientácia)

- **Majster valcovne** — výrobné dávky zmesí: navážka, práca, prestoje, odovzdanie na labák.
- **Laborant** — výsledky skúšok, verdikt SCHVÁLENÉ / ZAMIETNUTÉ (QC brána).
- **Majster lisovne** — výrobné príkazy, výkony lisov, nepodarky, orez, expedícia.
- **Ekonóm / back-office** — faktúry, príjemky, sklad, mesačné uzávierky, reporty.
- **Administrátor / konateľ** — všetko + používatelia, receptúry, číselníky, sadzby.

Každý zápis má audit trail (kto, kedy, čo zmenil) — píš pod vlastným účtom.

---

*Stránky príručky: 00 spoločné pokyny · 01 majster valcovne · 02 laborant · 03 majster lisovne · 04 ekonómka · 05 admin*
