# CLAUDE.md — bamipa-ctr
- Zdroj pravdy: SPEC.md + DECISIONS.md. Nič nad rámec sekcie 9 (Ne-ciele).
- Stack: Next.js App Router, TS strict, Tailwind v4, shadcn/ui, Drizzle + Supabase.
- UI po slovensky, terminológia zo SPEC.md doslovne. Peniaze v centoch (integer).
- Migrácie NIKDY nemazať/neprepisovať, len pridávať nové. Žiadny drop DB.
- Pred každým väčším feature: najprv plán, čakaj na schválenie.
- Kalkulačná logika (M7) len cez TDD — testy pred implementáciou.