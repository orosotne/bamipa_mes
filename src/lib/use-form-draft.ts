"use client";

// D8 (tablet-first): formulár nesmie stratiť rozpísaný záznam pri náhodnom
// zatvorení tabletu/prehliadača — draft žije v localStorage pod vlastným kľúčom.
import { useEffect, useState } from "react";

export function useFormDraft<T>(
  key: string,
  initial: T,
): [T, (next: T) => void, (resetTo?: T) => void] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // localStorage nedostupné (súkromné okno) — draft sa jednoducho neuloží
    }
  }, [key, value]);

  // `resetTo` umožňuje volajúcemu zresetovať na AKTUÁLNU hodnotu namiesto
  // `initial` zachyteného v uzávere pri vytvorení handlera — inak by po
  // úspešnej mutácii (napr. čiastočný výdaj navážky) clear() prepísal draft
  // zastaraným `initial` z render-u pred mutáciou, nie čerstvo prepočítanou
  // hodnotou po revalidácii.
  function clear(resetTo?: T) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // no-op
    }
    setValue(resetTo ?? initial);
  }

  return [value, setValue, clear];
}
