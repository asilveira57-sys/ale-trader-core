import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { createClient } from "@supabase/supabase-js";

// Opt-in, read-only regression against the owner's authenticated database.
// Never logs credentials and never changes orders, settings or balances.
describe.skipIf(process.env.B3_RPC_TEST !== "1")("disjuntor: recorte SQL de 10/11/2026", () => {
  const client = () => {
    const session = JSON.parse(readFileSync(`${homedir()}/.cache/lovable-auth/session.json`, "utf8")).session;
    const env = readFileSync(".env", "utf8");
    const value = (name: string) => env.match(new RegExp(`^${name}=["']?([^"'\\r\\n]+)`, "m"))?.[1];
    const url = value("VITE_SUPABASE_URL");
    const key = value("VITE_SUPABASE_PUBLISHABLE_KEY");
    if (!url || !key || !session.access_token || !session.user?.id) throw new Error("Sessão de teste indisponível");
    return { userId: session.user.id, sb: createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${session.access_token}` } } }) };
  };
  const cockpit = async (symbols: string[] | null, variants: string[] | null = null, modes: string[] | null = null) => {
    const { sb, userId } = client();
    const args = { p_user_id: userId, p_inicio: "2026-11-10", p_fim: "2026-11-10", p_symbols: symbols, p_variants: variants, p_modes: modes };
    const { data, error } = await sb.rpc("b3_cockpit_disjuntor_niveis", args);
    if (error) throw new Error(error.message);
    return { data, sb, userId, args };
  };
  // Desde 11/11/2026 (migration 0029) o disjuntor é por ativo e o total é a soma dos ativos.
  // Conferido em 10/11, com freio + disjuntor: WIN +10.413 · WDO -17.620 · BIT +3.824,40.
  for (const { symbols, level, expected } of [
    { symbols: ["WIN"], level: "ativo", expected: 10413 },
    { symbols: ["WIN", "WDO"], level: "total", expected: -7207 },
    { symbols: ["WIN", "WDO", "BIT"], level: "total", expected: -3382.6 },
    { symbols: null, level: "total", expected: -3382.6 },
  ]) {
    it(`${symbols?.join("+") ?? "NULL"}: ${level} = ${expected}`, async () => {
      const { data } = await cockpit(symbols);
      const row = data.rows.find((r: any) => r.nivel === level);
      expect(Number(row?.com_freio_disjuntor)).toBeCloseTo(expected, 2);
      if (level === "total") expect(row.disjuntor_atribuicao).toBe("soma dos disjuntores por ativo");
    }, 60000);
  }
  for (const symbols of [["WIN", "WDO"], ["WIN", "WDO", "BIT"], null]) {
    it(`${symbols?.join("+") ?? "NULL"}: total = soma dos ativos`, async () => {
      const { data } = await cockpit(symbols);
      const total = data.rows.find((r: any) => r.nivel === "total");
      const ativos = data.rows.filter((r: any) => r.nivel === "ativo");
      expect(ativos.length).toBeGreaterThan(1);
      const soma = ativos.reduce((sum: number, r: any) => sum + Number(r.com_freio_disjuntor), 0);
      expect(Number(total.com_freio_disjuntor)).toBeCloseTo(soma, 2);
      // A evidência diária do total traz a lista por_ativo e ela fecha com o valor do dia.
      const dia = total.disparos[0];
      expect(dia.por_ativo.map((a: any) => a.symbol).sort()).toEqual(ativos.map((r: any) => r.symbol).sort());
      const somaDia = dia.por_ativo.reduce((sum: number, a: any) => sum + Number(a.resultado_com_disjuntor_brl ?? 0), 0);
      expect(Number(dia.resultado_com_disjuntor_brl)).toBeCloseTo(somaDia, 2);
    }, 60000);
  }
  it("modalidade e modo filtram a curva e a capacidade em todos os níveis", async () => {
    const { data, sb, userId } = await cockpit(["WIN", "WDO"], ["range"], ["agressivo"]);
    const { data: capacity, error: ce } = await sb.rpc("b3_disjuntor_capacidade", { p_user_id: userId, p_symbols: ["WIN", "WDO"], p_variants: ["range"], p_modes: ["agressivo"] });
    if (ce) throw new Error(ce.message);
    expect(capacity.length).toBeGreaterThan(0);
    expect(capacity.every((r: any) => r.mode === "agressivo" && r.variant === "range")).toBe(true);
    const direto = async (symbols: string[], variants: string[]) => {
      const { data: direct, error } = await sb.rpc("b3_disjuntor_simulado", { p_user_id: userId, p_dia: "2026-11-10", p_symbols: symbols, p_variants: variants, p_modes: ["agressivo"], p_perdas_pct: [0.25], p_com_freio: true });
      if (error) throw new Error(error.message);
      return direct[0];
    };
    for (const row of data.rows.filter((r: any) => ["ativo", "modalidade"].includes(r.nivel))) {
      const symbols = [row.symbol];
      const variants = row.nivel === "modalidade" ? [row.variant] : ["range"];
      const direct = await direto(symbols, variants);
      expect(Number(row.com_freio_disjuntor)).toBe(Number(direct.resultado_com_disjuntor_brl ?? 0));
      const base = capacity.filter((r: any) => symbols.includes(r.symbol) && variants.includes(r.variant)).reduce((sum: number, r: any) => sum + Number(r.max_contracts) * Number(r.margin_per_contract_brl), 0);
      expect(Number(direct.capital_base_brl)).toBe(base);
    }
    // Total = soma dos disjuntores de cada ativo do recorte, cada um com o filtro de modalidade e modo.
    const total = data.rows.find((r: any) => r.nivel === "total");
    const ativos = data.rows.filter((r: any) => r.nivel === "ativo").map((r: any) => r.symbol);
    let soma = 0;
    for (const symbol of ativos) soma += Number((await direto([symbol], ["range"])).resultado_com_disjuntor_brl ?? 0);
    expect(Number(total.com_freio_disjuntor)).toBeCloseTo(soma, 2);
  }, 60000);
  // Desde 12/11/2026 (migration 0032) modalidade e robô mostram a parcela deles no disjuntor do ATIVO:
  // ordens com freio fechadas até a ordem do disparo do ativo. Logo somam o ativo, por dia e no período.
  it("modalidades e robôs somam o ativo na coluna com freio + disjuntor (WIN 10/11, com disparo)", async () => {
    const { data } = await cockpit(["WIN"]);
    const ativo = data.rows.find((r: any) => r.nivel === "ativo");
    const soma = (nivel: string) => data.rows.filter((r: any) => r.nivel === nivel).reduce((s: number, r: any) => s + Number(r.com_freio_disjuntor), 0);
    expect(Number(ativo.com_freio_disjuntor)).toBeCloseTo(10413, 2);
    expect(soma("modalidade")).toBeCloseTo(10413, 2);
    expect(soma("robo")).toBeCloseTo(10413, 2);
    const pa = data.rows.find((r: any) => r.nivel === "modalidade" && r.variant === "price_action");
    expect(Number(pa.com_freio_disjuntor)).toBeCloseTo(-3030, 2);
    expect(pa.disjuntor_atribuicao).toBe("parcela da modalidade no disjuntor do ativo");
    const daily = data.daily.filter((d: any) => d.gid === 0).reduce((s: number, d: any) => s + Number(d.com_freio_disjuntor), 0);
    expect(daily).toBeCloseTo(10413, 2);
  }, 60000);
  it("sem freio e com freio permanecem idênticos à função original", async () => {
    const { data, sb, args } = await cockpit(["WIN", "WDO"]);
    const { data: original, error } = await sb.rpc("b3_cockpit_tres_leituras", args);
    if (error) throw new Error(error.message);
    const values = (rows: any[]) => rows.map(({ nivel, symbol, variant, mode, sem_freio, com_freio }) => ({ nivel, symbol, variant, mode, sem_freio, com_freio }));
    expect(values(data.rows)).toEqual(values(original.rows));
  }, 60000);
});