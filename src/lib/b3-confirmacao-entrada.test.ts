import { describe, expect, it } from "vitest";
import {
  CONFIRMACAO_PADRAO, avaliarConfirmacao, confirmacaoExigidaPts,
  confirmacaoNaAbertura, confirmacaoRegraTexto,
  confirmacaoArmada, avaliarPendente, criarPendente, motivoNaoConfirmou, ladoDoPendente,
} from "./b3-confirmacao-entrada";

const abertura = "2026-09-23T13:00:00.000Z";
const t = (segundos: number) => new Date(abertura).getTime() + segundos * 1000;

describe("confirmação de entrada em sombra", () => {
  it("limiar é percentual do stop do próprio robô", () => {
    expect(confirmacaoExigidaPts(100, 50)).toBe(50);
    expect(confirmacaoExigidaPts(30, 50)).toBe(15);
    expect(confirmacaoExigidaPts(0, 50)).toBe(0);
    // sem percentual configurado cai no pré-preenchido
    expect(confirmacaoExigidaPts(100, null)).toBe(CONFIRMACAO_PADRAO.pct_stop);
  });

  it("abertura grava limiar e janela, com confirmação indefinida", () => {
    const f = confirmacaoNaAbertura({ confirmacao_pct_stop: 50, confirmacao_janela_s: 180 }, 200);
    expect(f.confirmacao_exigida_pts).toBe(100);
    expect(f.confirmacao_janela_s).toBe(180);
    expect(f.confirmou).toBeNull();
    expect(f.stop_recalculado).toBeNull();
  });

  const ordem = {
    side: "buy", entry_price: 140000, entry_time: abertura,
    stop_pts: 200, gain_pts: 300,
    confirmacao_exigida_pts: 100, confirmacao_janela_s: 180,
    confirmou: null as boolean | null,
  };

  it("confirma quando o preço anda o exigido a favor, e recalcula stop e alvo", () => {
    const p = avaliarConfirmacao(ordem, 140105, 5, t(60));
    expect(p?.confirmou).toBe(true);
    expect(p?.preco_confirmacao).toBe(140105);
    expect(p?.stop_recalculado).toBe(139905);
    expect(p?.alvo_recalculado).toBe(140405);
  });

  it("dentro da janela e sem andar o exigido, nada muda (sem gravação)", () => {
    expect(avaliarConfirmacao(ordem, 140040, 5, t(60))).toBeNull();
  });

  it("janela vencida sem andar o exigido fecha a medição como não confirmada", () => {
    expect(avaliarConfirmacao(ordem, 139900, 5, t(200))).toEqual({ confirmou: false });
  });

  it("venda mede na direção da venda", () => {
    const venda = { ...ordem, side: "sell" };
    expect(avaliarConfirmacao(venda, 139890, 5, t(60))?.confirmou).toBe(true);
    expect(avaliarConfirmacao(venda, 140110, 5, t(60))).toBeNull();
  });

  it("ordem já medida não é remedida", () => {
    expect(avaliarConfirmacao({ ...ordem, confirmou: true }, 141000, 5, t(60))).toBeNull();
    expect(avaliarConfirmacao({ ...ordem, confirmou: false }, 141000, 5, t(60))).toBeNull();
  });

  it("sem limiar (stop zerado na abertura) não há medição", () => {
    expect(avaliarConfirmacao({ ...ordem, confirmacao_exigida_pts: 0 }, 141000, 5, t(60))).toBeNull();
  });

  it("rótulo da regra em português", () => {
    expect(confirmacaoRegraTexto(50, 180)).toBe("50% do stop em 3 min");
    expect(confirmacaoRegraTexto(null, null)).toBe("50% do stop em 3 min");
    expect(confirmacaoRegraTexto(25, 30)).toBe("25% do stop em 30 s");
  });
});

