// Proposta de conversão fixo → proporcional. Nada é aplicado sem clique.
// Grava só em b3_simulation_mode_settings (simulado). Nunca toca autorizações.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const PCT_FIELDS = [
  "peak_lock_min_profit_pct", "daily_gain_target_pct", "daily_loss_limit_pct", "risco_contratos_pct",
  "trailing_activation_pct_stop", "trailing_giveback_pct_stop", "breakeven_ativa_pct_stop", "breakeven_folga_pct_stop",
] as const;

async function assertOwner(supabase: any) {
  const { data, error } = await supabase.rpc("is_owner");
  if (error || !data) throw new Error("Sem permissão.");
}

export const listProporcional = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertOwner(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const a = supabaseAdmin as any;
    const { data: runs } = await a.from("b3_simulation_runs").select("id, symbol, variant").eq("user_id", context.userId);
    const runMap = new Map<string, any>((runs ?? []).map((r: any) => [r.id, r]));
    const ids = [...runMap.keys()];
    const { data: prof } = await a.from("b3_asset_profiles").select("symbol, margin_model, margin_per_contract_brl");
    const margem = new Map<string, number | null>((prof ?? []).map((p: any) =>
      [p.symbol, p.margin_model === "per_contract" && Number(p.margin_per_contract_brl) > 0 ? Number(p.margin_per_contract_brl) : null]));
    const linhas: any[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const slice = ids.slice(i, i + 200);
      const [{ data: st }, { data: md }] = await Promise.all([
        a.from("b3_simulation_mode_settings").select(
          "id, simulation_run_id, mode, enabled, stop_pts, max_contracts, peak_lock_min_profit_brl, daily_gain_target_brl, daily_loss_limit_brl, trailing_activation_pts, trailing_giveback_pts, breakeven_ativa_pts, breakeven_folga_pts, limites_proporcionais, proporcional_capital_ref_brl, " + PCT_FIELDS.join(", "),
        ).in("simulation_run_id", slice),
        a.from("b3_simulation_modes").select("simulation_run_id, mode, current_balance, initial_balance").in("simulation_run_id", slice),
      ]);
      const bal = new Map<string, number>((md ?? []).map((m: any) => [`${m.simulation_run_id}|${m.mode}`, Number(m.current_balance ?? m.initial_balance ?? 0)]));
      for (const s of st ?? []) {
        const r = runMap.get(s.simulation_run_id);
        if (!r) continue;
        linhas.push({ ...s, symbol: r.symbol, variant: r.variant,
          capital_atual_brl: bal.get(`${s.simulation_run_id}|${s.mode}`) ?? null,
          margem_contrato_brl: margem.get(r.symbol) ?? null });
      }
    }
    linhas.sort((x, y) => `${x.symbol}${x.variant}${x.mode}`.localeCompare(`${y.symbol}${y.variant}${y.mode}`));
    const { data: conta } = await a.from("b3_mt5_account_state")
      .select("capital_liquido, capital_aceito, capital_pendente, capital_pendente_leituras, reportado_em")
      .eq("user_id", context.userId).maybeSingle();
    return { linhas, conta: conta ?? null };
  });

const pctSchema = z.number().positive().max(10000).nullable();
export const confirmarProporcional = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({
    itens: z.array(z.object({
      id: z.string().uuid(),
      capital_ref_brl: z.number().positive().nullable(),
      pcts: z.object(Object.fromEntries(PCT_FIELDS.map((f) => [f, pctSchema])) as Record<(typeof PCT_FIELDS)[number], typeof pctSchema>),
    })).min(1).max(1000),
  }).parse(i))
  .handler(async ({ data, context }) => {
    await assertOwner(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const a = supabaseAdmin as any;
    for (const it of data.itens) {
      const { data: prev } = await a.from("b3_simulation_mode_settings")
        .select("limites_proporcionais, proporcional_capital_ref_brl, " + PCT_FIELDS.join(", ")).eq("id", it.id).maybeSingle();
      const { error } = await a.from("b3_simulation_mode_settings")
        .update({ ...it.pcts, proporcional_capital_ref_brl: it.capital_ref_brl, limites_proporcionais: true }).eq("id", it.id);
      if (error) throw new Error(error.message);
      await a.from("system_logs").insert({
        event_type: "limites_proporcionais_aplicados", source: "b3-proporcional", severity: "info",
        message: `Limites proporcionais ligados (settings ${it.id})`,
        technical_data: { settings_id: it.id, anterior: prev, novo: it, em: new Date().toISOString() },
      });
    }
    return { ok: true, n: data.itens.length };
  });

export const desfazerProporcional = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertOwner(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const a = supabaseAdmin as any;
    const { error } = await a.from("b3_simulation_mode_settings").update({ limites_proporcionais: false }).eq("id", data.id);
    if (error) throw new Error(error.message);
    await a.from("system_logs").insert({
      event_type: "limites_proporcionais_desfeitos", source: "b3-proporcional", severity: "info",
      message: `Voltou ao modelo fixo (settings ${data.id})`, technical_data: { settings_id: data.id },
    });
    return { ok: true };
  });
