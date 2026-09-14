// ───────── Disjuntor diário da CONTA real (04/09/2026) ─────────
// Automatiza o que o operador fazia na mão: viu o dia em +R$ 399, conferiu que
// não havia posição aberta, e desligou os robôs reais um a um.
//
// Base de cálculo = soma, sobre os robôs REAIS habilitados
// (b3_prd_authorizations: enabled = true AND revoked_at IS NULL), de
// max_qty × margin_per_contract_brl do ativo do robô. A base MUDA SOZINHA
// quando robôs são ligados/desligados ou a quantidade muda — é o desejado.
// A base é a MARGEM dos contratos: não é saldo da conta e não inclui garantia.
//
// Duas travas, ambas em cima do resultado REALIZADO do dia:
//  · meta de ganho (+40% da base, configurável): trava o dia somente quando
//    NÃO há posição real aberta — não se trava no meio de uma operação;
//  · teto de perda (−25% da base, configurável): bloqueia novas aberturas
//    IMEDIATAMENTE, sem esperar a conta limpar. Proteção que espera não
//    protege. Posições já abertas seguem até o stop delas.
//
// Escopo: SÓ a conta real. A fazenda simulada segue rodando normalmente.
// Desligado por padrão (daily_circuit_enabled = false).
import type { SupabaseClient } from "@supabase/supabase-js";
import { rootSymbol } from "@/lib/b3-format";
import {
  buildRealLedger, loadAssetProfiles, saoPauloDate, STALE_REPORT_S,
  type RealCommandRow,
} from "@/lib/b3-real-cockpit.server";

export const DEFAULT_GAIN_TARGET_PCT = 0.40;
export const DEFAULT_LOSS_CAP_PCT = 0.25;

export interface DailyCircuitConfig {
  enabled: boolean;
  gain_target_pct: number;
  loss_cap_pct: number;
}

export interface DailyCircuitBaseRobot {
  symbol: string;
  variant: string;
  mode: string;
  max_qty: number;
  margin_per_contract_brl: number;
  base_brl: number;
}

export interface DailyCircuitStatus extends DailyCircuitConfig {
  session_date: string;
  /** soma de max_qty × margem por contrato dos robôs reais habilitados */
  base_brl: number;
  robots: DailyCircuitBaseRobot[];
  robots_count: number;
  /** meta de ganho e teto de perda já em R$ */
  gain_target_brl: number;
  loss_cap_brl: number;
  /** resultado REALIZADO do dia real (sem marcar posição aberta a mercado) */
  realized_brl: number;
  /** quanto falta para a meta (0 quando já atingida) */
  to_gain_brl: number;
  /** quanto falta para o teto de perda (0 quando já atingido) */
  to_loss_brl: number;
  /** posições reais abertas segundo o relatório da corretora */
  open_positions: number;
  /** true quando o relatório do executor está velho (não dá para afirmar 0) */
  broker_stale: boolean;
  /** meta batida, mas ainda tem posição aberta → espera a conta limpar */
  gain_waiting_flat: boolean;
  /** meta já ENCOSTADA hoje: porta de mão única, não desarma no pregão */
  gain_latched: boolean;
  gain_latched_at: string | null;
  gain_latched_result_brl: number | null;
  armed: boolean;
  armed_kind: "meta_ganho" | "teto_perda" | null;
  armed_at: string | null;
  reason: string | null;
}


const r2 = (v: number) => Math.round(v * 100) / 100;

export function normalizeCircuitConfig(row: any): DailyCircuitConfig {
  const gain = Number(row?.daily_gain_target_pct);
  const loss = Number(row?.daily_loss_cap_pct);
  return {
    enabled: row?.daily_circuit_enabled === true,
    gain_target_pct: Number.isFinite(gain) && gain > 0 ? gain : DEFAULT_GAIN_TARGET_PCT,
    loss_cap_pct: Number.isFinite(loss) && loss > 0 ? loss : DEFAULT_LOSS_CAP_PCT,
  };
}

/**
 * Decisão pura (sem I/O) — é o núcleo testável.
 *
 * Porta de mão única (07/09/2026): assim que o realizado ENCOSTA na meta, o
 * disjuntor fica ARMADO no pregão de forma irreversível (`gain_latched`), mesmo
 * que o resultado recue depois. O disparo espera a PRIMEIRA conta limpa e trava
 * com o realizado disponível naquele instante. Nada aqui olha resultado de
 * posição aberta — só realizado.
 * Teto de perda também é irreversível: uma vez tocado, não desarma.
 */
