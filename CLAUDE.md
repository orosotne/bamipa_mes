# CLAUDE.md — bamipa-ctr
- Zdroj pravdy: SPEC.md + DECISIONS.md. Nič nad rámec sekcie 9 (Ne-ciele).
- Stack: Next.js App Router, TS strict, Tailwind v4, shadcn/ui, Drizzle + Supabase.
- UI po slovensky, terminológia zo SPEC.md doslovne. Peniaze v centoch (integer).
- Migrácie NIKDY nemazať/neprepisovať, len pridávať nové. Žiadny drop DB.
- Pred každým väčším feature: najprv plán, čakaj na schválenie.
- Kalkulačná logika (M7) len cez TDD — testy pred implementáciou.
- MANUAL for BAMIPA_MES: používateľská príručka = docs/prirucka/*.md (zdroj per rola) + src/app/(app)/manual/manual-obsah.ts (obsah internej stránky /manual — v appke, so sidebar-om, modul „manual" pre všetky roly). Pri KAŽDEJ zmene logiky alebo UI (tlačidlá, polia, hlášky, toky, RBAC, nové moduly) aktualizuj OBOJE v tom istom commite — kroky popíš presne podľa kódu, nič si nevymýšľaj.