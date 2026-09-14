// ───────── Stop global real derivado + perda real do dia (30/08/2026) ─────────
// Só leitura/cálculo sobre o que JÁ existe: b3_prd_authorizations (a central de
// configuração), os parâmetros do robô simulado e os comandos reais executados.
// Nada aqui altera parâmetro de robô, freio, comitê ou classificador, e nada é
// gravado em b3_simulation_orders.
import type { SupabaseClient } from "@supabase/supabase-js";
import { rootSymbol } from "@/lib/b3-format";
import { buildRealLedger, loadAssetProfiles, saoPauloDate, type RealCommandRow } from "@/lib/b3-real-cockpit.server";
import {
  computeGlobalRealStop, convertSimBrlParamsToReal, effectiveRealDailyLossBrl,
  brlFromMult, multFromBrl, oneStopRealBrl, STOPS_POR_DIA,
  type GlobalStopRobot,
} from "@/lib/b3-real-sizing";

export interface RealRobotSizing {
  symbol: string; variant: string; mode: string;
  enabled: boolean;
  max_qty: number;
  point_value_brl: number;
  stop_pts: number;
  sim_max_contracts: number;
  /** limite manual digitado na tela, em R$ */
  manual_daily_loss_brl: number | null;
  /** o MESMO limite na unidade digitada: múltiplos de stop (adimensional) */
  manual_daily_loss_mult: number | null;
  /** 1 stop cheio no tamanho real — a unidade do multiplicador */
  one_stop_brl: number;
  /** teto: acima disto o multiplicador digitado não tem efeito */
  max_mult: number;
  /** 3 stops no tamanho real */
  three_stops_brl: number;
  /** MENOR entre manual e 3 stops — é este que trava */
  effective_daily_loss_brl: number;
  limite_origem: "manual" | "tres_stops";
  /** parâmetros em R$ do simulado já convertidos para o tamanho real */
  real_brl: ReturnType<typeof convertSimBrlParamsToReal>;
}

const key = (s: string, v: string, m: string) => `${rootSymbol(String(s))}|${v}|${m}`;

/**
 * Junta autorizações reais (quantidade e limite manual) com os parâmetros do
 * robô simulado (stop em pontos e contratos simulados) e o valor do ponto do
 * ativo. Daqui saem TODOS os números reais — nenhum fica preso em código.
 */