export function evaluateDailyCircuit(input: {
  config: DailyCircuitConfig;
  base_brl: number;
  realized_brl: number;
  open_positions: number;
  broker_stale: boolean;
  already_armed_kind?: "meta_ganho" | "teto_perda" | null;
  /** meta já encostada em algum momento de hoje (persistido) */
  gain_latched?: boolean;
}): {
  gain_target_brl: number; loss_cap_brl: number;
  should_arm: boolean; kind: "meta_ganho" | "teto_perda" | null;
  gain_waiting_flat: boolean;
  /** estado da porta de mão única depois desta avaliação */
  gain_latched: boolean;
  /** true só na avaliação em que a meta foi encostada pela primeira vez */
  gain_latch_now: boolean;
  reason: string | null;
} {
  const cfg = input.config;
  const base = Math.max(0, r2(input.base_brl));
  const gainTarget = r2(base * cfg.gain_target_pct);
  const lossCap = r2(base * cfg.loss_cap_pct);
  const wasLatched = input.gain_latched === true;

  if (input.already_armed_kind) {
    const k = input.already_armed_kind;
    return {
      gain_target_brl: gainTarget, loss_cap_brl: lossCap,
      should_arm: true, kind: k, gain_waiting_flat: false,
      gain_latched: wasLatched || k === "meta_ganho", gain_latch_now: false,
      reason: k === "meta_ganho"
        ? `disjuntor diário: META DE GANHO já atingida hoje (dia travado até o próximo pregão)`
        : `disjuntor diário: TETO DE PERDA já atingido hoje (novas aberturas reais bloqueadas)`,
    };
  }

  if (!cfg.enabled || base <= 0) {
    return {
      gain_target_brl: gainTarget, loss_cap_brl: lossCap, should_arm: false, kind: null,
      gain_waiting_flat: false, gain_latched: wasLatched, gain_latch_now: false, reason: null,
    };
  }

  const realized = r2(input.realized_brl);

  // Perda: arma NA HORA, sem exigir conta limpa.
  if (lossCap > 0 && realized <= -lossCap) {
    return {
      gain_target_brl: gainTarget, loss_cap_brl: lossCap, should_arm: true, kind: "teto_perda",
      gain_waiting_flat: false, gain_latched: wasLatched, gain_latch_now: false,
      reason: `disjuntor diário: TETO DE PERDA atingido — realizado R$ ${realized.toFixed(2)} ≤ −R$ ${lossCap.toFixed(2)} ` +
        `(${(cfg.loss_cap_pct * 100).toFixed(0)}% da base R$ ${base.toFixed(2)}). Novas aberturas reais bloqueadas; posições abertas seguem até o próprio stop.`,
    };
  }

  // Ganho: encosta → arma (irreversível). Dispara na primeira conta limpa,
  // com relatório da corretora confiável (sem relatório fresco não se pode
  // afirmar que não há posição aberta).
  const touched = gainTarget > 0 && realized >= gainTarget;
  const latched = wasLatched || touched;
  if (latched) {
    const flat = input.open_positions === 0 && !input.broker_stale;
    if (flat) {
      return {
        gain_target_brl: gainTarget, loss_cap_brl: lossCap, should_arm: true, kind: "meta_ganho",
        gain_waiting_flat: false, gain_latched: true, gain_latch_now: touched && !wasLatched,
        reason: `disjuntor diário: META DE GANHO atingida e conta limpa — travado com realizado R$ ${realized.toFixed(2)} ` +
          `(meta R$ ${gainTarget.toFixed(2)}, ${(cfg.gain_target_pct * 100).toFixed(0)}% da base R$ ${base.toFixed(2)}). ` +
          `Dia travado: nenhum robô real abre até o próximo pregão.`,
      };
    }
    return {
      gain_target_brl: gainTarget, loss_cap_brl: lossCap, should_arm: false, kind: null,
      gain_waiting_flat: true, gain_latched: true, gain_latch_now: touched && !wasLatched, reason: null,
    };
  }

  return {
    gain_target_brl: gainTarget, loss_cap_brl: lossCap, should_arm: false, kind: null,
    gain_waiting_flat: false, gain_latched: false, gain_latch_now: false, reason: null,
  };
}


