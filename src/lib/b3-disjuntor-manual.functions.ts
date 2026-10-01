// Destravar o disjuntor diário real e ajustar o teto pela tela (01/10/2026).
// Só dois comandos de escrita; a lógica do disjuntor não muda.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function hojeSP(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

async function lerEstado(sb: any, userId: string) {
  const dia = hojeSP();
  const [{ data: peak }, { data: st }, { data: ultimo }] = await Promise.all([
    sb.from("b3_real_account_peak")
      .select("circuit_armed, circuit_kind, circuit_armed_at, circuit_base_brl, circuit_result_brl")
      .eq("user_id", userId).eq("session_date", dia).maybeSingle(),
    sb.from("b3_real_execution_state").select("daily_loss_cap_pct, updated_at").eq("user_id", userId).maybeSingle(),
    sb.from("system_logs").select("created_at").eq("event_type", "disjuntor_manual")
      .eq("source", "teto").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  return {
    session_date: dia,
    armed: peak?.circuit_armed === true,
    kind: peak?.circuit_kind ?? null,
    armed_at: peak?.circuit_armed_at ?? null,
    base_brl: Number(peak?.circuit_base_brl ?? 0),
    result_brl: Number(peak?.circuit_result_brl ?? 0),
    cap_pct: Number(st?.daily_loss_cap_pct ?? 0.25),
    cap_alterado_em: ultimo?.created_at ?? st?.updated_at ?? null,
  };
}

export const getDisjuntorManual = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => lerEstado(context.supabase, context.userId));

export const destravarDisjuntor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb: any = context.supabase;
    const e = await lerEstado(sb, context.userId);
    if (!e.armed) throw new Error("Disjuntor não está acionado.");
    const folga = e.cap_pct * e.base_brl + e.result_brl;
    if (folga <= 0) throw new Error("Sem folga — o disjuntor rearma no próximo tique. Ajuste o teto antes.");
    const { error } = await sb.from("b3_real_account_peak")
      .update({ circuit_armed: false, circuit_kind: null, circuit_armed_at: null })
      .eq("user_id", context.userId).eq("session_date", e.session_date).eq("circuit_armed", true);
    if (error) throw new Error(error.message);
    await sb.from("system_logs").insert({
      event_type: "disjuntor_manual", source: "destravar", severity: "warning",
      message: `Disjuntor destravado pela tela (folga R$ ${folga.toFixed(2)}).`,
      technical_data: {
        anterior: { armed: true, kind: e.kind, armed_at: e.armed_at }, novo: { armed: false },
        resultado_dia_brl: e.result_brl, base_brl: e.base_brl, teto_pct: e.cap_pct, folga_brl: folga,
        horario: new Date().toISOString(),
      },
    });
    return { ok: true };
  });

export const ajustarTetoDisjuntor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ pct: z.number().int().min(1).max(95) }).parse(d))
  .handler(async ({ context, data }) => {
    const sb: any = context.supabase;
    const e = await lerEstado(sb, context.userId);
    const novo = data.pct / 100;
    const { error } = await sb.from("b3_real_execution_state")
      .update({ daily_loss_cap_pct: novo }).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    await sb.from("system_logs").insert({
      event_type: "disjuntor_manual", source: "teto", severity: "warning",
      message: `Teto de perda do disjuntor alterado: ${Math.round(e.cap_pct * 100)}% → ${data.pct}%.`,
      technical_data: {
        anterior: e.cap_pct, novo, resultado_dia_brl: e.result_brl, base_brl: e.base_brl,
        horario: new Date().toISOString(),
      },
    });
    return { ok: true };
  });
