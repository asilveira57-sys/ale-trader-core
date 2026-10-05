// Calibração semanal do multiplicador do stop diário — SÓ NO SIMULADO.
// Nada é aplicado automaticamente: toda escrita nasce de um clique do operador.
// Nunca escreve em b3_prd_authorizations (caminhos real/ambos ficam para depois).
// Cada aplicação guarda em system_logs o multiplicador ANTERIOR de cada
// configuração tocada — é daí que o desfazer lê o valor para devolver.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertOwner(supabase: any) {
  const { data, error } = await supabase.rpc("is_owner");
  if (error || !data) throw new Error("Sem permissão.");
}

async function settingsDoRobo(admin: any, userId: string, symbol: string, variant: string, mode: string) {
  const { data: runs } = await admin.from("b3_simulation_runs").select("id")
    .eq("user_id", userId).eq("symbol", symbol).eq("variant", variant);
  const ids = (runs ?? []).map((r: any) => r.id);
  if (!ids.length) return [];
  const { data } = await admin.from("b3_simulation_mode_settings")
    .select("id, simulation_run_id, daily_stop_mult, daily_loss_limit_brl")
    .in("simulation_run_id", ids).eq("mode", mode);
  return (data ?? []) as Array<{ id: string; simulation_run_id: string; daily_stop_mult: number; daily_loss_limit_brl: number }>;
}

export const listCalibracao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertOwner(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: sem } = await (admin as any).from("b3_calibracao_semanal")
      .select("semana_ref").order("semana_ref", { ascending: false }).limit(1).maybeSingle();
    if (!sem) return { semana: null, linhas: [] };
    const { data: rows } = await (admin as any).from("b3_calibracao_semanal")
      .select("id, semana_ref, symbol, variant, mode, apelido, mult_atual, mult_sugerido, ganho_estimado, pregoes, confiavel, motivo, aplicado, aplicado_em")
      .eq("semana_ref", sem.semana_ref).order("ganho_estimado", { ascending: false }).limit(2000);
    // Multiplicador vigente no simulado por robô (symbol×variant×mode).
    const { data: runs } = await (admin as any).from("b3_simulation_runs").select("id, symbol, variant")
      .eq("user_id", context.userId);
    const runMap = new Map<string, { symbol: string; variant: string }>((runs ?? []).map((r: any) => [r.id, r]));
    const ids = [...runMap.keys()];
    const vig = new Map<string, number>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data: st } = await (admin as any).from("b3_simulation_mode_settings")
        .select("simulation_run_id, mode, daily_stop_mult").in("simulation_run_id", ids.slice(i, i + 200));
      for (const s of st ?? []) {
        const r = runMap.get(s.simulation_run_id);
        if (r) vig.set(`${r.symbol}|${r.variant}|${s.mode}`, Number(s.daily_stop_mult));
      }
    }
    // Robôs com autorização ativa no real (symbol sem código do contrato).
    const raiz = (s: string) => String(s).toUpperCase().replace(/[FGHJKMNQUVXZ]\d{2}$/, "");
    const { data: auths } = await (admin as any).from("b3_prd_authorizations")
      .select("symbol, variant, mode").eq("enabled", true).is("revoked_at", null);
    const reais = new Set<string>((auths ?? []).map((a: any) => `${raiz(a.symbol)}|${a.variant}|${a.mode}`));
    const linhas = (rows ?? []).map((r: any) => {
      const k = `${r.symbol}|${r.variant}|${r.mode}`;
      return { ...r, tem_config: vig.has(k), mult_vigente: vig.get(k) ?? null,
        real_autorizado: reais.has(`${raiz(r.symbol)}|${r.variant}|${r.mode}`) };
    });
    return { semana: sem.semana_ref as string, linhas };
  });

export const aplicarCalibracao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }).parse(i))
  .handler(async ({ data, context }) => {
    await assertOwner(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const a = admin as any;
    const { data: rows } = await a.from("b3_calibracao_semanal").select("*").in("id", data.ids);
    const feitos: string[] = [];
    const pulados: string[] = [];
    for (const r of rows ?? []) {
      if (!r.confiavel || r.aplicado) { pulados.push(r.id); continue; }
      const sets = await settingsDoRobo(a, context.userId, r.symbol, r.variant, r.mode);
      if (!sets.length) { pulados.push(r.id); continue; }
      const anteriores = sets.map((s) => ({ settings_id: s.id, mult: Number(s.daily_stop_mult), limite_brl: Number(s.daily_loss_limit_brl) }));
      const novo = Number(r.mult_sugerido);
      const { error } = await a.from("b3_simulation_mode_settings").update({ daily_stop_mult: novo }).in("id", sets.map((s) => s.id));
      if (error) throw new Error(error.message);
      const agora = new Date().toISOString();
      await a.from("b3_calibracao_semanal").update({ aplicado: true, aplicado_em: agora }).eq("id", r.id);
      await a.from("system_logs").insert({
        event_type: "calibracao_aplicada", source: "b3-calibracao", severity: "info",
        message: `${r.symbol} · ${r.variant} · ${r.apelido ?? r.mode} (${r.mode}) — multiplicador ${anteriores[0].mult} → ${novo} (simulado)`,
        technical_data: { calibracao_id: r.id, semana_ref: r.semana_ref, symbol: r.symbol, variant: r.variant, mode: r.mode,
          apelido: r.apelido, mult_anterior: anteriores[0].mult, mult_novo: novo, anteriores, ambiente: "simulado",
          aplicado_em: agora, user_id: context.userId },
      });
      feitos.push(r.id);
    }
    return { aplicados: feitos.length, pulados: pulados.length };
  });

export const desfazerCalibracao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertOwner(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const a = admin as any;
    const { data: log } = await a.from("system_logs").select("technical_data")
      .eq("event_type", "calibracao_aplicada").eq("technical_data->>calibracao_id", data.id)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    const td = log?.technical_data;
    if (!td?.anteriores?.length) throw new Error("Registro do valor anterior não encontrado — não dá para desfazer com segurança.");
    for (const p of td.anteriores as Array<{ settings_id: string; mult: number }>) {
      const { error } = await a.from("b3_simulation_mode_settings").update({ daily_stop_mult: p.mult }).eq("id", p.settings_id);
      if (error) throw new Error(error.message);
    }
    await a.from("b3_calibracao_semanal").update({ aplicado: false, aplicado_em: null }).eq("id", data.id);
    await a.from("system_logs").insert({
      event_type: "calibracao_desfeita", source: "b3-calibracao", severity: "info",
      message: `${td.symbol} · ${td.variant} · ${td.apelido ?? td.mode} — multiplicador ${td.mult_novo} → ${td.mult_anterior} (desfeito, simulado)`,
      technical_data: { ...td, desfeito_em: new Date().toISOString() },
    });
    return { ok: true };
  });