/** Base = Σ max_qty × margem por contrato dos robôs reais habilitados. */
export async function loadCircuitBase(supabase: SupabaseClient, userId: string) {
  const [authRes, marginRes] = await Promise.all([
    supabase
      .from("b3_prd_authorizations")
      .select("symbol, variant, mode, enabled, max_qty, revoked_at")
      .eq("user_id", userId)
      .eq("enabled", true)
      .is("revoked_at", null),
    supabase.from("b3_asset_profiles").select("symbol, quote_symbol, margin_per_contract_brl"),
  ]);

  const marginRows = (marginRes.data ?? []) as any[];
  const marginFor = (root: string) => {
    const r = rootSymbol(String(root ?? "")).toUpperCase();
    const hit = marginRows.find(
      (x) => rootSymbol(String(x.quote_symbol ?? x.symbol)) === r || rootSymbol(String(x.symbol)) === r,
    );
    const m = Number(hit?.margin_per_contract_brl);
    return Number.isFinite(m) && m > 0 ? m : 0;
  };

  const robots: DailyCircuitBaseRobot[] = ((authRes.data ?? []) as any[]).map((a) => {
    const qty = Math.max(0, Number(a.max_qty ?? 0));
    const margin = marginFor(String(a.symbol));
    return {
      symbol: rootSymbol(String(a.symbol)),
      variant: String(a.variant),
      mode: String(a.mode),
      max_qty: qty,
      margin_per_contract_brl: margin,
      base_brl: r2(qty * margin),
    };
  });

  return { base_brl: r2(robots.reduce((s, r) => s + r.base_brl, 0)), robots };
}

/** Resultado REALIZADO do dia real + posições abertas reportadas pela corretora. */
export async function loadRealizedAndOpen(supabase: SupabaseClient, userId: string, now = new Date()) {
  const dayStart = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
  const [cmdRes, stateRes, profileFor] = await Promise.all([
    supabase
      .from("b3_mt5_commands")
      .select("id, action, side, symbol, quantity, mode, variant, status, error_message, created_at, filled_at, filled_price, broker_ticket, magic_number, requested_by, broker_position_ticket")
      .eq("user_id", userId)
      .eq("env", "real")
      .gte("created_at", dayStart)
      .order("created_at", { ascending: true }),
    supabase
      .from("b3_mt5_account_state")
      .select("posicoes, reportado_em")
      .eq("user_id", userId)
      .maybeSingle(),
    loadAssetProfiles(supabase),
  ]);

  const today = saoPauloDate(now);
  const commands = ((cmdRes.data ?? []) as RealCommandRow[])
    .filter((c) => saoPauloDate(new Date(c.filled_at ?? c.created_at)) === today);
  const { trades } = buildRealLedger(commands, profileFor);
  let realized = 0;
  for (const t of trades) if (t.result_brl != null) realized += t.result_brl;

  const state = (stateRes.data ?? null) as any;
  const reportedAt = state?.reportado_em ? new Date(state.reportado_em) : null;
  const ageS = reportedAt ? Math.round((now.getTime() - reportedAt.getTime()) / 1000) : null;
  const stale = ageS == null || ageS > STALE_REPORT_S;
  const open = Array.isArray(state?.posicoes) ? (state.posicoes as any[]).length : 0;

  return { realized_brl: r2(realized), open_positions: open, broker_stale: stale, report_age_s: ageS };
}

async function loadState(supabase: SupabaseClient, userId: string, sessionDate: string) {
  const [{ data: stateRow }, { data: dayRow }] = await Promise.all([
    supabase.from("b3_real_execution_state")
      .select("daily_circuit_enabled, daily_gain_target_pct, daily_loss_cap_pct")
      .eq("user_id", userId).maybeSingle(),
    supabase.from("b3_real_account_peak")
      .select("circuit_armed, circuit_kind, circuit_armed_at, circuit_base_brl, circuit_result_brl, circuit_robots, circuit_gain_latched, circuit_gain_latched_at, circuit_gain_latched_result_brl, circuit_gain_latched_open")
      .eq("user_id", userId).eq("session_date", sessionDate).maybeSingle(),
  ]);
  return { stateRow, dayRow: dayRow as any };
}

