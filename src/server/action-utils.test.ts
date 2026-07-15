import { describe, expect, test } from "vitest";
import { naVysledok } from "./action-utils";

describe("naVysledok", () => {
  test("obyčajná Error vráti svoju hlášku", () => {
    expect(naVysledok(new Error("Doménová chyba."))).toEqual({
      ok: false,
      error: "Doménová chyba.",
    });
  });

  test("DrizzleQueryError obal ('Failed query: …') sa rozbalí na PG hlášku z cause", () => {
    const pg = new Error("Prekročený zostatok dávky V-2026-0001.");
    const wrapper = new Error('Failed query: insert into "press_runs" …', {
      cause: pg,
    });
    expect(naVysledok(wrapper)).toEqual({
      ok: false,
      error: "Prekročený zostatok dávky V-2026-0001.",
    });
  });

  test("obal bez doménovej cause hlášky vráti aspoň svoju", () => {
    const wrapper = new Error("Failed query: select 1");
    expect(naVysledok(wrapper)).toEqual({
      ok: false,
      error: "Failed query: select 1",
    });
  });
});
