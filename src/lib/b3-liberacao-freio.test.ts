import { describe, it, expect } from "vitest";
import { separarLiberacoes, freioLiberado, chaveLiberacao, type Liberacao } from "./b3-liberacao-freio.server";

const base: Liberacao = {
  escopo: "robo", symbol: "WIN", variant: "price_action", mode: "camila",
  freio: "pico", desde: "2026-09-16T13:00:00Z", trade_date: "2026-09-16",
};

// 16/09/2026 12:00 BRT (15:00Z) — pregão aberto (quarta-feira).
const pregaoAberto = new Date("2026-09-16T15:00:00Z");
// 16/09/2026 21:00 BRT — pregão fechado.
const pregaoFechado = new Date("2026-09-17T00:00:00Z");

describe("liberação manual de freio", () => {
  it("vale enquanto é o mesmo pregão", () => {
    const { ativas, expiradas } = separarLiberacoes([base], pregaoAberto);
    expect(ativas).toHaveLength(1);
    expect(expiradas).toHaveLength(0);
  });

  it("não atravessa o fim do pregão", () => {
    const { ativas, expiradas } = separarLiberacoes([base], pregaoFechado);
    expect(ativas).toHaveLength(0);
    expect(expiradas).toHaveLength(1);
  });

  it("não atravessa o dia", () => {
    const ontem = { ...base, trade_date: "2026-09-15" };
    const { ativas, expiradas } = separarLiberacoes([ontem], pregaoAberto);
    expect(ativas).toHaveLength(0);
    expect(expiradas).toHaveLength(1);
  });

  it("liberação por robô vale só para aquele robô e aquele freio", () => {
    expect(freioLiberado([base], "WIN", "price_action", "camila", "pico")).not.toBeNull();
    expect(freioLiberado([base], "WIN", "price_action", "davi", "pico")).toBeNull();
    expect(freioLiberado([base], "WIN", "price_action", "camila", "grupo")).toBeNull();
    expect(freioLiberado([base], "WDO", "price_action", "camila", "pico")).toBeNull();
  });

  it("liberação de grupo vale para todos os robôs do grupo", () => {
    const grupo: Liberacao = { ...base, escopo: "grupo", mode: null, freio: "grupo" };
    for (const mode of ["camila", "davi", "ana", "amanda"]) {
      expect(freioLiberado([grupo], "WIN", "price_action", mode, "grupo")).not.toBeNull();
    }
    expect(freioLiberado([grupo], "WIN", "vwap", "camila", "grupo")).toBeNull();
  });

  it("a chave distingue escopo, alvo e freio", () => {
    expect(chaveLiberacao(base)).not.toBe(chaveLiberacao({ ...base, freio: "grupo" }));
    expect(chaveLiberacao(base)).not.toBe(chaveLiberacao({ ...base, escopo: "grupo", mode: null }));
  });
});