export async function loadRealSizing(supabase: SupabaseClient, userId: string): Promise<RealRobotSizing[]> {
  const [authRes, runsRes, profileFor] = await Promise.all([
    supabase
      .from("b3_prd_authorizations")
      .select("symbol, variant, mode, enabled, max_qty, max_daily_loss_brl, max_daily_loss_mult")
      .eq("user_id", userId),
    // Só execução VIGENTE entra no cálculo de risco real. Execução de contrato
    // vencido fica no banco (histórico), mas não contamina número vivo.
    supabase
      .from("b3_simulation_runs")
      .select("id, symbol, status, started_at")
      .eq("user_id", userId)
      .eq("status", "running")
      .order("started_at", { ascending: false }),
    loadAssetProfiles(supabase),
  ]);

  const auths = (authRes.data ?? []) as any[];
  const runs = (runsRes.data ?? []) as any[];
  if (!auths.length || !runs.length) return [];

  const { data: settingsData } = await supabase
    .from("b3_simulation_mode_settings")
    .select("simulation_run_id, mode, entry_style, stop_pts, max_contracts, daily_loss_limit_brl, daily_gain_target_brl, peak_lock_min_profit_brl")
    .eq("user_id", userId);

  // Contrato vigente de cada raiz = o contrato usado pela execução rodando mais
  // recente daquela raiz (runs já vêm em started_at desc).
  const currentContractByRoot = new Map<string, string>();
  for (const r of runs) {
    const root = rootSymbol(String(r.symbol));
    if (!currentContractByRoot.has(root)) currentContractByRoot.set(root, String(r.symbol));
  }

  const runById = new Map(
    runs
      .filter((r) => currentContractByRoot.get(rootSymbol(String(r.symbol))) === String(r.symbol))
      .map((r) => [String(r.id), r]),
  );
  // Entre as execuções vigentes que sobraram, a mais recente por (raiz,
  // modalidade, modo) é a que vale.
  const cfgByKey = new Map<string, any>();
  for (const s of (settingsData ?? []) as any[]) {
    const run = runById.get(String(s.simulation_run_id));
    if (!run) continue;
    const k = key(String(run.symbol), String(s.entry_style ?? "indicador"), String(s.mode));
    if (!cfgByKey.has(k)) cfgByKey.set(k, s); // runs já vêm da mais recente para a mais antiga
  }

  // Autorização real LIGADA sem execução vigente: registra em system_logs para
  // não ficar silencioso entrando no cálculo com número errado.
  const orphans = auths
    .filter((a) => a.enabled === true)
    .filter((a) => !cfgByKey.has(key(String(a.symbol), String(a.variant ?? "indicador"), String(a.mode))))
    .map((a) => `${rootSymbol(String(a.symbol))}/${a.variant ?? "indicador"}/${a.mode}`);
  if (orphans.length) {
    try {
      await (supabase as any).from("system_logs").insert({
        event_type: "b3_real_sizing_sem_execucao_vigente",
        source: "loadRealSizing",
        severity: "warning",
        message: `Autorização real ligada sem execução vigente (contrato atual): ${orphans.join(", ")}. O risco real destes robôs não pode ser derivado.`,
        technical_data: { robots: orphans, contratos_vigentes: Object.fromEntries(currentContractByRoot) } as any,
      });
    } catch (e) {
      console.error("[real-sizing] falha ao registrar robôs sem execução vigente:", (e as Error).message);
    }
  }


  return auths.map((a) => {
    const k = key(String(a.symbol), String(a.variant ?? "indicador"), String(a.mode));
    const cfg = cfgByKey.get(k);
    const pv = profileFor(rootSymbol(String(a.symbol))).point_value_brl;
    const stopPts = Number(cfg?.stop_pts ?? 0);
    const simQty = Math.max(1, Number(cfg?.max_contracts ?? 1));
    const maxQty = Math.max(0, Number(a.max_qty ?? 0));
    // O multiplicador é a unidade de entrada; os REAIS continuam sendo a fonte
    // gravada. Linha antiga sem multiplicador: deriva dividindo pelos R$ de um
    // stop, sem tocar no valor em reais nem no portão de perda.
    const one = oneStopRealBrl(stopPts, pv, maxQty);
    const storedMult = a.max_daily_loss_mult == null ? null : Number(a.max_daily_loss_mult);
    const mult = storedMult != null && Number.isFinite(storedMult) && storedMult > 0
      ? storedMult
      : multFromBrl(a.max_daily_loss_brl, stopPts, pv, maxQty);
    // Quem trava continua sendo o valor em REAIS gravado — o multiplicador é
    // unidade de entrada e de leitura, não uma segunda fonte de verdade.
    const eff = effectiveRealDailyLossBrl(a.max_daily_loss_brl, stopPts, pv, maxQty);
    return {
      symbol: rootSymbol(String(a.symbol)), variant: String(a.variant ?? "indicador"), mode: String(a.mode),
      enabled: a.enabled === true,
      max_qty: maxQty,
      point_value_brl: pv,
      stop_pts: stopPts,
      sim_max_contracts: simQty,
      manual_daily_loss_brl: eff.manual_brl,
      manual_daily_loss_mult: mult,
      one_stop_brl: one,
      max_mult: STOPS_POR_DIA,
      three_stops_brl: eff.three_stops_brl,
      effective_daily_loss_brl: eff.limit_brl,
      limite_origem: eff.origem,
      real_brl: convertSimBrlParamsToReal(cfg ?? {}, simQty, maxQty),
    };
  });
}

/** Stop global derivado dos robôs LIGADOS. Simular outro max_qty: passe override. */
export function globalStopFromSizing(rows: RealRobotSizing[], overrideMaxQty?: number) {
  const robots: GlobalStopRobot[] = rows.map((r) => ({
    symbol: r.symbol, variant: r.variant, mode: r.mode,
    enabled: r.enabled,
    max_qty: overrideMaxQty == null ? r.max_qty : overrideMaxQty,
    stop_pts: r.stop_pts,
    point_value_brl: r.point_value_brl,
    // Com outro tamanho, o limite manual acompanha o multiplicador digitado.
    manual_daily_loss_brl: overrideMaxQty == null || r.manual_daily_loss_mult == null
      ? r.manual_daily_loss_brl
      : brlFromMult(r.manual_daily_loss_mult, r.stop_pts, r.point_value_brl, overrideMaxQty),
  }));
  return computeGlobalRealStop(robots);
}

export interface RealDayLoss {
  /** resultado real do dia (realizado + posição aberta marcada a mercado) */
  total_brl: number;
  /** por magic number do robô */
  by_magic: Map<number, number>;
}