function toStatus(args: {
  config: DailyCircuitConfig; sessionDate: string;
  base: Awaited<ReturnType<typeof loadCircuitBase>>;
  live: Awaited<ReturnType<typeof loadRealizedAndOpen>>;
  ev: ReturnType<typeof evaluateDailyCircuit>;
  armedAt: string | null;
  latchedAt?: string | null;
  latchedResult?: number | null;
}): DailyCircuitStatus {
  const { config, base, live, ev } = args;
  return {
    ...config,
    session_date: args.sessionDate,
    base_brl: base.base_brl,
    robots: base.robots,
    robots_count: base.robots.length,
    gain_target_brl: ev.gain_target_brl,
    loss_cap_brl: ev.loss_cap_brl,
    realized_brl: live.realized_brl,
    to_gain_brl: r2(Math.max(0, ev.gain_target_brl - live.realized_brl)),
    to_loss_brl: r2(Math.max(0, live.realized_brl + ev.loss_cap_brl)),
    open_positions: live.open_positions,
    broker_stale: live.broker_stale,
    gain_waiting_flat: ev.gain_waiting_flat,
    gain_latched: ev.gain_latched,
    gain_latched_at: args.latchedAt ?? null,
    gain_latched_result_brl: args.latchedResult ?? null,
    armed: ev.should_arm,
    armed_kind: ev.kind,

    armed_at: args.armedAt,
    reason: ev.reason,
  };
}

/**
 * Avalia e, quando for o caso, TRAVA o dia (grava a linha do dia + system_logs
 * uma única vez). Chamado no portão de abertura real.
 */
export async function refreshDailyCircuit(
  supabase: SupabaseClient,
  userId: string,
  now = new Date(),
): Promise<DailyCircuitStatus> {
  const sessionDate = saoPauloDate(now);
  const nowIso = now.toISOString();
  const { stateRow, dayRow } = await loadState(supabase, userId, sessionDate);
  const config = normalizeCircuitConfig(stateRow);

  const [base, live] = await Promise.all([
    loadCircuitBase(supabase, userId),
    loadRealizedAndOpen(supabase, userId, now),
  ]);

  const alreadyKind = dayRow?.circuit_armed === true ? (dayRow.circuit_kind as "meta_ganho" | "teto_perda" | null) ?? "teto_perda" : null;
  const wasLatched = dayRow?.circuit_gain_latched === true;
  const ev = evaluateDailyCircuit({
    config, base_brl: base.base_brl, realized_brl: live.realized_brl,
    open_positions: live.open_positions, broker_stale: live.broker_stale,
    already_armed_kind: alreadyKind, gain_latched: wasLatched,
  });

  // ── ARMAR (porta de mão única): a meta foi ENCOSTADA. Grava antes de qualquer
  // disparo, para que uma queda de resultado depois não desfaça o dia.
  const latchingNow = ev.gain_latch_now && !wasLatched;
  if (latchingNow) {
    try {
      await (supabase as any).from("b3_real_account_peak").upsert({
        user_id: userId,
        session_date: sessionDate,
        circuit_gain_latched: true,
        circuit_gain_latched_at: nowIso,
        circuit_gain_latched_result_brl: live.realized_brl,
        circuit_gain_latched_open: live.open_positions,
        updated_at: nowIso,
      }, { onConflict: "user_id,session_date" });
    } catch (e) {
      console.error("[disjuntor] falha ao armar meta do dia:", (e as Error).message);
    }
    try {
      await (supabase as any).from("system_logs").insert({
        event_type: "disjuntor_diario_meta_armada",
        source: "b3_real_daily_circuit",
        severity: "warning",
        message:
          `Disjuntor diário da CONTA real ARMADO na meta (porta de mão única) às ${nowIso}: ` +
          `realizado do dia R$ ${live.realized_brl.toFixed(2)} ≥ meta R$ ${ev.gain_target_brl.toFixed(2)} ` +
          `(base R$ ${base.base_brl.toFixed(2)}), ${live.open_positions} posição(ões) real(is) aberta(s). ` +
          `Dispara na primeira conta limpa e não desarma até o próximo pregão.`,
        technical_data: {
          etapa: "armado",
          armado_em: nowIso,
          realizado_brl: live.realized_brl,
          posicoes_abertas: live.open_positions,
          relatorio_corretora_velho: live.broker_stale,
          meta_brl: ev.gain_target_brl,
          teto_brl: ev.loss_cap_brl,
          base_brl: base.base_brl,
          robos: base.robots,
          session_date: sessionDate,
        } as any,
      });
    } catch { /* log best-effort */ }
  }

  const armingNow = ev.should_arm && !alreadyKind;
  if (armingNow) {
    try {
      await (supabase as any).from("b3_real_account_peak").upsert({
        user_id: userId,
        session_date: sessionDate,
        circuit_armed: true,
        circuit_kind: ev.kind,
        circuit_armed_at: nowIso,
        circuit_base_brl: base.base_brl,
        circuit_result_brl: live.realized_brl,
        circuit_robots: base.robots.length,
        ...(ev.kind === "meta_ganho"
          ? {
              circuit_gain_latched: true,
              circuit_gain_latched_at: dayRow?.circuit_gain_latched_at ?? nowIso,
              circuit_gain_latched_result_brl: dayRow?.circuit_gain_latched_result_brl ?? live.realized_brl,
              circuit_gain_latched_open: dayRow?.circuit_gain_latched_open ?? live.open_positions,
            }
          : {}),
        updated_at: nowIso,
      }, { onConflict: "user_id,session_date" });
    } catch (e) {
      console.error("[disjuntor] falha ao gravar trava do dia:", (e as Error).message);
    }
    try {
      await (supabase as any).from("system_logs").insert({
        event_type: ev.kind === "meta_ganho" ? "disjuntor_diario_meta_ganho" : "disjuntor_diario_teto_perda",
        source: "b3_real_daily_circuit",
        severity: "critical",
        message:
          `Disjuntor diário da CONTA real DISPARADO (${ev.kind === "meta_ganho" ? "META DE GANHO" : "TETO DE PERDA"}) às ${nowIso}: ` +
          `base R$ ${base.base_brl.toFixed(2)} (${base.robots.length} robô(s) real(is) habilitado(s)), ` +
          `resultado travado R$ ${live.realized_brl.toFixed(2)}, ` +
          `meta R$ ${ev.gain_target_brl.toFixed(2)} / teto −R$ ${ev.loss_cap_brl.toFixed(2)}. ` +
          `Nenhum robô real abre nova posição até o próximo pregão. Fechamento e simulado seguem normais.`,
        technical_data: {
          etapa: "disparado",
          disparado_em: nowIso,
          trava: ev.kind,
          base_brl: base.base_brl,
          robos_travados: base.robots.length,
          robos: base.robots,
          resultado_travado_brl: live.realized_brl,
          armado_em: dayRow?.circuit_gain_latched_at ?? (latchingNow ? nowIso : null),
          realizado_ao_armar_brl: dayRow?.circuit_gain_latched_result_brl ?? (latchingNow ? live.realized_brl : null),
          meta_brl: ev.gain_target_brl,
          teto_brl: ev.loss_cap_brl,
          meta_pct: config.gain_target_pct,
          teto_pct: config.loss_cap_pct,
          posicoes_abertas: live.open_positions,
          relatorio_corretora_velho: live.broker_stale,
          session_date: sessionDate,
        } as any,
      });
    } catch { /* log best-effort; o bloqueio já vale */ }
  }

  return toStatus({
    config, sessionDate, base, live, ev,
    armedAt: armingNow ? nowIso : (dayRow?.circuit_armed_at ?? null),
    latchedAt: dayRow?.circuit_gain_latched_at ?? (latchingNow ? nowIso : null),
    latchedResult: dayRow?.circuit_gain_latched_result_brl ?? (latchingNow ? live.realized_brl : null),
  });
}

