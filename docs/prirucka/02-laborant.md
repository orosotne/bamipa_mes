# Príručka — Laborant

## Čo vidíš po prihlásení

Systém ťa presmeruje do modulu **Labák** (nadpis „Labák — QC brána"). Je to jediný modul v tvojom ľavom paneli. Hore je fronta dávok čakajúcich na meranie a verdikt (karty s číslom dávky, zmesou, kg a dátumom), dole karta **Trendy parametrov (SPC)**. Dávka, ktorá už bola raz zamietnutá a vracia sa po úprave, má štítok **Opakovaný test**.

Bez verdiktu **SCHVÁLENÉ** sa dávka nedá použiť v lisovni — ty si QC brána.

## Denný postup: meranie a verdikt

### 1. Otvoriť dávku

1. Vo fronte ťukni na kartu dávky (napr. `V-2026-0012`).
2. V hlavičke vidíš číslo dávky, stav, zmes s verziou receptu a vyrobené kg.

### 2. Zapísať meranie

1. Karta **Zápis meraní** ponúka všetky parametre zmesi s limitmi (napr. `ML · limit 40 – 60`).
2. Zapíš nameranú hodnotu ku každému parametru. Riadok sa hneď zafarbí: **zelený** = v limite, **červený s výstražným trojuholníkom** = mimo limitu. Pod formulárom sa počíta, koľko parametrov je mimo limitu.
3. Ťukni na **Zapísať meranie** → hláška *„Meranie zapísané — vynes verdikt."*

Ak nejaký parameter chýba, systém zápis odmietne: *„Doplň všetky parametre (chýba: …)."* Meranie je vždy kompletná sada.

### 3. Vyniesť verdikt

Po zápise sa zobrazí karta **Verdikt — meranie #N** s tabuľkou výsledkov (hodnoty mimo limitu sú podfarbené načerveno, stĺpec Stav: „v limite" / „mimo").

- **SCHVÁLIŤ** — dávka prejde do stavu **Schválená**: *„Dávka schválená — možno ju použiť v lisovni."*
  - Ak sú hodnoty mimo limitu, systém si vyžiada potvrdenie v dialógu **Schváliť napriek limitom?** → **Áno, schváliť**.
- **ZAMIETNUŤ** — otvorí sa dialóg **Zamietnutie dávky** s povinným poľom **Inštrukcia na úpravu dávky** (napr. „Pridať 1,5 kg síry a znovu premiešať 5 min."). Ťukni na **Zamietnuť a odoslať na úpravu**.
  - Bez inštrukcie to nejde: *„Zadaj inštrukciu na úpravu dávky."*
  - Dávka prejde do stavu **Zamietnutá**: *„Dávka zamietnutá — blokovaná pre lisovňu."* Majster valcovne ju upraví podľa tvojej inštrukcie a znovu odovzdá — vo fronte ju uvidíš so štítkom **Opakovaný test**.

K verdiktu sa loguje tvoje meno a čas. Všetky merania dávky zostávajú v karte **História meraní** (s limitmi platnými v čase merania — „Limit (snapshot)").

### 4. Trendy parametrov (SPC)

Na úvodnej stránke Labáku vyber **zmes** a **parameter** — graf ukáže vývoj nameraných hodnôt naprieč dávkami voči limitom.

## Na čo si dať pozor

- **Verdikt sa nedá vziať späť.** Pri pokuse o druhý verdikt: *„Meranie už má vynesený verdikt."* Ak si sa pomýlil, okamžite informuj majstra lisovne (aby zmes nepoužil) a admina.
- *„Zmes nemá definované limity labáku."* / *„Bez limitov sa dávka nedá merať — najprv ich nastav v receptúre."* — limity per zmes nastavuje **admin** v Receptúrach (tlačidlo „Nastaviť limity zmesi" ťa tam pustí len ako admina). Požiadaj ho.
- Zamietnutie vždy sprevádzaj konkrétnou inštrukciou — majster valcovne robí presne to, čo napíšeš.
- Schválenie s hodnotami mimo limitu je tvoja zodpovednosť — systém ho dovolí len po výslovnom potvrdení.

## Mini-FAQ

**Vo fronte niet dávky, ktorú majster hlási ako hotovú.**
Do fronty padajú len dávky v stave **Čaká na labák**. Majster ju musí najprv „Odovzdať na labák" (so skutočnou výrobou v kg).

**Zapísal som zlú hodnotu, ale ešte som nevyniesol verdikt.**
Uložené meranie sa už nedá prepísať — po zápise máš len SCHVÁLIŤ / ZAMIETNUŤ. Preto si hodnoty skontroluj **pred** ťuknutím na „Zapísať meranie" (dovtedy ich meníš voľne). Ak si omylom uložil nesprávne čísla, obráť sa na admina.

**Dávka po úprave prišla znova — meriam všetko odznova?**
Áno, každé meranie je kompletná sada parametrov. Staré merania zostávajú v Histórii meraní (#1, #2…).

**Čo znamená „Opakovaný test"?**
Dávka už bola zamietnutá a majster ju po úprave odovzdal znova.

**Prečo v grafe trendov nič nie je?**
Pre zvolenú kombináciu zmesi a parametra zatiaľ neexistujú merania — vyber inú zmes alebo parameter.
