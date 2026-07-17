# Príručka — Majster lisovne

## Čo vidíš po prihlásení

Pristaneš na **Prehľade** (výrobné KPI, prestoje a nepodarky). V ľavom paneli máš dva moduly: **Prehľad** a **Lisovňa** — pracuješ v **Lisovni** (nadpis „Lisovňa — výrobné príkazy"). Hore sú tlačidlá **Artikle**, **Expedícia** a **Nový príkaz**. Zoznam príkazov má stĺpce: Číslo príkazu, Artikel, Plán párov, Vyrobené (dobré), Nepodarky, Orez kg, Expedované, Stav. Stavy príkazu: **Nový → Vo výrobe → Dokončený** (alebo **Zrušený**).

Katalóg **Artikle** (modely podošiev, norma spotreby, predajná cena) len čítaš — mení ho admin.

## Denný postup

### 1. Založiť výrobný príkaz

1. Ťukni na **Nový príkaz**.
2. Vyber **Artikel (model podošvy)** — pri artikli vidíš kód priradenej zmesi.
3. Zadaj **Množstvo párov** (napr. 500).
4. Voliteľne ťukni **Vetvu prípravy zmesi**: **Barwell** alebo **Sekanie** (opätovným ťuknutím sa výber zruší). Prípadne dopíš **Poznámku**.
5. Ťukni na **Založiť príkaz** — systém pridelí číslo príkazu a otvorí jeho detail.

### 2. Zapísať výkon lisu (per lis a zmena)

1. V detaile príkazu v karte **Výkony lisov** vyplň formulár **Nový výkon**:
   1. **Dátum** a **Zmena** (Ranná / Poobedná / Nočná),
   2. **Lis** (LIS1–LIS9, STREKOLIS),
   3. **Dávka zmesi (len schválené)** — ponúkajú sa výlučne dávky schválené labákom, so zostatkom kg,
   4. **Počet cyklov**, **Vyrobené páry (dobré)**, **Spotreba zmesi (kg)**,
   5. **Obsluha**,
   6. **Nepodarky**: ťukni **+ Pridať nepodarok**, vyber dôvod z číselníka a zadaj páry,
   7. **Prestoje**: ťukni **+ Pridať prestoj**, vyber dôvod a zadaj minúty,
   8. prípadne **Poznámka**.
2. Ťukni na **Zapísať výkon** → hláška *„Výkon zapísaný."* Príkaz prejde do stavu **Vo výrobe**.

Omyl vo výkone opravíš ikonou koša pri riadku (**Stornovať výkon**) a novým zápisom — výkon sa needituje.

### 3. Zapísať orez / pretoky a prácu

1. **Orez / pretoky (odpad)**: zadaj **Kg**, dátum, prípadne poznámku → **Pridať**.
2. **Práca lisovne**: vyber pracovníka, dátum, zadaj hodiny → **Pridať** (orezávanie, zapravovanie, kontrola, balenie).

### 4. Dokončiť príkaz

1. Keď je vyrobené, ťukni vpravo hore na **Dokončiť príkaz**.
2. Potvrď otázku *„Dokončiť výrobný príkaz? Záznamy sa uzamknú."*
3. Na opravy slúži tlačidlo **Znovu otvoriť** (nezabudni potom príkaz opäť dokončiť). Príkaz v stave **Nový** bez výroby sa dá **Zrušiť**.

### 5. Expedícia — dodací list

1. Lisovňa → **Expedícia** → **Nový dodací list**.
2. Skontroluj **Dátum expedície** a **Odberateľa** (predvyplnené **LOWA**).
3. V **Položkách** vyber **Výrobný príkaz** (vidíš, koľko má voľných párov) a zadaj **Páry**; ďalšie riadky cez **+ Pridať položku**.
4. Ťukni na **Vytvoriť dodací list** → systém pridelí číslo a otvorí detail.
5. V detaile dodacieho listu je tlačidlo **Traceability report** — tlačová zostava pre odberateľa (bez cien a receptúr). Vytlačíš ju tlačidlom **Tlačiť**.
6. Omylom vytvorený dodací list stornuješ tlačidlom **Stornovať DL** — páry sa vrátia na sklad hotových výrobkov.

## Na čo si dať pozor

- **Lisovať možno len zmes schválenú labákom.** Ak nie je čo vybrať: *„Žiadna schválená dávka zmesi so zostatkom — lisovať možno len zmes schválenú labákom."* Systém to stráži tvrdo aj v databáze: *„Dávka … nie je schválená labákom — výdaj zmesi do lisovne je zakázaný."*
- **Zostatok dávky**: spotreba zmesi nesmie presiahnuť vyrobené kg dávky — *„Prekročený zostatok dávky … — spotreba … kg presahuje vyrobených … kg."*
- **Expedovať sa nedá viac, než je vyrobené**: *„Nedostatok hotových párov: príkaz má vyrobených X párov, expedovalo by sa Y párov."*
- Dokončený príkaz je uzamknutý: *„Príkaz je dokončený — záznamy sú uzamknuté. Na opravy ho znovu otvor."*
- Väzba výkonu na dávku a príkaz je nemenná — **oprava = storno a nový záznam**.
- Uzavretý mesiac sa nedá meniť — hláška *„Mesiac … je uzavretý … nemožno meniť."* Reopen smie len admin.

## Mini-FAQ

**Prečo v „Dávka zmesi (len schválené)" nevidím dávku, ktorá je hotová?**
Buď ešte nemá verdikt SCHVÁLENÉ od labáku, alebo už nemá zostatok kg, alebo je z inej zmesi, než vyžaduje artikel príkazu.

**Zapísal som výkon na zlý lis / zlú dávku.**
Výkon stornuj (ikona koša, potvrdenie „Stornovať výkon z …") a zapíš nanovo. Editovať sa nedá.

**Kde vidím nepodarkovosť?**
V detaile príkazu v karte **Súhrn výroby** (nepodarky aj %), celkové čísla na **Prehľade**.

**Ako odberateľ dostane traceabilitu?**
Detail dodacieho listu → **Traceability report** → **Tlačiť**. Report vedie reťazec dodávka → výrobný príkaz → dávka zmesi → šarže surovín, bez cien.

**Založil som príkaz na zlý artikel.**
Príkaz sa v aplikácii editovať nedá. Kým je **Nový** bez výkonov, ťukni **Zrušiť príkaz** a založ nový so správnym artiklom.
