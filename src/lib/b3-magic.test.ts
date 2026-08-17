import { describe, expect, it } from "vitest";
import {
  REAL_MAGIC_ASSET_BLOCK,
  REAL_MAGIC_VARIANT_BLOCK,
  REAL_MAGIC_MODE_INDEX,
  realMagicNumber,
  MagicNumberNotRegisteredError,
} from "./b3-magic";

describe("realMagicNumber", () => {
  it("gera 200 magic numbers únicos (10 ativos × 4 modalidades × 5 modos)", () => {
    const assets = Object.keys(REAL_MAGIC_ASSET_BLOCK);
    const variants = Object.keys(REAL_MAGIC_VARIANT_BLOCK);
    const modes = Object.keys(REAL_MAGIC_MODE_INDEX);
    expect(assets.length).toBe(10);

    const seen = new Map<number, string>();
    for (const a of assets) {
      for (const v of variants) {
        for (const m of modes) {
          const magic = realMagicNumber(a, v, m);
          expect(seen.has(magic)).toBe(false);
          seen.set(magic, `${a}|${v}|${m}`);
        }
      }
    }
    expect(seen.size).toBe(assets.length * variants.length * modes.length);
    expect(seen.size).toBe(200);
    expect(Math.max(...seen.keys())).toBe(4405);
  });

  it("reduz contrato futuro à raiz", () => {
    expect(realMagicNumber("BITQ26", "indicador", "conservador")).toBe(2701);
    expect(realMagicNumber("ITUB4", "indicador", "conservador")).toBe(2401);
  });

  it("falha fechada para ativo/modalidade/modo não cadastrado", () => {
    expect(() => realMagicNumber("XPTO9", "indicador", "conservador")).toThrow(MagicNumberNotRegisteredError);
    expect(() => realMagicNumber("WIN", "scalp", "conservador")).toThrow(MagicNumberNotRegisteredError);
    expect(() => realMagicNumber("WIN", "indicador", "turbo")).toThrow(MagicNumberNotRegisteredError);
  });
});