/**
 * Resultado REAL do dia: comandos 'filled' de hoje pelo livro FIFO, mais o
 * lucro/prejuízo em aberto reportado pela corretora. Fechamento manual entra
 * como qualquer outro fechamento — continua funcionando e não interfere na
 * coleta de dados do simulado.
 */
export async function loadRealDayResult(supabase: SupabaseClient, userId: string, now = new Date()): Promise<RealDayLoss> {
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

  const byMagic = new Map<number, number>();
  let total = 0;
  for (const t of trades) {
    if (t.result_brl == null) continue;
    total += t.result_brl;
    byMagic.set(t.magic_number, (byMagic.get(t.magic_number) ?? 0) + t.result_brl);
  }

  for (const p of ((stateRes.data as any)?.posicoes ?? []) as any[]) {
    const mtm = Number(p?.resultado ?? 0);
    if (!Number.isFinite(mtm) || mtm === 0) continue;
    total += mtm;
    const magic = Number(p?.magic ?? 0);
    if (magic > 0) byMagic.set(magic, (byMagic.get(magic) ?? 0) + mtm);
  }

  return { total_brl: Math.round(total * 100) / 100, by_magic: byMagic };
}

// ───── Piso do freio de pico da CONTA como % do STOP GLOBAL (01/09/2026) ─────
// O piso absoluto era muito para 1 robô e pouco para 7. O stop global já é a
// soma do limite EFETIVO de cada robô ligado, então ele acompanha sozinho a
// quantidade de robôs, de contratos e o tamanho do stop de cada um.
// A coluna em R$ (peak_min_brl) continua sendo a fonte que o portão lê — aqui
// só a mantemos em sincronia com o percentual. NÃO muda a devolução (35%), nem
// a lógica do freio, nem o cálculo do stop global.
export const DEFAULT_PEAK_MIN_PCT_OF_GLOBAL = 0.5;

export interface PeakFloorSync {
  /** percentual gravado (ou derivado de uma linha antiga) */
  pct: number;
  /** stop global do momento, em R$ */
  global_stop_brl: number;
  /** piso em R$ que este percentual produz agora */
  peak_min_brl: number;
  /** true quando o valor em R$ gravado estava velho e foi recalculado */
  updated: boolean;
}

/**
 * Recalcula peak_min_brl a partir do percentual e do stop global do momento.
 * Chamado sempre que um robô é ligado/desligado nas Automações Reais e na
 * leitura do Cockpit Real — era exatamente o "errado em silêncio" que faltava.
 */
export async function syncPeakFloorFromGlobalStop(
  supabase: SupabaseClient,
  userId: string,
  opts?: { pctOverride?: number },
): Promise<PeakFloorSync> {
  const [sizing, stateRes] = await Promise.all([
    loadRealSizing(supabase, userId),
    supabase
      .from("b3_real_execution_state")
      .select("peak_min_brl, peak_min_pct_of_global")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  const row = (stateRes.data ?? null) as any;
  const globalStop = globalStopFromSizing(sizing).total_brl;

  const stored = row?.peak_min_pct_of_global == null ? null : Number(row.peak_min_pct_of_global);
  // Linha antiga sem percentual: deriva dividindo os R$ gravados pelo stop
  // global do momento — sem inventar número novo.
  const derived = globalStop > 0 && row?.peak_min_brl != null ? Number(row.peak_min_brl) / globalStop : null;
  const pct = opts?.pctOverride != null && Number.isFinite(opts.pctOverride)
    ? Math.max(0, Math.min(3, Number(opts.pctOverride)))
    : stored != null && Number.isFinite(stored) && stored > 0
      ? stored
      : derived != null && Number.isFinite(derived) && derived > 0
        ? Math.round(derived * 1000) / 1000
        : DEFAULT_PEAK_MIN_PCT_OF_GLOBAL;

  const brl = Math.round(pct * globalStop * 100) / 100;
  const prevBrl = row?.peak_min_brl == null ? null : Number(row.peak_min_brl);
  const needs = prevBrl == null || Math.abs(prevBrl - brl) >= 0.01 || stored == null || stored !== pct;

  if (needs) {
    try {
      await (supabase as any).from("b3_real_execution_state").upsert(
        { user_id: userId, peak_min_pct_of_global: pct, peak_min_brl: brl, updated_at: new Date().toISOString() },
        { onConflict: "user_id" },
      );
    } catch (e) {
      console.error("[piso-pico] falha ao sincronizar piso do pico:", (e as Error).message);
    }
  }

  return { pct, global_stop_brl: globalStop, peak_min_brl: brl, updated: needs };
}
