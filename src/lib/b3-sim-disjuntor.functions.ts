// Simulação de disjuntor de PERDA sobre histórico gravado — SOMENTE LEITURA.
// Nunca grava nada e nunca altera configuração. Um ativo e uma modalidade por vez.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { OrdemSim } from "./b3-sim-disjuntor";

const PAGE = 1000;
const CAP = 60_000;

async function paged(build: (from: number, to: number) => any) {
  const out: any[] = [];
  let truncated = false;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
    if (out.length >= CAP) { truncated = true; break; }
  }
  return { rows: out, truncated };
}

const diaBR = (iso: string) => new Date(new Date(iso).getTime() - 3 * 3600_000).toISOString().slice(0, 10);

export const getSimDisjuntorOpcoes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const { data, error } = await sb.from("b3_simulation_runs").select("symbol, variant").eq("user_id", context.userId);
    if (error) throw error;
    const m = new Map<string, Set<string>>();
    for (const r of data ?? []) {
      const root = String(r.symbol ?? "").toUpperCase().replace(/[FGHJKMNQUVXZ]\d{2}$/, "");
      if (!root) continue;
      (m.get(root) ?? m.set(root, new Set()).get(root)!).add(String(r.variant));
    }
    return [...m.entries()].sort().map(([ativo, v]) => ({ ativo, variants: [...v].sort() }));
  });

export const getSimDisjuntor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({
    ativo: z.string().regex(/^[A-Z0-9]{2,8}$/),
    variant: z.string().min(1).max(40),
    mode: z.string().max(40).nullable(),
    dias: z.number().int().min(5).max(180),
  }).parse(i))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const uid = context.userId;
    const fim = new Date();
    const ini = new Date(fim.getTime() - data.dias * 86400_000);
    const iniD = diaBR(ini.toISOString());

    const { data: runs, error: re } = await sb.from("b3_simulation_runs").select("id, symbol, variant")
      .eq("user_id", uid).eq("variant", data.variant).ilike("symbol", `${data.ativo}%`);
    if (re) throw re;
    const runIds = (runs ?? []).map((r: any) => r.id);
    const ordens: any[] = [];
    let truncated = false;
    for (let i = 0; i < runIds.length; i += 100) {
      const ids = runIds.slice(i, i + 100);
      const r = await paged((a, b) => {
        let q = sb.from("b3_simulation_orders")
          .select("id, mode, contract_code, entry_time, exit_time, net_result_brl, status")
          .eq("user_id", uid).in("simulation_run_id", ids).gte("entry_time", ini.toISOString())
          .not("exit_time", "is", null);
        if (data.mode) q = q.eq("mode", data.mode);
        return q.order("entry_time", { ascending: true }).order("id").range(a, b);
      });
      ordens.push(...r.rows); truncated ||= r.truncated;
    }

    const [qual, saude, modesR] = await Promise.all([
      sb.from("b3_pregoes_qualidade").select("pregao, classificacao, motivo").gte("pregao", iniD),
      sb.from("b3_pregao_saude").select("trade_date, cobertura_pct, maior_buraco_min, cotacao_parada, stops_pendentes, ordens_fantasma, fechamentos_manuais, primeiro_tick, limpo, motivo_sujo").eq("user_id", uid).gte("trade_date", iniD),
      sb.from("b3_simulation_mode_settings").select("mode").in("simulation_run_id", runIds.length ? runIds : ["00000000-0000-0000-0000-000000000000"]),
    ]);

    const semResultado = ordens.filter((o) => o.net_result_brl == null || o.status === "divergente_corretora").length;
    const validas: OrdemSim[] = ordens
      .filter((o) => !(o.net_result_brl == null || o.status === "divergente_corretora"))
      .map((o) => ({ dia: diaBR(o.entry_time), entry: o.entry_time, exit: o.exit_time, net: Number(o.net_result_brl), contrato: o.contract_code ?? null }));

    // The former margin source is under investigation. Never substitute a
    // different capital base or silently rerun scenarios with another number.
    const baseSugerida = null;
    const pv: number[] = [];

    // Contrato por dia (para detectar rolagem).
    const contratos = new Map<string, Set<string>>();
    for (const o of validas) if (o.contrato) (contratos.get(o.dia) ?? contratos.set(o.dia, new Set()).get(o.dia)!).add(o.contrato);

    return {
      ordens: validas,
      sem_resultado: semResultado,
      rows_truncated: truncated,
      base_sugerida_brl: baseSugerida,
      dias_com_pico: pv.length,
      qualidade: (qual.data ?? []) as { pregao: string; classificacao: string; motivo: string }[],
      saude: (saude.data ?? []) as any[],
      contratos_por_dia: Object.fromEntries([...contratos].map(([d, s]) => [d, [...s]])),
      modos: [...new Set(((modesR.data ?? []) as any[]).map((m) => String(m.mode)))].sort(),
      fonte_faltante: "Ordens fechadas de b3_simulation_orders, com resultado gravado. Sugestão automática de base suspensa: fonte anterior sob investigação. Informe uma base para consultar os cenários; nenhuma base substituta foi calculada.",
    };
  });