/** Leitura sem efeito colateral, para a tela. */
export async function readDailyCircuit(
  supabase: SupabaseClient,
  userId: string,
  now = new Date(),
): Promise<DailyCircuitStatus> {
  const sessionDate = saoPauloDate(now);
  const { stateRow, dayRow } = await loadState(supabase, userId, sessionDate);
  const config = normalizeCircuitConfig(stateRow);
  const [base, live] = await Promise.all([
    loadCircuitBase(supabase, userId),
    loadRealizedAndOpen(supabase, userId, now),
  ]);
  const alreadyKind = dayRow?.circuit_armed === true ? (dayRow.circuit_kind as "meta_ganho" | "teto_perda" | null) ?? "teto_perda" : null;
  const ev = evaluateDailyCircuit({
    config, base_brl: base.base_brl, realized_brl: live.realized_brl,
    open_positions: live.open_positions, broker_stale: live.broker_stale,
    already_armed_kind: alreadyKind, gain_latched: dayRow?.circuit_gain_latched === true,
  });
  return toStatus({
    config, sessionDate, base, live, ev,
    armedAt: dayRow?.circuit_armed_at ?? null,
    latchedAt: dayRow?.circuit_gain_latched_at ?? null,
    latchedResult: dayRow?.circuit_gain_latched_result_brl ?? null,
  });
}

