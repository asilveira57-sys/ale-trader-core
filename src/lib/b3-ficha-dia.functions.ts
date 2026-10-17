// Ficha do dia — SOMENTE LEITURA. Lê as ordens gravadas de um pregão, sem
// recalcular nenhum resultado. Espelho real casado por magic_number
// (b3_prd_authorizations × b3_live_orders), nunca por ativo + hora.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const PAGE = 1000;
const CAP = 20_000;

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

const rootOf = (s: string) => {
  const u = String(s ?? "").toUpperCase();
  const m = u.match(/^(WIN|WDO|BIT|ETR|SOL|IND|DOL)/);
  return m ? m[1]! : u;
};

export const getB3FichaDia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const sb = supabase as any;
    const ini = `${data.date}T00:00:00-03:00`;
    const d = new Date(`${data.date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1);
    const fim = `${d.toISOString().slice(0, 10)}T00:00:00-03:00`;

    const orders = await paged((a, b) =>
      sb.from("b3_simulation_orders")
        .select("id, simulation_run_id, mode, symbol, contract_code, side, entry_price, exit_price, quantity, entry_time, exit_time, gross_result_points, net_result_brl, status, close_reason, entry_score, entry_confidence, entry_approve_votes, entry_setup, mfe_pts, mae_pts, bloqueado_na_sombra, nivel_freio_na_abertura, freios_na_sombra, confirmacao_exigida_pts, confirmacao_janela_s, confirmou, confirmou_em, preco_confirmacao, geo_eficiencia_direcional, geo_posicao_na_faixa, geo_amplitude_pts, geo_velas, geo_veredito, agentes_votos")
        .eq("user_id", userId).gte("entry_time", ini).lt("entry_time", fim)
        .order("entry_time", { ascending: true }).range(a, b));

    const runIds = [...new Set(orders.rows.map((o) => o.simulation_run_id).filter(Boolean))];
    const runs: any[] = [];
    for (let i = 0; i < runIds.length; i += 200) {
      const { data: r, error } = await sb.from("b3_simulation_runs").select("id, variant").in("id", runIds.slice(i, i + 200));
      if (error) throw error;
      runs.push(...(r ?? []));
    }
    const variantByRun = new Map(runs.map((r) => [r.id, String(r.variant ?? "")]));
    // stop_pts configurado do robô (só exibição na explicação da ordem perdedora).
    const stopBy = new Map<string, number>();
    for (let i = 0; i < runIds.length; i += 200) {
      const { data: s, error } = await sb.from("b3_simulation_mode_settings").select("simulation_run_id, mode, stop_pts").in("simulation_run_id", runIds.slice(i, i + 200));
      if (error) throw error;
      for (const x of s ?? []) if (x.stop_pts != null) stopBy.set(`${x.simulation_run_id}|${x.mode}`, Number(x.stop_pts));
    }

    const [authR, live] = await Promise.all([
      sb.from("b3_prd_authorizations").select("symbol, variant, mode, magic_number").eq("user_id", userId),
      paged((a, b) => sb.from("b3_live_orders")
        .select("id, magic_number, symbol, side, entry_time, exit_time, entry_price, exit_price, quantity, net_result_brl, status")
        .eq("user_id", userId).gte("entry_time", ini).lt("entry_time", fim)
        .order("entry_time", { ascending: true }).range(a, b)),
    ]);
    if (authR.error) throw authR.error;
    const magicBy = new Map<string, number>();
    for (const a of authR.data ?? []) if (a.magic_number != null) magicBy.set(`${rootOf(a.symbol)}|${a.variant}|${a.mode}`, Number(a.magic_number));
    const liveByMagic = new Map<number, any[]>();
    for (const l of live.rows) {
      if (l.magic_number == null) continue;
      const k = Number(l.magic_number);
      if (!liveByMagic.has(k)) liveByMagic.set(k, []);
      liveByMagic.get(k)!.push(l);
    }
    const usados = new Set<string>();

    const out = orders.rows.map((o) => {
      const variant = variantByRun.get(o.simulation_run_id) ?? "";
      const root = rootOf(o.symbol);
      const magic = magicBy.get(`${root}|${variant}|${o.mode}`) ?? null;
      // Dentro do MESMO magic, a ordem real é a de entrada mais próxima (≤ 5 min)
      // e mesmo lado; cada ordem real é usada uma vez só.
      let real: any = null;
      if (magic != null) {
        const t = new Date(o.entry_time).getTime();
        let best: any = null; let bd = Infinity;
        for (const l of liveByMagic.get(magic) ?? []) {
          if (usados.has(l.id) || l.side !== o.side) continue;
          const dd = Math.abs(new Date(l.entry_time).getTime() - t);
          if (dd < bd && dd <= 5 * 60_000) { bd = dd; best = l; }
        }
        if (best) { usados.add(best.id); real = best; }
      }
      return { ...o, root, variant, magic_number: magic, real, stop_pts: stopBy.get(`${o.simulation_run_id}|${o.mode}`) ?? null };
    });

    return { date: data.date, orders: out, truncated: orders.truncated || live.truncated };
  });
