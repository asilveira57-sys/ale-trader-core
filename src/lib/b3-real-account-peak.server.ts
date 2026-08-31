// ───────── Freio de pico da CONTA real (31/08/2026) ─────────
// Camada ACIMA do freio de pico por robô. O freio por robô continua idêntico:
// cada um cuida do próprio pico. O problema que este módulo resolve é a soma —
// cinco robôs devolvendo 40% do próprio pico devolvem muito mais que 40% do
// pico da CONTA. Aqui olhamos o total: realizado + aberto marcado a mercado.
//
// Regras, sem exceção:
//  · bloqueia só ABERTURA real. Fechamento NUNCA é bloqueado.
//  · o simulado segue rodando — a coleta de dados não para nunca.
//  · só arma a partir de um pico mínimo configurável (ruído não trava nada).
//  · uma vez armado, fica armado até o fim do pregão (linha do dia).
import type { SupabaseClient } from "@supabase/supabase-js";
import { saoPauloDate } from "@/lib/b3-real-cockpit.server";

export const DEFAULT_PEAK_GIVEBACK_PCT = 0.35;
export const DEFAULT_PEAK_MIN_BRL = 100;

export interface AccountPeakConfig {
  peak_giveback_pct: number;
  peak_min_brl: number;
}

export interface AccountPeakStatus extends AccountPeakConfig {
  session_date: string;
  /** pico do resultado real do dia da conta (realizado + aberto a mercado) */
  peak_brl: number;
  peak_at: string | null;
  /** resultado real do dia agora */
  result_brl: number;
  /** quanto já foi devolvido do pico, em R$ (nunca negativo) */
  given_back_brl: number;
  /** o mesmo em fração do pico (null quando não há pico positivo) */
  given_back_pct: number | null;
  /** devolução tolerada em R$ (pct × pico) */
  allowed_giveback_brl: number;
  /** resultado a partir do qual o freio arma */
  trigger_at_brl: number | null;
  /** quanto ainda falta devolver para armar, em R$ (0 quando já armou) */
  remaining_brl: number | null;
  /** true quando o pico já passou do piso e o freio pode armar */
  eligible: boolean;
  armed: boolean;
  armed_at: string | null;
  armed_peak_brl: number | null;
  armed_result_brl: number | null;
  /** motivo curto pra log e pra tela */
  reason: string | null;
}

