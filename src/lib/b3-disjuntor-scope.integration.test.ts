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
  for (const { symbols, level, expected } of [
    { symbols: ["WIN"], level: "ativo", expected: 1457 },
    { symbols: ["WIN", "WDO"], level: "total", expected: -10829 },
    { symbols: ["WIN", "WDO", "BIT"], level: "total", expected: -16 },
    { symbols: null, level: "total", expected: -16 },
  ]) {
    it(`${symbols?.join("+") ?? "NULL"}: ${level} = ${expected}`, async () => {
      const { data } = await cockpit(symbols);
      const row = data.rows.find((r: any) => r.nivel === level);
      expect(Number(row?.com_freio_disjuntor)).toBe(expected);
      if (expected === -10829) expect(row.disparos[0].disparou).toBe("não disparou");
    }, 60000);
  }
  it("modalidade e modo filtram a curva e a capacidade em todos os níveis", async () => {
    const { data, sb, userId } = await cockpit(["WIN", "WDO"], ["range"], ["agressivo"]);
    const { data: capacity, error: ce } = await sb.rpc("b3_disjuntor_capacidade", { p_user_id: userId, p_symbols: ["WIN", "WDO"], p_variants: ["range"], p_modes: ["agressivo"] });
    if (ce) throw new Error(ce.message);
    expect(capacity.length).toBeGreaterThan(0);
    expect(capacity.every((r: any) => r.mode === "agressivo" && r.variant === "range")).toBe(true);
    for (const row of data.rows.filter((r: any) => ["total", "ativo", "modalidade"].includes(r.nivel))) {
      const symbols = row.nivel === "total" ? ["WIN", "WDO"] : [row.symbol];
      const variants = row.nivel === "modalidade" ? [row.variant] : ["range"];
      const { data: direct, error } = await sb.rpc("b3_disjuntor_simulado", { p_user_id: userId, p_dia: "2026-11-10", p_symbols: symbols, p_variants: variants, p_modes: ["agressivo"], p_perdas_pct: [0.25], p_com_freio: true });
      if (error) throw new Error(error.message);
      expect(Number(row.com_freio_disjuntor)).toBe(Number(direct[0].resultado_com_disjuntor_brl ?? 0));
      const base = capacity.filter((r: any) => symbols.includes(r.symbol) && variants.includes(r.variant)).reduce((sum: number, r: any) => sum + Number(r.max_contracts) * Number(r.margin_per_contract_brl), 0);
      expect(Number(direct[0].capital_base_brl)).toBe(base);
    }
  }, 60000);
  it("sem freio e com freio permanecem idênticos à função original", async () => {
    const { data, sb, args } = await cockpit(["WIN", "WDO"]);
    const { data: original, error } = await sb.rpc("b3_cockpit_tres_leituras", args);
    if (error) throw new Error(error.message);
    const values = (rows: any[]) => rows.map(({ nivel, symbol, variant, mode, sem_freio, com_freio }) => ({ nivel, symbol, variant, mode, sem_freio, com_freio }));
    expect(values(data.rows)).toEqual(values(original.rows));
  }, 60000);
});