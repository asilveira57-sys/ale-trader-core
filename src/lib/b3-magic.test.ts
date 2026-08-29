import { describe, expect, it } from "vitest";
import {
  REAL_MAGIC_ASSET_BLOCK,
  REAL_MAGIC_VARIANT_BLOCK,
  REAL_MAGIC_VARIANT_HIGH_BLOCK,
  REAL_MAGIC_MODE_INDEX,
  REAL_MAGIC_MODE_INDEX_V2,
  realMagicNumber,
  MagicNumberNotRegisteredError,
} from "./b3-magic";

const ALL_VARIANTS = [
  ...Object.keys(REAL_MAGIC_VARIANT_BLOCK),
  ...Object.keys(REAL_MAGIC_VARIANT_HIGH_BLOCK),
];

describe("realMagicNumber", () => {
  it("gera magics únicos para TODAS as combinações ativo × modalidade × modo", () => {
    const assets = Object.keys(REAL_MAGIC_ASSET_BLOCK);
    const modes = Object.keys(REAL_MAGIC_MODE_INDEX);
    expect(assets.length).toBe(10);
    expect(ALL_VARIANTS.length).toBe(5);
    expect(modes.length).toBe(7);

    const seen = new Map<number, string>();
    for (const a of assets) {
      for (const v of ALL_VARIANTS) {
        for (const m of modes) {
          const magic = realMagicNumber(a, v, m);
          expect(seen.has(magic)).toBe(false);
          seen.set(magic, `${a}|${v}|${m}`);
        }
      }
    }
    expect(seen.size).toBe(assets.length * ALL_VARIANTS.length * modes.length);
    expect(seen.size).toBe(350);
    expect(Math.max(...seen.keys())).toBe(20906);
    // Os quatro ativos originais precisam manter a numeração já em uso.
    expect(realMagicNumber("WIN", "indicador", "conservador")).toBe(2001);
    expect(realMagicNumber("VALE3", "range", "agressivo")).toBe(3805);
    // Dinheiro real: este número está na lista branca do executor.
    expect(realMagicNumber("WIN", "price_action", "semi_agressivo")).toBe(2504);
    // Modos novos entram no fim, sem deslocar nenhum dos cinco anteriores.
    expect(realMagicNumber("WIN", "indicador", "cauteloso")).toBe(2006);
    expect(realMagicNumber("WIN", "indicador", "arrojado")).toBe(2007);
    expect(realMagicNumber("WIN", "rompimento", "cauteloso")).toBe(20005);
    expect(realMagicNumber("WIN", "rompimento", "arrojado")).toBe(20006);
  });

  it("quinta modalidade (rompimento) usa bloco alto separado, sem colidir com ITUB4", () => {
    // Fórmula nova: 20000 + índice_do_ativo × 100 + índice_do_modo (0..4).
    expect(realMagicNumber("WIN", "rompimento", "conservador")).toBe(20000);
    expect(realMagicNumber("WIN", "rompimento", "agressivo")).toBe(20004);
    expect(realMagicNumber("WDO", "rompimento", "moderado")).toBe(20101);
    expect(realMagicNumber("PETR4", "rompimento", "equilibrado")).toBe(20202);
    expect(realMagicNumber("ITUB4", "rompimento", "semi_agressivo")).toBe(20403);
    expect(realMagicNumber("SOL", "rompimento", "agressivo")).toBe(20904);
    // A colisão que motivou o bloco alto: WIN rompimento NÃO pode cair em
    // 4000..4005 (bloco do ITUB4 indicador).
    const itub4Indicador = Object.keys(REAL_MAGIC_MODE_INDEX).map((m) => realMagicNumber("ITUB4", "indicador", m));
    const winRompimento = Object.keys(REAL_MAGIC_MODE_INDEX).map((m) => realMagicNumber("WIN", "rompimento", m));
    for (const magic of winRompimento) expect(itub4Indicador.includes(magic)).toBe(false);
  });

  it("reduz contrato futuro à raiz", () => {
    expect(realMagicNumber("BITQ26", "indicador", "conservador")).toBe(10001);
    expect(realMagicNumber("ITUB4", "indicador", "conservador")).toBe(4001);
    expect(realMagicNumber("WINV26", "rompimento", "conservador")).toBe(20000);
  });

  it("falha fechada para ativo/modalidade/modo não cadastrado", () => {
    expect(() => realMagicNumber("XPTO9", "indicador", "conservador")).toThrow(MagicNumberNotRegisteredError);
    expect(() => realMagicNumber("WIN", "scalp", "conservador")).toThrow(MagicNumberNotRegisteredError);
    expect(() => realMagicNumber("WIN", "indicador", "turbo")).toThrow(MagicNumberNotRegisteredError);
    expect(() => realMagicNumber("XPTO9", "rompimento", "conservador")).toThrow(MagicNumberNotRegisteredError);
    expect(() => realMagicNumber("WIN", "rompimento", "turbo")).toThrow(MagicNumberNotRegisteredError);
  });

  it("modos do bloco alto usam índice 0..4 na mesma ordem dos modos clássicos", () => {
    expect(Object.keys(REAL_MAGIC_MODE_INDEX_V2)).toEqual(Object.keys(REAL_MAGIC_MODE_INDEX));
  });
});
