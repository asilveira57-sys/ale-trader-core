import { describe, it, expect } from "vitest";
import { resolverLimites, aceitarCapital, contratosProporcionais } from "./b3-proporcional";

const base = { limites_proporcionais: true, peak_lock_min_profit_brl: 700, daily_gain_target_brl: 990,
  daily_loss_limit_brl: 500, max_contracts: 3, trailing_activation_pts: 150, trailing_giveback_pts: 60,
  peak_lock_min_profit_pct: 7, daily_gain_target_pct: 9.9, daily_loss_limit_pct: 5, risco_contratos_pct: 50,
  trailing_activation_pct_stop: 50, trailing_giveback_pct_stop: 20 };

describe("limites proporcionais", () => {
  it("piso do pico com R$ 469,58 fica menor que o capital", () => {
    const r = resolverLimites(base, 469.58, 300);
    expect(r.peak_lock_min_profit_brl!).toBeLessThan(469.58);
  });
  it("mudança de capital move todos os limites em reais sozinha", () => {
    const a = resolverLimites(base, 1000, 300, { margemContrato: 155 });
    const b = resolverLimites(base, 2000, 300, { margemContrato: 155 });
    expect(b.peak_lock_min_profit_brl).toBe(a.peak_lock_min_profit_brl! * 2);
    expect(b.daily_loss_limit_brl).toBe(a.daily_loss_limit_brl! * 2);
    expect(b.daily_gain_target_brl).toBe(a.daily_gain_target_brl! * 2);
  });
  it("contratos dobram com capital dobrado", () => {
    expect(contratosProporcionais(3100, 50, 155)).toBe(10);
    expect(contratosProporcionais(6200, 50, 155)).toBe(20);
    expect(contratosProporcionais(6200, 50, 155, 4)).toBe(4);
  });
  it("sem margem do ativo mantém contratos fixos", () => {
    expect(resolverLimites(base, 5000, 300, { margemContrato: 0 }).max_contracts).toBe(3);
  });
  it("pontos seguem o stop, não o capital", () => {
    expect(resolverLimites(base, 469, 300).trailing_activation_pts).toBe(150);
    expect(resolverLimites(base, 99999, 300).trailing_activation_pts).toBe(150);
    expect(resolverLimites(base, 469, 100).trailing_activation_pts).toBe(50);
  });
  it("chave desligada = valores fixos", () => {
    const r = resolverLimites({ ...base, limites_proporcionais: false }, 469, 300, { margemContrato: 155 });
    expect(r).toMatchObject({ peak_lock_min_profit_brl: 700, max_contracts: 3, trailing_activation_pts: 150 });
  });
});

describe("trava assimétrica do capital", () => {
  it("alta de 469 para 2.192 fica em quarentena até 3 leituras", () => {
    let s = { aceito: 469.58, pendente: null as number | null, leituras: 0 };
    let r = aceitarCapital(s, 2192); expect(r.aceito).toBe(469.58); expect(r.saltou).toBe(true);
    r = aceitarCapital(r, 2192); expect(r.aceito).toBe(469.58);
    r = aceitarCapital(r, 2192); expect(r.aceito).toBe(2192);
  });
  it("queda de 2.192 para 469 é aceita na primeira leitura", () => {
    const r = aceitarCapital({ aceito: 2192, pendente: null, leituras: 0 }, 469.58);
    expect(r.aceito).toBe(469.58); expect(r.quarentena).toBe(false);
  });
});
