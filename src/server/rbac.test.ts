// RBAC mapovanie rola → moduly (SPEC §4). Čistá logika, client-safe, TDD.
import { describe, expect, test } from "vitest";
import type { UserRole } from "@/lib/enums";
import {
  domovModul,
  MODULY,
  overRolu,
  smieVidiet,
  smieVidietRoute,
} from "./rbac";

describe("smieVidiet", () => {
  const cases: [UserRole, string[], string[]][] = [
    // rola, POVOLENÉ moduly, ZAKÁZANÉ moduly
    [
      "ekonom",
      ["faktury", "dodavatelia", "sklad"],
      ["vyroba", "labak", "ciselniky", "pouzivatelia"],
    ],
    [
      "majster_valcovne",
      ["vyroba"],
      ["faktury", "sklad", "labak", "ciselniky", "pouzivatelia"],
    ],
    [
      "laborant",
      ["labak"],
      ["faktury", "vyroba", "sklad", "ciselniky", "pouzivatelia"],
    ],
    [
      "admin",
      ["faktury", "dodavatelia", "sklad", "vyroba", "receptury", "labak", "ciselniky", "pouzivatelia"],
      [],
    ],
    [
      "majster_lisovne",
      [],
      ["faktury", "vyroba", "labak", "sklad", "ciselniky", "pouzivatelia"],
    ],
  ];

  test.each(cases)("%s vidí správne moduly", (role, povolene, zakazane) => {
    for (const m of povolene) {
      expect(smieVidiet(role, m as (typeof MODULY)[number])).toBe(true);
    }
    for (const m of zakazane) {
      expect(smieVidiet(role, m as (typeof MODULY)[number])).toBe(false);
    }
  });
});

describe("smieVidietRoute", () => {
  test("mapuje prefix routy na modul", () => {
    expect(smieVidietRoute("laborant", "/labak")).toBe(true);
    expect(smieVidietRoute("laborant", "/labak/abc-123")).toBe(true);
    expect(smieVidietRoute("laborant", "/vyroba/xyz")).toBe(false);
    expect(smieVidietRoute("ekonom", "/faktury/nova")).toBe(true);
    expect(smieVidietRoute("majster_valcovne", "/vyroba")).toBe(true);
  });

  test("domovská stránka „/“ je prístupná každej role", () => {
    expect(smieVidietRoute("laborant", "/")).toBe(true);
    expect(smieVidietRoute("majster_lisovne", "/")).toBe(true);
  });

  test("neznáma routa → admin áno, ostatní nie", () => {
    expect(smieVidietRoute("admin", "/nieco-nezname")).toBe(true);
    expect(smieVidietRoute("laborant", "/nieco-nezname")).toBe(false);
  });
});

describe("domovModul", () => {
  test("mapuje rolu na domovský modul; majster_lisovne (F1) → null", () => {
    expect(domovModul("admin")).toBe("/faktury");
    expect(domovModul("ekonom")).toBe("/faktury");
    expect(domovModul("majster_valcovne")).toBe("/vyroba");
    expect(domovModul("laborant")).toBe("/labak");
    expect(domovModul("majster_lisovne")).toBeNull();
  });
});

describe("overRolu", () => {
  test("admin vždy prejde (aj bez uvedenia)", () => {
    expect(() => overRolu("admin")).not.toThrow();
    expect(() => overRolu("admin", "ekonom")).not.toThrow();
  });

  test("povolená rola prejde, nepovolená hodí slovenskú chybu", () => {
    expect(() => overRolu("laborant", "laborant")).not.toThrow();
    expect(() => overRolu("ekonom", "ekonom", "majster_valcovne")).not.toThrow();
    expect(() => overRolu("laborant", "ekonom")).toThrow(/oprávneni/i);
    expect(() => overRolu("ekonom", "laborant")).toThrow(/oprávneni/i);
  });

  test("bez povolených rolí = len admin", () => {
    expect(() => overRolu("admin")).not.toThrow();
    expect(() => overRolu("laborant")).toThrow(/oprávneni/i);
    expect(() => overRolu("ekonom")).toThrow(/oprávneni/i);
  });
});