// ── Regra LIGADA, dois lados: espera, confirmação e descarte ─────────────────
describe("regra ligada", () => {
  const cfg = {
    confirmacao_ativa_simulado: true, confirmacao_ativa_real: true,
    confirmacao_pct_stop: 50, confirmacao_janela_s: 180,
  };
  const ambos = { aguardaSimulado: true, aguardaReal: true };

  it("as duas chaves são independentes", () => {
    expect(confirmacaoArmada(cfg, "simulado")).toBe(true);
    expect(confirmacaoArmada(cfg, "real")).toBe(true);
    expect(confirmacaoArmada({ ...cfg, confirmacao_ativa_simulado: false }, "simulado")).toBe(false);
    expect(confirmacaoArmada({ ...cfg, confirmacao_ativa_simulado: false }, "real")).toBe(true);
    expect(confirmacaoArmada({ ...cfg, confirmacao_ativa_real: false }, "simulado")).toBe(true);
    expect(confirmacaoArmada({ ...cfg, confirmacao_ativa_real: false }, "real")).toBe(false);
    expect(confirmacaoArmada({ ...cfg, confirmacao_pct_stop: 0 }, "simulado")).toBe(false);
    expect(confirmacaoArmada({}, "simulado")).toBe(false);
  });

  it("aguarda, confirma e expira", () => {
    const t0 = Date.parse("2026-09-23T13:00:00Z");
    const pend = criarPendente({ side: "buy", precoSinal: 100_000, stopPtsFrozen: 280, gainPtsFrozen: 400, cfg, agoraMs: t0, ...ambos })!;
    expect(pend.exigido_pts).toBe(140);
    expect(avaliarPendente(pend, 100_034, t0 + 30_000).estado).toBe("aguardando");
    expect(avaliarPendente(pend, 100_140, t0 + 60_000).estado).toBe("confirmou");
    expect(avaliarPendente(pend, 100_034, t0 + 200_000).estado).toBe("expirou");
  });

  it("venda confirma quando o preço cai", () => {
    const t0 = Date.parse("2026-09-23T13:00:00Z");
    const pend = criarPendente({ side: "sell", precoSinal: 100_000, stopPtsFrozen: 200, gainPtsFrozen: 300, cfg, agoraMs: t0, ...ambos })!;
    expect(avaliarPendente(pend, 99_890, t0 + 10_000).estado).toBe("confirmou");
    expect(avaliarPendente(pend, 100_050, t0 + 10_000).estado).toBe("aguardando");
  });

  it("sem lado esperando não existe espera", () => {
    const t0 = Date.parse("2026-09-23T13:00:00Z");
    expect(criarPendente({
      side: "buy", precoSinal: 100_000, stopPtsFrozen: 280, gainPtsFrozen: 400,
      cfg, agoraMs: t0, aguardaSimulado: false, aguardaReal: false,
    })).toBeNull();
  });

  it("o lado do descarte sai do que estava esperando", () => {
    const t0 = Date.parse("2026-09-23T13:00:00Z");
    const base = { side: "buy", precoSinal: 100_000, stopPtsFrozen: 280, gainPtsFrozen: 400, cfg, agoraMs: t0 };
    expect(ladoDoPendente(criarPendente({ ...base, ...ambos }))).toBe("ambos");
    expect(ladoDoPendente(criarPendente({ ...base, aguardaSimulado: true, aguardaReal: false }))).toBe("simulado");
    expect(ladoDoPendente(criarPendente({ ...base, aguardaSimulado: false, aguardaReal: true }))).toBe("real");
  });

  it("motivo do descarte diz quanto andou, o exigido e o lado", () => {
    const t0 = Date.parse("2026-09-23T13:00:00Z");
    const soSim = criarPendente({ side: "buy", precoSinal: 100_000, stopPtsFrozen: 280, gainPtsFrozen: 400, cfg, agoraMs: t0, aguardaSimulado: true, aguardaReal: false })!;
    const av = avaliarPendente({ ...soSim, melhor_pts: 34 }, 100_010, t0 + 200_000);
    expect(motivoNaoConfirmou(soSim, av, 50)).toBe(
      "Preço andou 34 pts a favor; exigido 140 pts (50% do stop) em 180s. Entrada descartada no simulado.",
    );
    const soReal = { ...soSim, aguarda_simulado: false, aguarda_real: true };
    expect(motivoNaoConfirmou(soReal, av, 50)).toContain("descartada no real.");
    expect(motivoNaoConfirmou({ ...soSim, aguarda_real: true }, av, 50)).toContain("no simulado e no real.");
  });
});
