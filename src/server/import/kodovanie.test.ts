// Auto-detekcia kódovania: UTF-8 prejde ako je, Windows-1250 sa prevedie;
// kódovania, ktoré cp1250 nezachráni, zanechajú riadiace znaky (guard v
// actions.ts ich odmietne).
import { describe, expect, test } from "vitest";
import { dekodujCsv, maZlomeneKodovanie } from "./kodovanie";

describe("dekodujCsv", () => {
  test("platné UTF-8 s diakritikou ostáva bez zmeny", () => {
    const bajty = new TextEncoder().encode("kod;nazov\nK1;Kaučuk šžť\n");

    expect(dekodujCsv(bajty)).toBe("kod;nazov\nK1;Kaučuk šžť\n");
  });

  test("UTF-8 s BOM — BOM sa odstráni pri dekódovaní", () => {
    const bajty = new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0x62]);

    expect(dekodujCsv(bajty)).toBe("ab");
  });

  test("Windows-1250 (Excel CSV oddelený čiarkami) sa prevedie automaticky", () => {
    // "Kaučuk šžť" v cp1250: č=0xE8, š=0x9A, ž=0x9E, ť=0x9D (nevalidné UTF-8)
    const bajty = new Uint8Array([
      0x4b, 0x61, 0x75, 0xe8, 0x75, 0x6b, 0x20, 0x9a, 0x9e, 0x9d,
    ]);

    expect(dekodujCsv(bajty)).toBe("Kaučuk šžť");
  });

  test("prázdny vstup → prázdny reťazec", () => {
    expect(dekodujCsv(new Uint8Array())).toBe("");
  });
});

describe("maZlomeneKodovanie", () => {
  test("UTF-16 (NUL medzi znakmi) → zlomené", () => {
    // FF FE = UTF-16LE BOM, potom "a","b"
    const bajty = new Uint8Array([0xff, 0xfe, 0x61, 0x00, 0x62, 0x00]);

    expect(maZlomeneKodovanie(dekodujCsv(bajty))).toBe(true);
  });

  test("nedefinovaný cp1250 bajt (0x81 → C1 riadiaci znak) → zlomené", () => {
    const bajty = new Uint8Array([0x41, 0x81, 0x42]);

    expect(maZlomeneKodovanie(dekodujCsv(bajty))).toBe(true);
  });

  test("čistý cp1250 text s diakritikou → v poriadku (žiadny falošný poplach)", () => {
    // "Kaučuk" v cp1250: č=0xE8
    const bajty = new Uint8Array([0x4b, 0x61, 0x75, 0xe8, 0x75, 0x6b]);
    const text = dekodujCsv(bajty);

    expect(text).toBe("Kaučuk");
    expect(maZlomeneKodovanie(text)).toBe(false);
  });

  test("UTF-8 s tabmi a novými riadkami → v poriadku", () => {
    expect(maZlomeneKodovanie("kod\tnazov\r\nK1\tGuma\n")).toBe(false);
  });
});