export function normalizeConfig(row: any): AccountPeakConfig {
  const pct = Number(row?.peak_giveback_pct);
  const floor = Number(row?.peak_min_brl);
  return {
    peak_giveback_pct: Number.isFinite(pct) && pct > 0 ? Math.min(0.95, pct) : DEFAULT_PEAK_GIVEBACK_PCT,
    peak_min_brl: Number.isFinite(floor) && floor >= 0 ? floor : DEFAULT_PEAK_MIN_BRL,
  };
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Avaliação pura: dado o pico acumulado, o resultado atual e a configuração,
 * diz se o freio deve estar armado. Sem I/O — é o núcleo testável, e é o que
 * reproduz a curva de um dia inteiro.
 */
export function evaluateAccountPeak(input: {
  peak_brl: number;
  result_brl: number;
  config: AccountPeakConfig;
  already_armed?: boolean;
}): { peak_brl: number; given_back_brl: number; allowed_giveback_brl: number; trigger_at_brl: number | null; eligible: boolean; should_arm: boolean; reason: string | null } {
  const cfg = input.config;
  const peak = r2(Math.max(input.peak_brl, input.result_brl, 0));
  const given = r2(Math.max(0, peak - input.result_brl));
  const allowed = r2(peak * cfg.peak_giveback_pct);
  const eligible = peak >= cfg.peak_min_brl && peak > 0;
  const triggerAt = eligible ? r2(peak - allowed) : null;
  const shouldArm = input.already_armed === true || (eligible && given > allowed);
  const reason = shouldArm
    ? `freio de pico da conta real: pico R$ ${peak.toFixed(2)}, devolvido R$ ${given.toFixed(2)} ` +
      `(${peak > 0 ? ((given / peak) * 100).toFixed(1) : "0.0"}%) — tolerado R$ ${allowed.toFixed(2)} ` +
      `(${(cfg.peak_giveback_pct * 100).toFixed(0)}%)`
    : null;
  return { peak_brl: peak, given_back_brl: given, allowed_giveback_brl: allowed, trigger_at_brl: triggerAt, eligible, should_arm: shouldArm, reason };
}

/**
 * Lê a config + a linha do dia, atualiza o pico e arma o freio quando for o
 * caso. Grava em system_logs no INSTANTE em que arma (uma vez por dia), com
 * pico, devolvido e percentual — é o rastro de auditoria pedido.
 */
export async function refreshAccountPeak(
  supabase: SupabaseClient,
  userId: string,
  resultBrl: number,
  now = new Date(),
): Promise<AccountPeakStatus> {
  const sessionDate = saoPauloDate(now);
  const nowIso = now.toISOString();

  const [{ data: stateRow }, { data: peakRow }] = await Promise.all([
    supabase.from("b3_real_execution_state")
      .select("peak_giveback_pct, peak_min_brl").eq("user_id", userId).maybeSingle(),
    supabase.from("b3_real_account_peak")
      .select("*").eq("user_id", userId).eq("session_date", sessionDate).maybeSingle(),
  ]);

  const config = normalizeConfig(stateRow);
  const prevPeak = Number((peakRow as any)?.peak_brl ?? 0);
  const alreadyArmed = (peakRow as any)?.armed === true;

  const ev = evaluateAccountPeak({ peak_brl: prevPeak, result_brl: resultBrl, config, already_armed: alreadyArmed });
  const armingNow = ev.should_arm && !alreadyArmed;

  const payload: Record<string, unknown> = {
    user_id: userId,
    session_date: sessionDate,
    peak_brl: ev.peak_brl,
    peak_at: ev.peak_brl > prevPeak || !(peakRow as any)?.peak_at ? nowIso : (peakRow as any).peak_at,
    last_result_brl: r2(resultBrl),
    armed: ev.should_arm,
    updated_at: nowIso,
  };
  if (armingNow) {
    payload.armed_at = nowIso;
    payload.armed_peak_brl = ev.peak_brl;
    payload.armed_result_brl = r2(resultBrl);
    payload.armed_giveback_brl = ev.given_back_brl;
    payload.armed_giveback_pct = ev.peak_brl > 0 ? r2(ev.given_back_brl / ev.peak_brl) : null;
  }

  try {
    await (supabase as any).from("b3_real_account_peak")
      .upsert(payload, { onConflict: "user_id,session_date" });
  } catch (e) {
    console.error("[peak-conta] falha ao gravar pico da conta:", (e as Error).message);
  }

  if (armingNow) {
    try {
      await (supabase as any).from("system_logs").insert({
        event_type: "freio_pico_conta_real_armado",
        source: "b3_real_account_peak",
        severity: "critical",
        message:
          `Freio de pico da CONTA real ARMADO: pico R$ ${ev.peak_brl.toFixed(2)}, ` +
          `resultado R$ ${r2(resultBrl).toFixed(2)}, devolvido R$ ${ev.given_back_brl.toFixed(2)} ` +
          `(${ev.peak_brl > 0 ? ((ev.given_back_brl / ev.peak_brl) * 100).toFixed(1) : "0.0"}% do pico; ` +
          `tolerado ${(config.peak_giveback_pct * 100).toFixed(0)}%). ` +
          `Novas ABERTURAS reais bloqueadas até o fim do pregão. Fechamento e simulado seguem normais.`,
        technical_data: {
          session_date: sessionDate,
          pico_brl: ev.peak_brl,
          resultado_brl: r2(resultBrl),
          devolvido_brl: ev.given_back_brl,
          devolvido_pct: ev.peak_brl > 0 ? r2(ev.given_back_brl / ev.peak_brl) : null,
          tolerado_brl: ev.allowed_giveback_brl,
          config_pct: config.peak_giveback_pct,
          config_piso_brl: config.peak_min_brl,
          gatilho_em_brl: ev.trigger_at_brl,
        } as any,
      });
    } catch { /* log best-effort; o bloqueio já vale */ }
  }

  return {
    ...config,
    session_date: sessionDate,
    peak_brl: ev.peak_brl,
    peak_at: (payload.peak_at as string | null) ?? null,
    result_brl: r2(resultBrl),
    given_back_brl: ev.given_back_brl,
    given_back_pct: ev.peak_brl > 0 ? ev.given_back_brl / ev.peak_brl : null,
    allowed_giveback_brl: ev.allowed_giveback_brl,
    trigger_at_brl: ev.trigger_at_brl,
    remaining_brl: ev.should_arm ? 0 : ev.eligible ? r2(Math.max(0, ev.allowed_giveback_brl - ev.given_back_brl)) : null,
    eligible: ev.eligible,
    armed: ev.should_arm,
    armed_at: armingNow ? nowIso : ((peakRow as any)?.armed_at ?? null),
    armed_peak_brl: armingNow ? ev.peak_brl : ((peakRow as any)?.armed_peak_brl ?? null),
    armed_result_brl: armingNow ? r2(resultBrl) : ((peakRow as any)?.armed_result_brl ?? null),
    reason: ev.reason,
  };
}

/** Leitura sem efeito colateral, para a tela. */
export async function readAccountPeak(
  supabase: SupabaseClient,
  userId: string,
  resultBrl: number,
  now = new Date(),
): Promise<AccountPeakStatus> {
  const sessionDate = saoPauloDate(now);
  const [{ data: stateRow }, { data: peakRow }] = await Promise.all([
    supabase.from("b3_real_execution_state")
      .select("peak_giveback_pct, peak_min_brl").eq("user_id", userId).maybeSingle(),
    supabase.from("b3_real_account_peak")
      .select("*").eq("user_id", userId).eq("session_date", sessionDate).maybeSingle(),
  ]);
  const config = normalizeConfig(stateRow);
  const armed = (peakRow as any)?.armed === true;
  const ev = evaluateAccountPeak({
    peak_brl: Number((peakRow as any)?.peak_brl ?? 0),
    result_brl: resultBrl,
    config,
    already_armed: armed,
  });
  return {
    ...config,
    session_date: sessionDate,
    peak_brl: ev.peak_brl,
    peak_at: (peakRow as any)?.peak_at ?? null,
    result_brl: r2(resultBrl),
    given_back_brl: ev.given_back_brl,
    given_back_pct: ev.peak_brl > 0 ? ev.given_back_brl / ev.peak_brl : null,
    allowed_giveback_brl: ev.allowed_giveback_brl,
    trigger_at_brl: ev.trigger_at_brl,
    remaining_brl: ev.should_arm ? 0 : ev.eligible ? r2(Math.max(0, ev.allowed_giveback_brl - ev.given_back_brl)) : null,
    eligible: ev.eligible,
    armed,
    armed_at: (peakRow as any)?.armed_at ?? null,
    armed_peak_brl: (peakRow as any)?.armed_peak_brl == null ? null : Number((peakRow as any).armed_peak_brl),
    armed_result_brl: (peakRow as any)?.armed_result_brl == null ? null : Number((peakRow as any).armed_result_brl),
    reason: ev.reason,
  };
}
