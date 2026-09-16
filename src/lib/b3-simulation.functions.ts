// B3 Day Trade — Fase 2.5: simulação comparativa dos 3 modos
import { createServerFn } from "@tanstack/react-start";
import { rootSymbol, FREIO_LABEL } from "./b3-format";
import { buildCockpitFilter, cockpitKeep, cockpitRootSymbol } from "./b3-cockpit-filter";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

import {
  runB3Agents, buildB3Decision,
  type B3Side, type B3RiskState, type B3CommitteeSettings,
} from "./b3-committee.server";
import {
  evaluateB3Protection, resetB3ProtectionForNewDay, b3DayKeyBRT,
  type B3ProtectionRuntime, type B3ProtectionSettings,
} from "./b3-protection.server";
import {
  B3_MT5_SERVER,
  B3_MT5_SYMBOL,
  B3_MT5_TTL_SECONDS,
  B3QuoteProvider,
  assertB3StrictMt5ExecutionAudit,
  getB3ExecutionAudit,
  quoteAuditBase,
  type B3PriceContextResult,
  type B3QuoteExecutionAudit,
} from "./b3-price-source.server";
import { b3WindowState } from "./b3-window.server";
import { loadRealSizing, loadRealDayResult, globalStopFromSizing, type RealRobotSizing } from "./b3-real-stop.server";

import { roundToTick } from "./b3-tick";
import {
  decideB3Grupo, aplicarFatorContratos, textoNivelGrupo,
  type B3GrupoLimites, type B3GrupoEstado, type B3GrupoDecision,
} from "./b3-grupo.server";



const POINT_VALUE_BRL = 0.2;
const TICK = 5;

// ─────────────────────── Fase 0: perfil de ativo ───────────────────────
// Extrai os valores que hoje são fixos (POINT_VALUE_BRL, símbolo, contrato,
// preço-base) para uma tabela por símbolo. O fallback abaixo replica
// EXATAMENTE os valores fixos de hoje — se a tabela/linha não existir por
// qualquer motivo, o comportamento não muda em nada.
const WIN_FALLBACK_ASSET_PROFILE = {
  symbol: "WINQ26", quote_symbol: "WIN", contract_code: "WINFUT",
  tick_size: TICK, tick_value_brl: POINT_VALUE_BRL, base_price_fallback: 130000,
  spread_max_price: 15, price_deviation_limit: 2000,
  fee_model: "per_contract", fee_per_contract_brl: 1.5, fee_percent_volume: 0,
  // Limiar de afastamento do VWAP, agora configurável POR ATIVO (05/09/2026).
  // Estes são os valores históricos que estavam embutidos no motor.
  vwap_min_distance_stop_ratio: 0.8, vwap_min_distance_range_ratio: 0.25,
};

export async function loadAssetProfile(supabase: any, symbol: string | null | undefined) {
  if (!symbol) return WIN_FALLBACK_ASSET_PROFILE;
  try {
    const { data } = await supabase.from("b3_asset_profiles").select("*").eq("symbol", symbol).maybeSingle();
    if (data) return data;
  } catch {
    // tabela pode não existir ainda (antes da migration) — cai no fallback
  }
  return WIN_FALLBACK_ASSET_PROFILE;
}

// ─────────────────────── custo operacional simulado ───────────────────────
// Fonte única de verdade para taxas simuladas. Deriva do perfil do ativo:
//  · fee_model = 'per_contract'   → R$ fixos por contrato, por ponta (futuros)
//  · fee_model = 'percent_volume' → % sobre o volume financeiro de cada ponta
//    (ações; fee_percent_volume está em PERCENTUAL, 0.0325 = 0,0325%)
// run.simulated_fee_brl é mantido na tabela por compatibilidade, mas NÃO é
// mais usado no cálculo.
export function computeB3Fees({ assetProfile, quantity, entryPrice, exitPrice }: {
  assetProfile: any; quantity: number; entryPrice: number; exitPrice?: number | null;
}): number {
  const qty = Math.max(0, Number(quantity) || 0);
  const model = String(assetProfile?.fee_model ?? "per_contract");
  const entry = Number(entryPrice) || 0;
  const hasExit = exitPrice != null && isFinite(Number(exitPrice));
  if (model === "percent_volume") {
    const pct = Number(assetProfile?.fee_percent_volume ?? 0) / 100;
    const volEntry = entry * qty;
    const volExit = hasExit ? Number(exitPrice) * qty : 0;
    return (volEntry + volExit) * pct;
  }
  const perContract = Number(assetProfile?.fee_per_contract_brl ?? 1.5) || 0;
  return perContract * qty * (hasExit ? 2 : 1);
}
// Trava de risco AGREGADA: numa conta real, os 5 modos compartilham o mesmo
// saldo/margem (diferente da simulação, onde cada modo tem saldo virtual
// isolado). Esse limite olha a soma do resultado realizado hoje dos 5 modos
// juntos e bloqueia NOVAS entradas em TODOS os modos quando estourado —
// posições já abertas continuam sendo geridas normalmente (stop/gain/zeragem).
// Valor definido pelo usuário em 04/08/2026.
// CONFIGURÁVEL desde 15/08/2026: o valor vem de
// b3_trading_settings.global_daily_loss_limit_brl. Sem linha/valor válido,
// cai no padrão histórico de R$ 1.000.
const GLOBAL_DAILY_LOSS_LIMIT_DEFAULT_BRL = 1000;
async function loadGlobalDailyLossLimit(supabase: any, userId: string): Promise<number> {
  try {
    const { data } = await supabase.from("b3_trading_settings")
      .select("global_daily_loss_limit_brl").eq("user_id", userId).maybeSingle();
    const v = Number(data?.global_daily_loss_limit_brl);
    return Number.isFinite(v) && v > 0 ? v : GLOBAL_DAILY_LOSS_LIMIT_DEFAULT_BRL;
  } catch {
    return GLOBAL_DAILY_LOSS_LIMIT_DEFAULT_BRL;
  }
}

// ─────────────────────── espelhamento demo → real ───────────────────────
// Toda vez que o motor (demo) abre/fecha uma posição em qualquer um dos 5
// modos, um comando espelhado é inserido em b3_mt5_commands para env='real',
// com quantidade PRÓPRIA da conta real (não a mesma da demo — ver
// REAL_QTY_BY_MODE). O comando só produz ordem de verdade se o conector
// Python estiver com DRY_RUN=False E REAL_TRADING_CONFIRMED=True — até lá,
// fica só registrado e confirmado como dry-run pelo conector.
// Decisão do usuário em 05/08/2026: espelhar os 5 modos desde já, mantendo
// o conector em modo dry-run até validação manual.
const REAL_MIRROR_ENABLED = true;
// A quantidade real NÃO fica em código: sai de b3_prd_authorizations.max_qty
// (tela "Automações Reais"). Mudar de 1 para 2 contratos na tela basta.
// Todo valor em R$ vindo do simulado é convertido pelo tamanho real:
//   valor_real = valor_simulado ÷ contratos_simulados × max_qty  (b3-real-sizing)
// Pontos (stop_pts, gain_pts, trailing_*, breakeven_*) não se convertem.

// Magic number: FONTE ÚNICA NO BANCO (30/08/2026).
// A fórmula vive só em public.b3_magic(p_symbol, p_variant, p_mode) e a
// validação em public.b3_magic_valido(p_magic). Nenhuma cópia em TypeScript —
// duas fórmulas divergem com o tempo e foi exatamente isso que produziu a
// colisão real 2002..2005 entre WIN e WDO. Ativo/modalidade/modo não mapeado
// falha FECHADA (nada de magic 0 seguindo em silêncio para o executor).



async function mirrorToReal(
  supabase: any, userId: string, runId: string, mode: Mode,
  action: "open" | "close", side: "buy" | "sell", idempotencyKey: string,
  requestedBy: "engine_auto" | "user_manual_close" | "user_close_all",
  symbol: string = "WIN",
  variant: string = "indicador",
  // Contrato de saída congelado da ordem simulada correspondente. Vai no
  // comando e é copiado para b3_live_orders na confirmação do executor —
  // registro, não instrução: o executor ignora campos que não conhece.
  levels: { stop_pts?: number | null; gain_pts?: number | null; stop_price?: number | null; target_price?: number | null } | null = null,
  // Comando existe porque UMA PESSOA liberou o freio na tela, não porque a
  // regra do sistema permitiu (16/09/2026). Vai marcado no comando para o
  // extrato real conseguir contar intervenção humana separadamente.
  liberacaoManual: boolean = false,
) {
  if (!REAL_MIRROR_ENABLED) return;


  // ── PORTÃO DE AUTORIZAÇÃO REAL (nega por padrão) — SÓ ABERTURA ──
  // Sem linha autorizada em b3_prd_authorizations para
  // user+symbol+variant+mode, nenhuma ABERTURA real é enfileirada. Falha de
  // consulta = falha FECHADA. A modalidade entrou na chave em 15/08/2026:
  // autorizar 'indicador' não autoriza 'price_action' no mesmo ativo/modo.
  //
  // FECHAMENTO nunca passa por este portão (08/09/2026): fechar REDUZ risco.
  // Baixar max_qty ou desligar o robô não pode impedir a saída de uma posição
  // já aberta — foi exatamente isso que travou a zeragem em 08/09.
  let authMaxQty = 1;
  let authEnabled = false;
  try {
    const { data: auth, error: authErr } = await supabase
      .from("b3_prd_authorizations")
      .select("enabled, max_qty")
      .eq("user_id", userId)
      .eq("symbol", symbol)
      .eq("variant", variant)
      .eq("mode", mode)
      .maybeSingle();
    if (authErr) {
      if (action === "open") return;
    } else if (auth) {
      authEnabled = auth.enabled === true;
      authMaxQty = Number(auth.max_qty ?? 1);
    }
  } catch {
    if (action === "open") return;
  }
  // Registro de recusa de ABERTURA real (14/09/2026): sem isso só se descobre
  // por ausência — não havia como contar quantas entradas reais foram puladas
  // nem por quê. Um único event_type, com o motivo em campo próprio.
  const logNaoAbriu = async (
    motivo: "posicao_ja_aberta_na_corretora" | "relatorio_velho" | "freio_de_grupo" | "robo_desligado",
    detalhe: string,
    extra: Record<string, unknown> = {},
  ) => {
    try {
      await supabase.from("system_logs").insert({
        event_type: "b3_espelho_nao_abriu",
        source: `b3_real_mirror:${symbol}:${variant}:${mode}`,
        severity: "warning",
        message: `Abertura real NÃO enfileirada (${motivo}): ${detalhe}`,
        technical_data: { motivo, symbol, variant, mode, side, run_id: runId, ...extra } as any,
      });
    } catch { /* registro nunca derruba o motor */ }
  };

  if (action === "open" && !authEnabled) {
    await logNaoAbriu("robo_desligado", "sem autorização real habilitada para este robô.");
    return;
  }

  // Quantidade real da ABERTURA = max_qty da autorização (tela), nunca
  // max_contracts do simulado. No FECHAMENTO a quantidade é a que está aberta
  // de fato no real (definida na entrada), não o max_qty de agora.
  let quantity = Math.max(1, authMaxQty);




  // Falha FECHADA: o magic vem do banco (public.b3_magic) e só é aceito se
  // public.b3_magic_valido aprovar. Erro de RPC, magic nulo/0 ou fora da faixa
  // ⇒ comando real NÃO enfileirado + registro crítico em system_logs.
  let magic = 0;
  let magicMotivo: string | null = null;
  try {
    const { data: magicData, error: magicErr } = await supabase.rpc("b3_magic", {
      p_symbol: symbol, p_variant: variant, p_mode: mode,
    });
    if (magicErr) {
      magicMotivo = `b3_magic falhou: ${magicErr.message}`;
    } else {
      magic = Number(magicData);
      if (!Number.isFinite(magic) || magic <= 0) {
        magicMotivo = `b3_magic devolveu valor inválido (${String(magicData)}) para ${symbol}/${variant}/${mode}`;
      } else {
        const { data: valido, error: validoErr } = await supabase.rpc("b3_magic_valido", { p_magic: magic });
        if (validoErr) magicMotivo = `b3_magic_valido falhou: ${validoErr.message}`;
        else if (valido !== true) magicMotivo = `magic ${magic} reprovado por b3_magic_valido (${symbol}/${variant}/${mode})`;
      }
    }
  } catch (e) {
    magicMotivo = `erro inesperado ao obter magic: ${(e as Error).message}`;
  }
  if (magicMotivo) {
    console.error(`[mirror] magic inválido — comando real NÃO enfileirado: ${magicMotivo}`);
    try {
      await supabase.from("system_logs").insert({
        event_type: "magic_number_invalido",
        source: `b3_real_mirror:${symbol}:${variant}:${mode}`,
        severity: "critical",
        message: `Comando real NÃO enfileirado: ${magicMotivo}`,
        technical_data: {
          symbol, variant, mode, action, side, run_id: runId, magic_calculado: magic,
          fonte: "public.b3_magic",
        } as any,
      });
    } catch { /* log é best-effort; o bloqueio já aconteceu */ }
    return;
  }

  // ── A CORRETORA MANDA: estado real do magic vem de b3_mt5_account_state ──
  // (14/09/2026) O livro por comandos continua servindo para APURAR resultado
  // de operações encerradas; deixa de ser base de decisão sobre risco novo.
  const { readBrokerMagicState } = await import("./b3-broker-state.server");
  const broker = await readBrokerMagicState(supabase, userId);
  const abertoNaCorretora = broker.qty_by_magic.get(magic) ?? 0;

  if (action === "open") {
    // Relatório velho (> STALE_REPORT_S): sem prova do estado da conta não se
    // abre nada. Mesmo princípio de reconcileB3LiveOrders — sem relatório
    // fresco não há prova de ausência.
    if (!broker.reported || broker.stale) {
      await logNaoAbriu(
        "relatorio_velho",
        broker.reported
          ? `relatório da corretora parado há ${broker.report_age_s}s (limite 60s).`
          : "nenhum relatório da corretora — estado da conta desconhecido.",
        { magic, reportado_em: broker.reported_at, idade_s: broker.report_age_s },
      );
      return;
    }
    if (abertoNaCorretora > 0) {
      await logNaoAbriu(
        "posicao_ja_aberta_na_corretora",
        `a corretora já reporta ${abertoNaCorretora} contrato(s) abertos no magic ${magic}.`,
        { magic, aberto_na_corretora: abertoNaCorretora, reportado_em: broker.reported_at },
      );
      return;
    }
  }

  // ── FECHAMENTO: quantidade = o que a CORRETORA reporta aberto no magic ──
  // Saída nunca é bloqueada por relatório velho: com relatório velho vale a
  // última foto. Sem posição na corretora, o comando NÃO é criado — foi o ruído
  // de 11/09 ("nenhuma posicao aberta em WINV26 para fechar"), quando a
  // abertura correspondente havia sido recusada.
  if (action === "close") {
    if (broker.reported) {
      if (abertoNaCorretora <= 0) {
        try {
          await supabase.from("system_logs").insert({
            event_type: "b3_espelho_nao_fechou",
            source: `b3_real_mirror:${symbol}:${variant}:${mode}`,
            severity: "info",
            message: `Saída do simulado sem correspondente no real: a corretora não tem posição no magic ${magic} (a entrada nunca aconteceu).`,
            technical_data: {
              motivo: "sem_posicao_na_corretora", symbol, variant, mode, side, magic,
              run_id: runId, reportado_em: broker.reported_at, idade_s: broker.report_age_s,
            } as any,
          });
        } catch { /* registro nunca derruba o motor */ }
        return;
      }
      quantity = abertoNaCorretora;
    } else {
      // Nunca houve relatório: única saída é a estimativa antiga pelo livro de
      // comandos (últimos 5 dias). Fechar de menos é melhor que não fechar.
      try {
        const desde = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
        const { data: hist, error: histErr } = await supabase
          .from("b3_mt5_commands")
          .select("action, quantity")
          .eq("user_id", userId).eq("env", "real").eq("magic_number", magic)
          .eq("status", "filled")
          .gte("created_at", desde);
        if (histErr) throw histErr;
        let aberto = 0;
        for (const c of (hist ?? []) as any[]) {
          const q = Math.abs(Number(c.quantity ?? 0));
          if (c.action === "open") aberto += q;
          else if (c.action === "close") aberto -= q;
        }
        if (aberto > 0) quantity = aberto;
      } catch (e) {
        console.error("[mirror] não foi possível medir a posição real aberta:", (e as Error).message);
      }
    }
  }



  // ── PORTÃO DE PERDA REAL (só ABERTURA; fechamento nunca é bloqueado) ──
  // Dois freios, ambos em R$ já no tamanho REAL:
  //  · por robô: MENOR entre o limite manual da tela e 3 stops × valor do ponto
  //    × max_qty (manual frouxo não afrouxa a regra);
  //  · global derivado: soma dos 3 stops reais de TODOS os robôs ligados —
  //    ao alcançá-lo, nenhum robô real abre mais nada.
  // O simulado segue rodando normalmente: a coleta de dados não para nunca.
  if (action === "open") {
    try {
      const [sizing, dayResult] = await Promise.all([
        loadRealSizing(supabase, userId),
        loadRealDayResult(supabase, userId),
      ]);
      const perda = dayResult.total_brl < 0 ? Math.abs(dayResult.total_brl) : 0;
      const global = globalStopFromSizing(sizing);
      const mine = sizing.find(
        (s: RealRobotSizing) => s.symbol === rootSymbol(symbol) && s.variant === variant && s.mode === mode,
      );
      const perdaRobo = (() => {
        const v = dayResult.by_magic.get(magic) ?? 0;
        return v < 0 ? Math.abs(v) : 0;
      })();

      // Freio de pico da CONTA (camada acima do freio por robô, que segue igual).
      // Acompanha o pico do resultado real do dia da conta inteira e bloqueia
      // TODAS as novas aberturas reais quando a devolução passa do percentual.
      const { refreshAccountPeak } = await import("./b3-real-account-peak.server");
      const accountPeak = await refreshAccountPeak(supabase, userId, dayResult.total_brl);

      // Disjuntor diário da CONTA real (meta de ganho / teto de perda sobre a
      // base de MARGEM dos robôs reais habilitados). Desligado por padrão.
      // Só a conta real: o simulado nunca é travado por ele.
      const { refreshDailyCircuit } = await import("./b3-real-daily-circuit.server");
      const circuit = await refreshDailyCircuit(supabase, userId);

      // "Parar novas entradas reais" (botão laranja): já bloqueia a ENTREGA no
      // hook do executor; aqui bloqueia também a ENFILEIRAÇÃO, para o comando
      // nem existir. Fechamento segue livre — este bloco só roda em 'open'.
      const { data: execState } = await supabase
        .from("b3_real_execution_state").select("real_enabled, stopped_reason")
        .eq("user_id", userId).maybeSingle();
      const realParado = execState ? (execState as any).real_enabled === false : false;

      let motivo: string | null = null;
      if (realParado) {
        motivo = `real PARADO pela tela${(execState as any)?.stopped_reason ? `: ${(execState as any).stopped_reason}` : ""}`;
      } else if (circuit.armed) {
        motivo = circuit.reason ?? `disjuntor diário da conta real armado (${circuit.armed_kind ?? "—"})`;
      } else if (accountPeak.armed) {
        motivo = accountPeak.reason
          ?? `freio de pico da conta real armado às ${accountPeak.armed_at ?? "—"} (pico R$ ${accountPeak.peak_brl.toFixed(2)})`;



      } else if (global.total_brl > 0 && perda >= global.total_brl) {
        motivo = `stop global real alcançado: perda R$ ${perda.toFixed(2)} ≥ global derivado R$ ${global.total_brl.toFixed(2)}`;
      } else if (mine && mine.effective_daily_loss_brl > 0 && perdaRobo >= mine.effective_daily_loss_brl) {
        motivo = `limite diário real do robô alcançado: perda R$ ${perdaRobo.toFixed(2)} ≥ R$ ${mine.effective_daily_loss_brl.toFixed(2)} (${mine.limite_origem})`;
      }


      if (motivo) {
        try {
          await supabase.from("system_logs").insert({
            event_type: "stop_real_bloqueou_abertura",
            source: `b3_real_mirror:${symbol}:${variant}:${mode}`,
            severity: "warning",
            message: `Abertura real NÃO enfileirada: ${motivo}`,
            technical_data: {
              symbol, variant, mode, side, magic, run_id: runId,
              perda_real_dia_brl: perda, perda_real_robo_brl: perdaRobo,
              stop_global_brl: global.total_brl,
              limite_robo_brl: mine?.effective_daily_loss_brl ?? null,
              limite_origem: mine?.limite_origem ?? null,
              tres_stops_brl: mine?.three_stops_brl ?? null,
              max_qty: mine?.max_qty ?? quantity,
              contratos_simulados: mine?.sim_max_contracts ?? null,
              parametros_reais_convertidos: mine?.real_brl ?? null,
              freio_pico_conta: {
                armado: accountPeak.armed,
                pico_brl: accountPeak.peak_brl,
                resultado_brl: accountPeak.result_brl,
                devolvido_brl: accountPeak.given_back_brl,
                devolvido_pct: accountPeak.given_back_pct,
                tolerado_pct: accountPeak.peak_giveback_pct,
                piso_brl: accountPeak.peak_min_brl,
              },
              disjuntor_diario: {
                ligado: circuit.enabled,
                armado: circuit.armed,
                trava: circuit.armed_kind,
                base_brl: circuit.base_brl,
                robos: circuit.robots_count,
                realizado_brl: circuit.realized_brl,
                meta_brl: circuit.gain_target_brl,
                teto_brl: circuit.loss_cap_brl,
                posicoes_abertas: circuit.open_positions,
              },

            } as any,

          });
        } catch { /* log best-effort; o bloqueio já aconteceu */ }
        return;
      }
    } catch (e) {
      // Falha ao avaliar o freio real não pode derrubar o simulado; falha FECHADA
      // para o dinheiro real (não enfileira sem saber a perda do dia).
      console.error("[mirror] falha ao avaliar stop real — abertura não enfileirada:", (e as Error).message);
      return;
    }
  }

  try {
    await supabase.from("b3_mt5_commands").insert({

      user_id: userId, env: "real", simulation_run_id: runId, mode, variant,
      action, side, symbol, quantity,
      magic_number: magic, idempotency_key: idempotencyKey,
      requested_by: liberacaoManual && requestedBy === "engine_auto" ? "engine_auto_liberado" : requestedBy,
      liberacao_manual: liberacaoManual,

      stop_pts: levels?.stop_pts ?? null,
      gain_pts: levels?.gain_pts ?? null,
      stop_price: levels?.stop_price ?? null,
      target_price: levels?.target_price ?? null,
    });
  } catch (e) {
    // Espelhamento nunca pode derrubar o motor de simulação — só loga.
    console.error(`[mirror] falha ao espelhar ${action} de ${mode}/${variant} pra real:`, (e as Error).message);
  }
}

// Os 8 modos, na ordem de `b3_mode_apelidos.ordem` (1..8):
// João, Amanda, Bernardo, Camila, Davi, Ana, Alexandre, Enoir.
// ATENÇÃO: esta lista NÃO é a lista de execução do motor. O laço do tique lê
// os modos habilitados de b3_simulation_mode_settings (ver `activeModes`).
// Aqui ela só serve de ordem de exibição e de fallback de criação de linhas.
type Mode =
  | "conservador" | "cauteloso" | "moderado" | "equilibrado"
  | "semi_agressivo" | "arrojado" | "agressivo" | "enoir";
const MODES: Mode[] = [
  "conservador", "cauteloso", "moderado", "equilibrado",
  "semi_agressivo", "arrojado", "agressivo", "enoir",
];

// Instrumentação da gestão de posição aberta: no máximo 1 gravação por minuto
// por ordem (chave = order_id → minuto epoch já registrado).
const openEvalLogMinute = new Map<string, number>();

// Ordens cujo travamento de grupo já foi espelhado para o real (09/09/2026).
// A ordem simulada permanece aberta em sombra, então o bloco é reavaliado a
// cada tique: sem esta marca o fechamento real seria reenfileirado sem parar.
// A chave de idempotência do comando é a segunda barreira.
const grupoFreioEspelhado = new Set<string>();
// Mesma marca para o FREIO DE PICO (15/09/2026), que também passou a ser
// sombra no simulado: a posição simulada segue aberta e o real é encerrado
// uma única vez por ordem.
const picoFreioEspelhado = new Set<string>();


interface ModeDefaults {
  entry_style: string;
  min_approve_votes: number; min_confidence: number; min_score: number;
  max_contracts: number; stop_pts: number; gain_pts: number; max_volatility_pct: number;
  daily_loss_limit_brl: number; daily_gain_target_brl: number;
  trailing_activation_pts?: number; trailing_giveback_pts?: number; trailing_mode?: string;
}
const MODE_DEFAULTS: Record<Mode, ModeDefaults> = {
  conservador:    { entry_style: 'indicador', min_approve_votes: 4, min_confidence: 70, min_score: 75, max_contracts: 1, stop_pts: 100, gain_pts: 200, max_volatility_pct: 2.5, daily_loss_limit_brl: 100, daily_gain_target_brl: 200, trailing_activation_pts: 0, trailing_giveback_pts: 0, trailing_mode: 'fixed' },
  moderado:       { entry_style: 'indicador', min_approve_votes: 4, min_confidence: 62, min_score: 65, max_contracts: 2, stop_pts: 150, gain_pts: 300, max_volatility_pct: 3.5, daily_loss_limit_brl: 300, daily_gain_target_brl: 500, trailing_activation_pts: 0, trailing_giveback_pts: 0, trailing_mode: 'fixed' },
  equilibrado:    { entry_style: 'indicador', min_approve_votes: 4, min_confidence: 62, min_score: 62, max_contracts: 3, stop_pts: 220, gain_pts: 440, max_volatility_pct: 3.8, daily_loss_limit_brl: 500, daily_gain_target_brl: 700, trailing_activation_pts: 0, trailing_giveback_pts: 0, trailing_mode: 'fixed' },
  semi_agressivo: { entry_style: 'indicador', min_approve_votes: 4, min_confidence: 60, min_score: 60, max_contracts: 4, stop_pts: 300, gain_pts: 600, max_volatility_pct: 4.0, daily_loss_limit_brl: 800, daily_gain_target_brl: 1000, trailing_activation_pts: 0, trailing_giveback_pts: 0, trailing_mode: 'fixed' },
  agressivo:      { entry_style: 'indicador', min_approve_votes: 4, min_confidence: 55, min_score: 55, max_contracts: 3, stop_pts: 200, gain_pts: 400, max_volatility_pct: 4.5, daily_loss_limit_brl: 600, daily_gain_target_brl: 1200, trailing_activation_pts: 0, trailing_giveback_pts: 0, trailing_mode: 'fixed' },
  // Fallback de fábrica dos três modos novos. NÃO sobrescreve nada já salvo:
  // só é usado quando não existe linha em b3_simulation_mode_settings.
  cauteloso:      { entry_style: 'indicador', min_approve_votes: 4, min_confidence: 66, min_score: 70, max_contracts: 1, stop_pts: 120, gain_pts: 240, max_volatility_pct: 3.0, daily_loss_limit_brl: 200, daily_gain_target_brl: 350, trailing_activation_pts: 0, trailing_giveback_pts: 0, trailing_mode: 'fixed' },
  arrojado:       { entry_style: 'indicador', min_approve_votes: 4, min_confidence: 60, min_score: 60, max_contracts: 3, stop_pts: 260, gain_pts: 520, max_volatility_pct: 4.0, daily_loss_limit_brl: 600, daily_gain_target_brl: 900, trailing_activation_pts: 0, trailing_giveback_pts: 0, trailing_mode: 'fixed' },
  enoir:          { entry_style: 'indicador', min_approve_votes: 4, min_confidence: 58, min_score: 58, max_contracts: 2, stop_pts: 480, gain_pts: 240, max_volatility_pct: 4.5, daily_loss_limit_brl: 700, daily_gain_target_brl: 500, trailing_activation_pts: 0, trailing_giveback_pts: 0, trailing_mode: 'fixed' },
};

function hhmmToMin(s: string) { const [h, m] = String(s).split(":").map(Number); return h * 60 + m; }

function saoPauloMinutes(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(d);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

// ───────────────────── start ─────────────────────
interface StartInput {
  initial_balance?: number;
  max_contracts?: number;
  fee_brl?: number;
  slippage_pts?: number;
  trading_start_time?: string;
  entry_cutoff_time?: string;
  force_close_time?: string;
  notes?: string;
  symbol?: string; // Fase 0: default 'WINQ26'. Precisa existir uma linha correspondente em b3_asset_profiles.
}
// Fuso do pregão B3 — usado para agrupar reinícios do mesmo dia num session_day_id único.
function currentB3SessionDate(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const y = parts.find(p => p.type === "year")?.value;
  const m = parts.find(p => p.type === "month")?.value;
  const d = parts.find(p => p.type === "day")?.value;
  return `${y}-${m}-${d}`;
}

async function resolveSessionDayId(supabase: any, userId: string, symbol: string, sessionDate: string): Promise<string> {
  const { data } = await supabase
    .from("b3_simulation_runs")
    .select("session_day_id")
    .eq("user_id", userId)
    .eq("symbol", symbol)
    .eq("session_date", sessionDate)
    .not("session_day_id", "is", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data?.session_day_id) return data.session_day_id as string;
  return (globalThis.crypto?.randomUUID?.() ?? cryptoRandomFallback());
}
function cryptoRandomFallback(): string {
  // fallback determinístico-suficiente; runtime Workers já expõe crypto.randomUUID
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export const startB3Simulation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: StartInput) => d ?? {})
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const initial = Number(data.initial_balance ?? 10000);
    const symbol = data.symbol ?? "WINQ26";
    const sessionDate = currentB3SessionDate();
    const sessionDayId = await resolveSessionDayId(supabase as any, userId, symbol, sessionDate);
    const { data: run, error } = await (supabase as any)
      .from("b3_simulation_runs")
      .insert({
        user_id: userId,
        initial_balance: initial,
        max_contracts: Number(data.max_contracts ?? 1),
        simulated_fee_brl: Number(data.fee_brl ?? 1.5),
        simulated_slippage_pts: Number(data.slippage_pts ?? 0),
        trading_start_time: data.trading_start_time ?? "09:15",
        entry_cutoff_time: data.entry_cutoff_time ?? "16:30",
        force_close_time: data.force_close_time ?? "16:55",
        notes: data.notes ?? null,
        status: "running",
        symbol,
        session_date: sessionDate,
        session_day_id: sessionDayId,
      })
      .select("*").single();
    if (error) throw error;

    const modeRows = MODES.map(m => ({
      simulation_run_id: run.id, user_id: userId, mode: m,
      initial_balance: initial, current_balance: initial,
    }));
    const { error: mErr } = await (supabase as any).from("b3_simulation_modes").insert(modeRows);
    if (mErr) throw mErr;

    // Usa o padrão salvo pelo usuário (b3_mode_user_defaults) quando
    // existir; cai no MODE_DEFAULTS de fábrica só pros modos sem padrão
    // próprio salvo ainda. Sem isso, TODA simulação nova sempre nascia com
    // os valores de fábrica, obrigando reconfigurar tudo de novo — motivo
    // direto do pedido do usuário (item 7, 06/08/2026).
    // O padrão é POR ATIVO: a chave da tabela é (user_id, symbol, mode).
    // Sem o filtro por symbol, o padrão do WIN era aplicado numa run de WDO
    // e escrevia stop de 300 pts (R$ 3.000+ de risco por contrato no mini
    // dólar, onde o ponto vale R$ 10 contra R$ 0,20 do WIN).
    const { data: userDefaults } = await (supabase as any)
      .from("b3_mode_user_defaults").select("*").eq("user_id", userId).eq("symbol", symbol);
    const userDefaultsByMode: Record<string, any> = {};
    for (const d of userDefaults ?? []) userDefaultsByMode[d.mode] = d;

    const factoryModes: string[] = [];
    const settingRows = MODES.map(m => {
      const ud = userDefaultsByMode[m];
      if (!ud) factoryModes.push(m);
      const base = ud
        ? Object.fromEntries(SETTING_FIELDS.map(k => [k, k in ud && ud[k] != null ? ud[k] : MODE_DEFAULTS[m][k as keyof typeof MODE_DEFAULTS[typeof m]]]))
        : MODE_DEFAULTS[m];
      return {
        simulation_run_id: run.id, user_id: userId, mode: m, ...base,
        trading_start_time: run.trading_start_time,
        entry_cutoff_time: run.entry_cutoff_time,
        force_close_time: run.force_close_time,
      };
    });
    await (supabase as any).from("b3_simulation_mode_settings").insert(settingRows);
    return {
      ...run,
      defaults_symbol: symbol,
      factory_default_modes: factoryModes,
      factory_default_warning: factoryModes.length
        ? `Modos sem padrão salvo para ${symbol} (${factoryModes.join(", ")}) nasceram com o padrão de fábrica, calibrado para mini índice; revise stop, alvo e quantidade antes de operar este ativo.`
        : null,
    };
  });



// ───────────────────── controls ─────────────────────
export const setB3SimulationStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { run_id: string; status: "running" | "paused" | "finished" | "cancelled" }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const patch: any = { status: data.status };
    if (data.status === "finished" || data.status === "cancelled") patch.ended_at = new Date().toISOString();
    const { error } = await (supabase as any).from("b3_simulation_runs")
      .update(patch).eq("id", data.run_id).eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });

export const setB3SimulationWinner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { run_id: string; mode: Mode }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await (supabase as any).from("b3_simulation_runs")
      .update({ winner_mode: data.mode }).eq("id", data.run_id).eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });

// ───────────────────── list / detail ─────────────────────
export const listB3Simulations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await (supabase as any).from("b3_simulation_runs")
      .select("*").eq("user_id", userId).order("started_at", { ascending: false }).limit(30);
    if (error) throw error;
    return data ?? [];
  });

export const getB3SimulationDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { run_id: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // I/O: sem select("*") em tabelas grandes e limites enxutos — a tela usa
    // no máximo 60 ordens e o último snapshot (engine_audit).
    const ORDER_COLS = "id, mode, side, status, symbol, contract_code, entry_price, exit_price, exit_time, created_at, quantity, fees, gross_result_brl, gross_result_points, net_result_brl, close_reason, quote_source, provider_name";
    const [runR, modesR, settingsR, ordersR, snapsR, stateR] = await Promise.all([
      (supabase as any).from("b3_simulation_runs").select("*").eq("id", data.run_id).eq("user_id", userId).maybeSingle(),
      (supabase as any).from("b3_simulation_modes").select("*").eq("simulation_run_id", data.run_id).eq("user_id", userId),
      (supabase as any).from("b3_trading_settings").select("price_source").eq("user_id", userId).maybeSingle(),
      (supabase as any).from("b3_simulation_orders").select(ORDER_COLS).eq("simulation_run_id", data.run_id).eq("user_id", userId).order("created_at", { ascending: false }).limit(800),
      (supabase as any).from("b3_simulation_market_snapshots")
        .select("id, market_time, price, quote_source, quote_server, quote_symbol, quote_tick_ts, quote_bid, quote_ask, quote_last, provider_name, extra")
        .eq("simulation_run_id", data.run_id).eq("user_id", userId).order("market_time", { ascending: false }).limit(3),
      // Auditoria do último tique: estado corrente do motor, uma linha por
      // execução, atualizada no lugar (não mais repetida dentro do snapshot).
      (supabase as any).from("b3_engine_state").select("engine_audit, tick_guard, market_time, updated_at")
        .eq("simulation_run_id", data.run_id).eq("user_id", userId).maybeSingle(),
    ]);

    if (runR.error) throw runR.error;
    if (!runR.data) throw new Error("Run não encontrada");
    const isMt5Source = settingsR.data?.price_source === "mt5_xp_demo";
    const allOrders = (ordersR.data ?? []) as any[];
    const visibleOrders = isMt5Source
      ? allOrders.filter((o) => o.quote_source === "MT5 XP DEMO" && o.provider_name === "B3QuoteProvider").slice(0, 500)
      : allOrders.slice(0, 500);
    const hiddenLegacyCount = isMt5Source
      ? allOrders.filter((o) => o.quote_source !== "MT5 XP DEMO" || o.provider_name !== "B3QuoteProvider").length
      : 0;

    const visibleModes = isMt5Source
      ? ((modesR.data ?? []) as any[]).map((m) => {
        const orders = visibleOrders.filter((o) => o.mode === m.mode);
        const closed = orders.filter((o) => o.status === "closed");
        const realized = closed.reduce((s, o) => s + Number(o.net_result_brl ?? 0), 0);
        const fees = orders.reduce((s, o) => s + Number(o.fees ?? 0), 0);
        const wins = closed.filter((o) => Number(o.net_result_brl ?? 0) > 0).length;
        const losses = closed.filter((o) => Number(o.net_result_brl ?? 0) < 0).length;
        const maxGain = closed.reduce((v, o) => Math.max(v, Number(o.net_result_brl ?? 0)), 0);
        const maxLoss = closed.reduce((v, o) => Math.min(v, Number(o.net_result_brl ?? 0)), 0);
        const points = closed.reduce((s, o) => s + Number(o.gross_result_points ?? 0), 0);
        const contracts = orders.reduce((s, o) => s + Number(o.quantity ?? 0), 0);
        let acc = 0, peak = 0, dd = 0;
        for (const o of closed.slice().sort((a, b) => new Date(a.exit_time ?? a.created_at).getTime() - new Date(b.exit_time ?? b.created_at).getTime())) {
          acc += Number(o.net_result_brl ?? 0);
          peak = Math.max(peak, acc);
          dd = Math.max(dd, peak - acc);
        }
        return {
          ...m,
          realized_pnl: realized,
          unrealized_pnl: 0,
          current_balance: Number(m.initial_balance ?? 0) + realized,
          total_fees: fees,
          total_trades: closed.length,
          winning_trades: wins,
          losing_trades: losses,
          max_gain: maxGain,
          max_loss: maxLoss,
          max_drawdown: dd,
          points_result: points,
          contracts_traded: contracts,
        };
      })
      : (modesR.data ?? []);
    return {
      run: runR.data,
      modes: visibleModes,
      price_source: settingsR.data?.price_source ?? "csv",
      orders: visibleOrders,
      legacy_orders_hidden: hiddenLegacyCount,
      engine_state: stateR.data ?? null,
      snapshots: snapsR.data ?? [],
    };
  });

// ───────────────────── tick (core, reutilizado por hook público) ─────────────────────
// Estado de I/O em memória (por isolate). Não altera estratégia — apenas evita
// gravações e leituras repetidas no banco.
type SnapMemo = {
  id: string | null;
  persisted_at: number;        // epoch ms da última persistência real
  quote_tick_ts: string | null;
  write_sigs: Record<string, string>;
  last_price: number | null;   // preço/cotação atuais mantidos só em memória
  last_quote: any;
};
const SNAP_MEMO = new Map<string, SnapMemo>();
const TICK_LOCKS = new Map<string, number>();
const SNAP_PERSIST_MS = 10_000;

// Versão enxuta de engine_audit para tiques sem evento. Preserva só o que a
// tela de diagnóstico usa para explicar a decisão de cada robô; corta os
// arrays de checks, config_loaded/config_saved e o objeto committee inteiro
// (responsáveis por ~31 kB de TOAST por snapshot).
function slimEngineAudit(tickAudit: any) {
  return {
    snapshot_id: tickAudit.snapshot_id ?? null,
    tick_index: tickAudit.tick_index,
    timestamp: tickAudit.timestamp,
    source: tickAudit.source,
    provider_name: tickAudit.provider_name,
    last_tick: tickAudit.last_tick,
    global_protection: tickAudit.global_protection,
    quote_stall: tickAudit.quote_stall ?? null,
    resumido: true,
    modes: (tickAudit.modes ?? []).map((m: any) => ({
      mode: m.mode,
      timestamp: m.timestamp,
      last_refusal_reason: m.last_refusal_reason ?? null,
      first_stop: m.first_stop ?? null,
      last_score: m.last_score ?? null,
      last_confidence: m.last_confidence ?? null,
      last_setup: m.last_setup ?? null,
      protection_global: m.protection_global ?? null,
      resumido: true,
    })),
  };
}

// ── RESUMO COMPACTO POR ROBÔ NO SNAPSHOT (05/09/2026) ──────────────────────
// O snapshot é registro de MERCADO. Guardar o objeto de auditoria inteiro em
// cada linha custava 5.612 bytes por linha (47% do campo) para um dado em que
// só a última linha importa — e a última linha agora vive em b3_engine_state.
//
// O que sobra aqui é o mínimo que as telas de Diagnóstico e Funil percorrem ao
// longo do tempo para contar ciclos, sinais, vereditos do comitê e categorias
// de bloqueio. Sem frase repetida, sem votos em texto (já estão inteiros em
// b3_simulation_agent_votes), sem config_loaded/config_saved.
//
// Chaves curtas de propósito: o nome da chave é gravado em TODA linha.
//   m = robô · k = etapa que barrou · d = detalhe numérico dela
//   s = score · c = confiança · u = setup · b/v = sinal compra/venda
//   cm = veredito do comitê (a/r) · o = abriu ordem
//   dc/te = contexto da decisão e evento de trade, só em tique com evento
function buildEngineDigest(tickAudit: any, completo = false) {
  return (tickAudit.modes ?? []).map((m: any) => {
    const abriu = /ordem simulada aberta/i.test(m.last_refusal_reason ?? "");
    const d: any = { m: m.mode };
    if (m.first_stop) {
      d.k = m.first_stop.key;
      // Detalhe TRUNCADO: é dele que o funil extrai "observado × limite".
      if (m.first_stop.detail) d.d = String(m.first_stop.detail).slice(0, 60);
    }
    if (m.last_score != null) d.s = Math.round(Number(m.last_score));
    if (m.last_confidence != null) d.c = Math.round(Number(m.last_confidence));
    if (m.last_setup) d.u = String(m.last_setup).slice(0, 40);
    if (m.signals?.buy) d.b = 1;
    if (m.signals?.sell) d.v = 1;
    if (m.committee) d.cm = m.committee.final === "approved" ? "a" : "r";
    if (abriu) d.o = 1;
    if (m.last_refusal_reason) d.r = String(m.last_refusal_reason).slice(0, 90);
    if (completo) {
      if (m.decision_context) d.dc = m.decision_context;
      if (m.trade_event) d.te = m.trade_event;
    }
    return d;
  });
}

// Reconstrói, a partir do resumo compacto, a forma que os agregadores já
// esperavam. Um único ponto de tradução: nenhum leitor precisa conhecer as
// chaves curtas.
const ENGINE_STEP_LABEL: Record<string, string> = {
  tick_received: "Tick recebido", mt5_server: "Servidor MT5", mt5_symbol: "Símbolo",
  market_open: "Mercado aberto", time_allowed: "Horário permitido",
  grupo_limite: "Freio de grupo",
  operation_window: "Janela operacional", force_close_window: "Janela zeragem",
  valid_quote: "Cotação válida", spread: "Spread", global_protection: "Proteção Global",
  mode_enabled: "Robô habilitado", volatility: "Volatilidade", max_trades: "Máximo trades",
  daily_loss: "Loss diário", daily_loss_aggregate: "Perda diária agregada (conta)",
  daily_target: "Meta diária", position_open: "Posição aberta",
  protection_engine: "Proteção diária", score: "Score", confidence: "Confiança",
  committee: "Comitê", signal_buy: "Sinal BUY", signal_sell: "Sinal SELL",
  setup: "Setup técnico", entry_style: "Modalidade de entrada",
};

export function engineAuditFromSnapshot(snap: any) {
  const extra = snap?.extra ?? {};
  const digest = extra.engine_digest;
  // Linhas gravadas antes desta mudança seguem legíveis pelo caminho antigo.
  if (!Array.isArray(digest)) return extra.engine_audit ?? null;
  return {
    snapshot_id: snap.id ?? null,
    timestamp: snap.market_time ?? null,
    global_protection: extra.global_protection
      ? { ...extra.global_protection, status: extra.global_protection.active ? "Ativa" : "Inativa" }
      : null,
    tick_guard: { ok: extra.guard_ok !== false, first_block_reason: extra.guard_block_reason ?? null },
    do_digest: true,
    modes: digest.map((d: any) => ({
      mode: d.m,
      timestamp: snap.market_time ?? null,
      last_refusal_reason: d.r ?? null,
      first_stop: d.k ? { key: d.k, label: ENGINE_STEP_LABEL[d.k] ?? d.k, detail: d.d ?? null } : null,
      last_score: d.s ?? null,
      last_confidence: d.c ?? null,
      last_setup: d.u ?? null,
      signals: { buy: d.b === 1, sell: d.v === 1 },
      committee: d.cm ? { final: d.cm === "a" ? "approved" : "rejected" } : null,
      decision_context: d.dc ?? null,
      trade_event: d.te ?? null,
      checks: [],
    })),
  };
}

// Assinatura de escrita: só serve para comparar igualdade. Guardar o texto dos
// votos do comitê inteiro (3.440 bytes por linha, 29% do campo) para depois
// comparar strings é desperdício — os votos já estão em b3_simulation_agent_votes.
export function engineSigHash(value: string) {
  let h = 5381;
  for (let i = 0; i < value.length; i++) h = ((h * 33) ^ value.charCodeAt(i)) >>> 0;
  return `${h.toString(36)}:${value.length}`;
}



export async function runB3SimulationTick(
  supabase: any,
  userId: string,
  runId: string,
  ticks = 1,
): Promise<{ ok?: boolean; skipped?: boolean; reason?: string; processed?: number; log: any[] }> {
  ticks = Math.min(Math.max(1, Number(ticks)), 60);

  // Janela rígida da B3 (seg-sex, 09:05-17:00 BRT) validada ANTES do banco:
  // fora dela nada é processado, gravado, logado ou contabilizado.
  const win = b3WindowState();
  if (!win.open) {
    return { skipped: true, reason: "b3_sleeping", log: [] };
  }

  // Lock: impede execuções sobrepostas (cron + UI) para a mesma run.
  const lockKey = `${userId}:${runId}`;
  const lockedAt = TICK_LOCKS.get(lockKey);
  if (lockedAt && Date.now() - lockedAt < 55_000) {
    return { skipped: true, reason: "tick_em_execucao", log: [] };
  }
  TICK_LOCKS.set(lockKey, Date.now());
  try {
    return await runB3SimulationTickInner(supabase, userId, runId, ticks);
  } finally {
    TICK_LOCKS.delete(lockKey);
  }
}

async function runB3SimulationTickInner(
  supabase: any,
  userId: string,
  runId: string,
  ticks: number,
): Promise<{ ok?: boolean; skipped?: boolean; reason?: string; processed?: number; log: any[] }> {


  const { data: run, error: runErr } = await supabase.from("b3_simulation_runs")
    .select("*").eq("id", runId).eq("user_id", userId).maybeSingle();
  if (runErr) throw runErr;
  if (!run) throw new Error("Run não encontrada");
  if (run.status !== "running") return { skipped: true, reason: `Status ${run.status}`, log: [] };
  const asset = await loadAssetProfile(supabase, run.symbol);
  const runVariant = String(run.variant ?? "indicador");
  const globalDailyLossLimitBrl = await loadGlobalDailyLossLimit(supabase, userId);

  const { data: modeRows, error: mErr } = await supabase.from("b3_simulation_modes")
    .select("*").eq("simulation_run_id", runId).eq("user_id", userId);
  if (mErr) throw mErr;
  const modeById: Record<string, any> = {};
  const modeByName: Record<string, any> = {};
  for (const m of modeRows ?? []) { modeById[m.id] = m; modeByName[m.mode] = m; }

  // settings por modo (criadas no start; backfill garante existência em runs antigas)
  const { data: settingsRows } = await supabase.from("b3_simulation_mode_settings")
    .select("*").eq("simulation_run_id", runId).eq("user_id", userId);
  const settingsByMode: Record<string, any> = {};
  for (const s of settingsRows ?? []) settingsByMode[s.mode] = s;
  // garante defaults se faltar
  for (const m of MODES) {
    if (!settingsByMode[m]) {
      settingsByMode[m] = {
        ...MODE_DEFAULTS[m], enabled: true,
        trading_start_time: run.trading_start_time,
        entry_cutoff_time: run.entry_cutoff_time,
        force_close_time: run.force_close_time,
      };
    }
  }

  // ── LISTA DE EXECUÇÃO DO MOTOR: vem do BANCO, não de array em TypeScript ──
  // Todo modo com enabled = true em b3_simulation_mode_settings é avaliado.
  // Antes o laço usava a lista fixa de 5 modos e `cauteloso`, `arrojado` e
  // `enoir` nunca eram sequer avaliados — nem como recusa. Ordem de execução
  // segue a ordem de exibição conhecida; modo desconhecido vai para o fim.
  const activeModes: string[] = (settingsRows ?? [])
    .filter((s: any) => s.enabled !== false)
    .map((s: any) => String(s.mode))
    .sort((a: string, b: string) => {
      const ia = MODES.indexOf(a as Mode), ib = MODES.indexOf(b as Mode);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });

  // Carteira do modo (b3_simulation_modes) é estado do motor: se um modo está
  // habilitado e não tem carteira nesta execução, criamos a carteira agora e
  // registramos — robô que não roda tem que ser barulhento.
  const semCarteira = activeModes.filter((m) => !modeByName[m]);
  if (semCarteira.length) {
    const inicial = Number(run.initial_balance ?? 10000);
    const { data: criados, error: cErr } = await (supabase as any)
      .from("b3_simulation_modes")
      .insert(semCarteira.map((m) => ({
        simulation_run_id: runId, user_id: userId, mode: m,
        initial_balance: inicial, current_balance: inicial,
      })))
      .select("*");
    for (const r of criados ?? []) { modeById[r.id] = r; modeByName[r.mode] = r; }
    try {
      await (supabase as any).from("system_logs").insert({
        event_type: cErr ? "b3_modo_sem_carteira" : "b3_modo_carteira_criada",
        source: "b3-simulation-tick",
        severity: cErr ? "error" : "warning",
        message: cErr
          ? `Modos habilitados sem carteira e sem conseguir criar: ${semCarteira.join(", ")} — ${cErr.message}`
          : `Carteira criada para modos habilitados sem carteira: ${semCarteira.join(", ")}`,
        technical_data: { run_id: runId, symbol: run.symbol, variant: runVariant, modos: semCarteira },
      });
    } catch { /* log nunca derruba o tique */ }
  }


  const now0 = new Date();
  const { data: macros } = await supabase.from("b3_macro_events")
    .select("*").eq("user_id", userId).eq("active", true)
    .lte("block_start", new Date(now0.getTime() + 24 * 3600 * 1000).toISOString())
    .gte("block_end", new Date(now0.getTime() - 24 * 3600 * 1000).toISOString());

  const log: any[] = [];
  // ── Nível de auditoria do snapshot (controle de escrita/TOAST) ────────────
  // O objeto engine_audit completo pesa ~31 kB. Ele só é gravado inteiro
  // quando o tique tem algo a auditar (abertura, fechamento, mudança de
  // status, bloqueio novo ou mudança de veredito do comitê). Nos demais
  // tiques grava-se a versão enxuta (ver slimEngineAudit).
  let auditEvents: string[] = [];
  function markAuditEvent(reason: string) {
    if (!auditEvents.includes(reason)) auditEvents.push(reason);
  }

  let openOrdersCache: any[] | null = null;
  async function getOpen() {
    if (openOrdersCache) return openOrdersCache;
    const { data: o } = await supabase.from("b3_simulation_orders")
      .select("*").eq("simulation_run_id", runId).eq("user_id", userId).eq("status", "open");
    openOrdersCache = o ?? [];
    return openOrdersCache;
  }

  // ── Travas de I/O (não alteram estratégia) ────────────────────────────────
  // 1) dedup: o mesmo quote_tick_ts não é reprocessado;
  // 2) hard throttle: no máximo 1 gravação de snapshot a cada 10s por
  //    user_id + símbolo + run. Entre elas, preço/cotação ficam só em memória;
  // 3) assinaturas: votos, eventos e contadores gravados só quando o estado muda.
  const memoKey = `${userId}:${runId}:${asset.symbol}`;
  let memo = SNAP_MEMO.get(memoKey);
  if (!memo) {
    // Recuperação depois de um isolate novo: a data/hora e o tique vêm do
    // snapshot (registro de mercado); as assinaturas de escrita vêm de
    // b3_engine_state, que é onde o estado do motor mora agora. O `extra` do
    // snapshot deixou de ser lido aqui de propósito — era o campo pesado.
    const [{ data: lastSnapRow }, { data: stateRow }] = await Promise.all([
      supabase.from("b3_simulation_market_snapshots")
        .select("id, market_time, quote_tick_ts")
        .eq("simulation_run_id", runId).eq("user_id", userId)
        .order("market_time", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("b3_engine_state").select("write_sigs")
        .eq("simulation_run_id", runId).eq("user_id", userId).maybeSingle(),
    ]);
    memo = {
      id: lastSnapRow?.id ?? null,
      persisted_at: lastSnapRow?.market_time ? new Date(lastSnapRow.market_time).getTime() : 0,
      quote_tick_ts: lastSnapRow?.quote_tick_ts ?? null,
      write_sigs: { ...(((stateRow as any)?.write_sigs as any) ?? {}) },
      last_price: null,
      last_quote: null,
    };
    SNAP_MEMO.set(memoKey, memo);
  }

  const writeSigs: Record<string, string> = memo.write_sigs;
  function sigChanged(key: string, value: string) {
    // Guardamos o HASH, não o texto: a assinatura só serve para comparar
    // igualdade, e os votos do comitê em texto pesavam 29% do campo `extra`.
    const h = engineSigHash(value);
    if (writeSigs[key] === h || writeSigs[key] === value) return false;
    writeSigs[key] = h;
    return true;
  }



  // PnL realizado SOMENTE no dia de hoje (BRT) — usado para gate de
  // daily_loss_limit / daily_gain_target. Antes usávamos m.realized_pnl
  // (cumulativo), o que travava modos que já bateram a meta em dias anteriores.
  async function getRealizedTodayByMode(): Promise<Record<string, number>> {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
    // 00:00 BRT (UTC-3) = 03:00 UTC do mesmo dia
    const startUtcIso = `${parts}T03:00:00.000Z`;
    const { data: closedToday } = await supabase.from("b3_simulation_orders")
      .select("mode, net_result_brl, exit_time")
      .eq("simulation_run_id", runId).eq("user_id", userId).eq("status", "closed")
      .gte("exit_time", startUtcIso);
    const map: Record<string, number> = { conservador: 0, moderado: 0, equilibrado: 0, semi_agressivo: 0, agressivo: 0 };
    for (const r of closedToday ?? []) {
      map[r.mode as string] = (map[r.mode as string] || 0) + Number(r.net_result_brl ?? 0);
    }
    return map;
  }
  let realizedTodayByMode = await getRealizedTodayByMode();

  function markOpenOrderBrl(order: any, markPrice: number | null): number | null {
    if (!order || markPrice == null || !(markPrice > 0)) return null;
    const dir = order.side === "buy" ? 1 : -1;
    return (markPrice - Number(order.entry_price)) * dir
      * Number(asset.tick_value_brl ?? POINT_VALUE_BRL) * Number(order.quantity ?? 1);
  }

  function liveExitMarkPrice(order: any, info: B3PriceContextResult, fallbackCtx: any): number | null {
    if (!order) return null;
    if (info.source === "mt5_xp_demo") {
      const bid = Number(info.raw?.bid);
      const ask = Number(info.raw?.ask);
      const p = order.side === "buy" ? bid : ask;
      return p > 0 ? roundToTick(p, Number(asset.tick_size)) : null;
    }
    const p = Number(fallbackCtx?.price);
    return p > 0 ? roundToTick(p, Number(asset.tick_size)) : null;
  }

  // ── Freio escalonado por GRUPO (symbol + variant) ─────────────────────────
  // Configuração e estado do dia vivem em b3_grupo_limites / b3_grupo_estado_dia.
  // O motor só lê e age. Travar = bloquear ENTRADA NOVA; gestão de posição
  // aberta nunca é pulada por nenhum nível.
  // 08/09/2026: a busca é pela RAIZ do ativo (WIN, WDO, BIT…), nunca pelo
  // contrato. Chavear por contrato desligava o freio em silêncio a cada
  // rolagem de vencimento (WDOU26 → WDOV26 em 30/08 deixou WDO, BIT, ETR e
  // SOL sem freio nenhum por mais de uma semana).
  const grupoDia = b3DayKeyBRT(new Date());
  const grupoRoot = rootSymbol(run.symbol);
  let grupoLimites: B3GrupoLimites | null = null;
  {
    const { data: gl } = await supabase.from("b3_grupo_limites")
      .select("*").eq("user_id", userId).eq("symbol", grupoRoot).eq("variant", runVariant).maybeSingle();
    if (gl) {
      grupoLimites = {
        teto_brl: Number(gl.teto_brl), nivel1_pct: Number(gl.nivel1_pct),
        nivel2_pct: Number(gl.nivel2_pct), nivel3_pct: Number(gl.nivel3_pct),
        nivel4_pct: Number(gl.nivel4_pct), fator_contratos: Number(gl.fator_contratos),
        histerese_pct: Number(gl.histerese_pct), dwell_minutos: Number(gl.dwell_minutos),
        ativo: gl.ativo !== false,
      };
    }
  }
  // Grupo sem linha de configuração opera sem freio. Isso precisa gritar —
  // um aviso por grupo por pregão, para a tela e para o log.
  if (!grupoLimites) {
    try {
      const fonte = `b3_grupo_freio:${grupoRoot}/${runVariant}`;
      const { data: jaAvisado } = await supabase.from("system_logs")
        .select("id").eq("event_type", "b3_grupo_sem_limite").eq("source", fonte)
        .gte("created_at", `${grupoDia}T03:00:00.000Z`).limit(1);
      if (!jaAvisado?.length) {
        await supabase.from("system_logs").insert({
          event_type: "b3_grupo_sem_limite", severity: "warning", source: fonte,
          message: `[${grupoRoot}/${runVariant}] sem linha em b3_grupo_limites — o grupo está operando SEM freio escalonado.`,
          technical_data: {
            symbol_execucao: run.symbol, symbol_raiz: grupoRoot,
            variant: runVariant, trade_date: grupoDia, run_id: runId,
          } as any,
        });
      }
    } catch { /* aviso best-effort: nunca derruba o tique */ }
  }
  let grupoEstado: B3GrupoEstado = {
    resultado_brl: 0, pior_do_dia_brl: 0, nivel_atual: 0, multiplicador: 1,
    ultima_mudanca_ts: null, robos_travados: [],
  };
  if (grupoLimites) {
    const { data: ge } = await supabase.from("b3_grupo_estado_dia")
      .select("*").eq("user_id", userId).eq("symbol", grupoRoot)
      .eq("variant", runVariant).eq("trade_date", grupoDia).maybeSingle();
    if (ge) {
      grupoEstado = {
        resultado_brl: Number(ge.resultado_brl ?? 0),
        pior_do_dia_brl: Number(ge.pior_do_dia_brl ?? 0),
        nivel_atual: Number(ge.nivel_atual ?? 0),
        multiplicador: Number(ge.multiplicador ?? 1),
        ultima_mudanca_ts: ge.ultima_mudanca_ts ?? null,
        robos_travados: Array.isArray(ge.robos_travados) ? ge.robos_travados.map(String) : [],
      };
    }
  }
  let grupoDecision: B3GrupoDecision | null = null;

  /**
   * Reavalia a escada do grupo. `R` inclui posição aberta marcada a mercado —
   * é isso que faz o nível subir DURANTE a operação ruim, e não só depois dela
   * (a trava de devolução de pico só olha entre operações e por isso deixou
   * passar o dobro do limite três vezes em 24/08).
   */
  async function evaluateGrupo(
    livePrice: number | null,
    info?: B3PriceContextResult | null,
    fallbackCtx?: any,
  ): Promise<B3GrupoDecision | null> {
    if (!grupoLimites) return null;
    const openList = (await getOpen()) ?? [];
    const porModo: Record<string, number> = {};
    for (const mode of activeModes) {
      let v = Number(realizedTodayByMode[mode] ?? 0);
      for (const o of openList) {
        if (o.mode !== mode) continue;
        // Marcação a mercado lado a lado (bid para compra, ask para venda)
        // quando há contexto de cotação; senão o último preço conhecido.
        const mark = info ? liveExitMarkPrice(o, info, fallbackCtx) : (livePrice && livePrice > 0 ? livePrice : null);
        const mtm = markOpenOrderBrl(o, mark);
        if (mtm != null) v += mtm;
      }
      porModo[mode] = v;
    }
    const R = Object.values(porModo).reduce((s, v) => s + v, 0);
    const nowIso = new Date().toISOString();
    const dec = decideB3Grupo({ limites: grupoLimites, estado: grupoEstado, resultadoPorModo: porModo, R, nowIso });

    await supabase.from("b3_grupo_estado_dia").upsert({
      user_id: userId, symbol: grupoRoot, variant: runVariant, trade_date: grupoDia,
      resultado_brl: Number(dec.resultado_brl.toFixed(2)),
      pior_do_dia_brl: Number(dec.pior_do_dia_brl.toFixed(2)),
      nivel_atual: dec.nivel, multiplicador: dec.multiplicador,
      ultima_mudanca_ts: dec.ultima_mudanca_ts,
      robos_travados: dec.robos_travados,
    }, { onConflict: "user_id,symbol,variant,trade_date" });

    if (dec.changed) {
      markAuditEvent(`grupo:${run.symbol}/${runVariant}:${dec.nivel_anterior}->${dec.nivel}`);
      const detalhe = {
        symbol: run.symbol, variant: runVariant, trade_date: grupoDia,
        nivel_anterior: dec.nivel_anterior, nivel_novo: dec.nivel,
        resultado_grupo_brl: Number(dec.resultado_brl.toFixed(2)),
        teto_brl: grupoLimites.teto_brl, multiplicador: dec.multiplicador,
        robos_travados: dec.robos_travados, travados_novos: dec.travados_novos,
        resultado_por_modo: porModo, at: nowIso,
      };
      await supabase.from("b3_simulation_block_events").insert({
        simulation_run_id: runId, user_id: userId, mode: "grupo",
        prev_status: `grupo_nivel_${dec.nivel_anterior}`, new_status: `grupo_nivel_${dec.nivel}`,
        trigger: "grupo_freio_escalonado",
        observed_value: Number(dec.resultado_brl.toFixed(2)),
        limit_value: -grupoLimites.teto_brl,
        pnl_at_moment: Number(dec.resultado_brl.toFixed(2)),
        message: dec.motivo, diagnostic_payload: detalhe,
      });
      await supabase.from("system_logs").insert({
        event_type: "b3_grupo_nivel",
        severity: dec.nivel >= 2 ? "error" : "warning",
        source: "b3_grupo_freio",
        message: `[${run.symbol}/${runVariant}] nível ${dec.nivel_anterior} → ${dec.nivel}: ${dec.motivo}`,
        technical_data: detalhe,
      });

      log.push({ action: "grupo_nivel", symbol: run.symbol, variant: runVariant,
        de: dec.nivel_anterior, para: dec.nivel, resultado: dec.resultado_brl, travados: dec.robos_travados });
    }

    grupoEstado = {
      resultado_brl: dec.resultado_brl, pior_do_dia_brl: dec.pior_do_dia_brl,
      nivel_atual: dec.nivel, multiplicador: dec.multiplicador,
      ultima_mudanca_ts: dec.ultima_mudanca_ts, robos_travados: dec.robos_travados,
    };
    grupoDecision = dec;
    return dec;
  }


  const providerStats = {
    selected_source: "desconhecida" as string,
    provider_used: "B3QuoteProvider",
    mt5_provider_calls: 0,
    legacy_provider_calls: 0,
    fallback_to_csv: false,
    last_entry_price: null as number | null,
    last_exit_price: null as number | null,
    last_price_function: null as string | null,
    valid_mt5_orders: 0,
    legacy_orders_invalidated: 0,
  };

  function rememberProvider(info: B3PriceContextResult) {
    providerStats.selected_source = info.quote_source;
    providerStats.mt5_provider_calls += info.mt5_provider_calls;
    providerStats.legacy_provider_calls += info.legacy_provider_calls;
    providerStats.fallback_to_csv = providerStats.fallback_to_csv || info.fallback_to_csv;
  }

  function mt5InvalidReason(info: B3PriceContextResult): string | null {
    if (info.source !== "mt5_xp_demo") return null;
    const guardEval = info.guard_evaluation;
    if (info.warming_up_after_gap) {
      const sw = info.sample_window;
      return `warming_up_after_gap: ${sw?.fresh_samples ?? 0}/${sw?.required_samples ?? 0} ticks contínuos`
        + (sw?.cut_by_gap_s ? ` (gap de ${sw.cut_by_gap_s}s descartado)` : "")
        + (sw?.eta_ready_at ? ` — previsão ${sw.eta_ready_at}` : "");
    }
    if (!guardEval) return "Guard MT5 sem avaliação.";
    return guardEval.ok ? null : (guardEval.first_block_reason ?? "Guard MT5 rejeitou o tick.");
  }

  // GRAVAÇÃO CONDICIONAL DO ESTADO DO ROBÔ (15/09/2026).
  //
  // 114 mil UPDATEs em 711 linhas vivas — e a maioria regravava valor idêntico.
  // No Postgres um UPDATE que não muda nada ainda cria nova versão da linha,
  // com I/O e trabalho de vacuum: não é de graça. As comparações espalhadas
  // pelo motor erravam em dois pontos: data devolvida pelo banco como
  // "2026-09-15T12:00:00+00:00" comparada como texto contra ISO "…000Z", e
  // número devolvido como string. Aqui a comparação é única e normalizada, e
  // só os campos que realmente mudaram entram no UPDATE.
  //
  // Não muda nenhum valor calculado: o que muda continua sendo gravado.
  function mesmoValorDeModo(cur: any, next: any): boolean {
    if (cur == null && next == null) return true;
    if (cur == null || next == null) return false;
    if (typeof next === "boolean" || typeof cur === "boolean") return Boolean(cur) === Boolean(next);
    if (typeof next === "number" || typeof cur === "number") return Number(cur) === Number(next);
    const a = String(cur), b = String(next);
    if (a === b) return true;
    // Instantes iguais escritos de formas diferentes (+00:00 vs Z).
    const isTs = (s: string) => /^\d{4}-\d{2}-\d{2}T/.test(s);
    if (isTs(a) && isTs(b)) {
      const ta = Date.parse(a), tb = Date.parse(b);
      if (Number.isFinite(ta) && Number.isFinite(tb)) return ta === tb;
    }
    return false;
  }
  // UMA GRAVAÇÃO POR ROBÔ POR PASSADA (15/09/2026).
  // As mudanças são acumuladas em memória durante a passada e gravadas uma
  // única vez por robô, no `finally` do laço, já sem os campos que não
  // mudaram. O objeto `m` em memória é atualizado na hora, então toda a
  // lógica do tique continua lendo o valor novo. Não é um upsert multi-linha
  // de propósito: o upsert precisaria reescrever colunas de configuração que
  // o usuário pode ter mudado na tela durante a passada.
  const pendingModeWrite = new Map<string, Record<string, any>>();
  // Valor que estava no banco antes da primeira mudança da passada: se o campo
  // voltar a esse valor, ele sai do UPDATE (regravação idêntica não é de graça).
  const modeWriteOrigin = new Map<string, Record<string, any>>();
  async function patchMode(m: any, patch: Record<string, any>): Promise<boolean> {
    const diff: Record<string, any> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (!mesmoValorDeModo(m[k] ?? null, v ?? null)) diff[k] = v;
    }
    if (!Object.keys(diff).length) return false;
    const buf = pendingModeWrite.get(m.id) ?? {};
    const orig = modeWriteOrigin.get(m.id) ?? {};
    for (const k of Object.keys(diff)) if (!(k in orig)) orig[k] = m[k] ?? null;
    Object.assign(buf, diff);
    pendingModeWrite.set(m.id, buf);
    modeWriteOrigin.set(m.id, orig);
    Object.assign(m, diff);
    return true;
  }
  async function flushModeWrite(modeId?: string | null) {
    if (!modeId) return;
    const buf = pendingModeWrite.get(modeId);
    const orig = modeWriteOrigin.get(modeId) ?? {};
    pendingModeWrite.delete(modeId);
    modeWriteOrigin.delete(modeId);
    if (!buf) return;
    const finalDiff: Record<string, any> = {};
    for (const [k, v] of Object.entries(buf)) {
      if (!mesmoValorDeModo(orig[k] ?? null, v ?? null)) finalDiff[k] = v;
    }
    if (!Object.keys(finalDiff).length) return;
    await supabase.from("b3_simulation_modes").update(finalDiff).eq("id", modeId).eq("user_id", userId);
  }
  async function flushAllModeWrites() {
    for (const id of Array.from(pendingModeWrite.keys())) {
      try { await flushModeWrite(id); } catch { /* gravação de estado nunca derruba o tique */ }
    }
  }

  let ordersMutated = false;
  async function recomputeModeTotalsFromValidMt5Orders(force = false) {
    // I/O: só recalcula quando ALGUMA ordem mudou. A assinatura (quantidade de
    // ordens válidas + instante da última alteração) custa duas consultas
    // baratas; o recálculo completo lê milhares de linhas.
    if (!force) {
      const [{ count }, { data: lastRows }] = await Promise.all([
        supabase.from("b3_simulation_orders").select("id", { count: "exact", head: true })
          .eq("simulation_run_id", runId).eq("user_id", userId)
          .eq("quote_source", "MT5 XP DEMO").eq("provider_name", "B3QuoteProvider"),
        supabase.from("b3_simulation_orders").select("updated_at")
          .eq("simulation_run_id", runId).eq("user_id", userId)
          .eq("quote_source", "MT5 XP DEMO").eq("provider_name", "B3QuoteProvider")
          .order("updated_at", { ascending: false }).limit(1),
      ]);
      const sig = `${count ?? 0}:${(lastRows ?? [])[0]?.updated_at ?? ""}`;
      if (!ordersMutated && (memo as any).orders_sig === sig) return;
      (memo as any).orders_sig = sig;
    }
    ordersMutated = false;
    const { data: validOrders } = await supabase.from("b3_simulation_orders")
      .select("id, mode, status, quantity, fees, net_result_brl, gross_result_points, exit_time, created_at, updated_at")
      .eq("simulation_run_id", runId).eq("user_id", userId)
      .eq("quote_source", "MT5 XP DEMO").eq("provider_name", "B3QuoteProvider");
    const byMode: Record<string, any[]> = {};
    for (const mode of activeModes) byMode[mode] = [];
    for (const o of (validOrders ?? [])) if (byMode[o.mode]) byMode[o.mode].push(o);
    providerStats.valid_mt5_orders = (validOrders ?? []).length;

    for (const mode of activeModes) {
      const m = modeByName[mode];
      if (!m) continue;
      const orders = byMode[mode] ?? [];
      const closed = orders.filter((o) => o.status === "closed");
      const realized = closed.reduce((s, o) => s + Number(o.net_result_brl ?? 0), 0);
      const fees = orders.reduce((s, o) => s + Number(o.fees ?? 0), 0);
      const wins = closed.filter((o) => Number(o.net_result_brl ?? 0) > 0).length;
      const losses = closed.filter((o) => Number(o.net_result_brl ?? 0) < 0).length;
      const maxGain = closed.reduce((v, o) => Math.max(v, Number(o.net_result_brl ?? 0)), 0);
      const maxLoss = closed.reduce((v, o) => Math.min(v, Number(o.net_result_brl ?? 0)), 0);
      const points = closed.reduce((s, o) => s + Number(o.gross_result_points ?? 0), 0);
      const contracts = orders.reduce((s, o) => s + Number(o.quantity ?? 0), 0);
      let acc = 0, peak = 0, dd = 0;
      for (const o of closed.slice().sort((a, b) => new Date(a.exit_time ?? a.created_at).getTime() - new Date(b.exit_time ?? b.created_at).getTime())) {
        acc += Number(o.net_result_brl ?? 0);
        peak = Math.max(peak, acc);
        dd = Math.max(dd, peak - acc);
      }
      const patch = {
        realized_pnl: realized,
        unrealized_pnl: 0,
        current_balance: Number(m.initial_balance) + realized,
        total_fees: fees,
        total_trades: closed.length,
        winning_trades: wins,
        losing_trades: losses,
        max_gain: maxGain,
        max_loss: maxLoss,
        max_drawdown: dd,
        points_result: points,
        contracts_traded: contracts,
      };
      // Grava só quando há mudança real de estado.
      await patchMode(m, patch);
    }
    if (force) {
      const maxUpd = (validOrders ?? []).reduce((s: string, o: any) => (o.updated_at > s ? o.updated_at : s), "");
      (memo as any).orders_sig = `${(validOrders ?? []).length}:${maxUpd}`;
    }
  }


  async function invalidateLegacyOrdersForMt5(info: B3PriceContextResult) {
    if (info.source !== "mt5_xp_demo") return;
    // O filtro das ordens legadas vive no BANCO (índice parcial
    // idx_b3_sim_orders_legacy_pending). Antes lia a tabela inteira da execução
    // a cada tique só para descobrir, quase sempre, que não havia nenhuma.
    const { data: legacyOrders } = await supabase.from("b3_simulation_orders")
      .select("id, mode, status, entry_price, exit_price, quote_source, provider_name")
      .eq("simulation_run_id", runId).eq("user_id", userId)
      .in("status", ["open", "closed"])
      .or("quote_source.is.null,quote_source.neq.MT5 XP DEMO,provider_name.is.null,provider_name.neq.B3QuoteProvider")
      .limit(500);
    const rows = (legacyOrders ?? []).filter((o: any) => o.quote_source !== "MT5 XP DEMO" || o.provider_name !== "B3QuoteProvider");
    if (!rows.length) {
      await recomputeModeTotalsFromValidMt5Orders();
      return;
    }
    const nowIso = new Date().toISOString();
    const ids = rows.map((o: any) => o.id);
    await supabase.from("b3_simulation_orders").update({
      status: "cancelled",
      close_reason: "Operação legada invalidada — modo MT5 XP DEMO exige preço B3QuoteProvider",
      exit_time: nowIso,
    }).in("id", ids).eq("user_id", userId);
    providerStats.legacy_orders_invalidated += rows.length;
    openOrdersCache = null; ordersMutated = true;
    for (const o of rows.slice(0, 5)) {

      const m = modeByName[o.mode];
      if (!m) continue;
      await recordStatusIfChanged(o.mode, m, m.current_status ?? "operando", "legacy_price_invalidated", {
        related_order_id: o.id,
        message: "Operação legada ocultada/invalida — modo MT5 XP DEMO exige preço B3QuoteProvider",
        provider_name: info.provider_name,
        price_source: info.quote_source,
        rejected_price: Number(o.exit_price ?? o.entry_price ?? 0),
        mt5_last: info.raw?.last ?? null,
        // Evento idêntico não deve ser forçado novamente; o status/assinatura
        // já impede tempestade de auditoria sem alterar a invalidação da ordem.
        forceLog: false,
        diagnostic_payload: { function: "invalidateLegacyOrdersForMt5", order_quote_source: o.quote_source, order_provider_name: o.provider_name, ...quoteAuditBase(info) },
      });
    }
    await recomputeModeTotalsFromValidMt5Orders(true);

  }

  function orderAuditPatch(audit: B3QuoteExecutionAudit) {
    return {
      quote_source: audit.quote_source,
      quote_server: audit.quote_server,
      quote_symbol: audit.quote_symbol,
      quote_tick_ts: audit.quote_tick_ts,
      quote_bid: audit.quote_bid,
      quote_ask: audit.quote_ask,
      quote_last: audit.quote_last,
      execution_price: audit.execution_price,
      execution_price_origin: audit.execution_price_origin,
      legacy_price_detected: audit.legacy_price_detected,
      provider_name: audit.provider_name,
    };
  }

  // EVENTO DE STATUS: só quando o status REALMENTE mudou na passada (15/09/2026).
  //
  // Dentro de um mesmo tique o status de um robô oscilava (operando ->
  // sombra_grupo -> operando), e cada perna virava linha em
  // b3_simulation_block_events: 205 mil eventos de sombra e 144 mil "ok" sem
  // informação nova. Agora o status intermediário fica em memória e, no fim da
  // passada do robô, um único evento é gravado se o status final diferir do
  // status com que o robô entrou na passada. `forceLog` continua gravando na
  // hora (diagnóstico explícito). Nada muda no que a tela mostra: o status
  // corrente do robô continua o mesmo.
  const statusTickStart = new Map<string, string>();
  const pendingStatusEvent = new Map<string, { mode: string; m: any; newStatus: string; trigger: string; opts: any }>();
  async function insertStatusEvent(mode: string, m: any, prev: string, newStatus: string, trigger: string, opts: any) {
    markAuditEvent(prev !== newStatus ? `status:${mode}:${prev}->${newStatus}` : `block_event:${mode}:${trigger}`);
    await supabase.from("b3_simulation_block_events").insert({
      simulation_run_id: runId, simulation_mode_id: m.id, user_id: userId,
      mode, prev_status: prev, new_status: newStatus, trigger,
      observed_value: opts.observed ?? null,
      limit_value: opts.limit ?? null,
      pnl_at_moment: opts.pnl ?? null,
      related_order_id: opts.related_order_id ?? null,
      message: opts.message ?? null,
      provider_name: opts.provider_name ?? null,
      price_source: opts.price_source ?? null,
      rejected_price: opts.rejected_price ?? null,
      mt5_last: opts.mt5_last ?? null,
      diagnostic_payload: opts.diagnostic_payload ?? {},
    });
  }
  async function flushStatusEvent(modeId?: string | null) {
    if (!modeId) return;
    const pend = pendingStatusEvent.get(modeId);
    pendingStatusEvent.delete(modeId);
    if (!pend) return;
    const inicial = statusTickStart.get(modeId) ?? "operando";
    if (inicial === pend.newStatus) return; // voltou ao mesmo ponto: nada mudou
    try {
      await insertStatusEvent(pend.mode, pend.m, inicial, pend.newStatus, pend.trigger, pend.opts);
    } catch { /* auditoria nunca derruba o tique */ }
  }
  // Helper: registra mudança de status operacional (parou de operar / voltou)
  async function recordStatusIfChanged(
    mode: string, m: any, newStatus: string, trigger: string,
    opts: {
      observed?: number; limit?: number; pnl?: number; related_order_id?: string; message?: string;
      provider_name?: string; price_source?: string; rejected_price?: number | null; mt5_last?: number | null; diagnostic_payload?: any;
      forceLog?: boolean;
    } = {},
  ) {
    const prev = m.current_status ?? "operando";
    if (!statusTickStart.has(m.id)) statusTickStart.set(m.id, prev);
    if (prev === newStatus && !opts.forceLog) return;
    if (opts.forceLog) {
      // Diagnóstico explícito: grava na hora, como antes.
      try { await insertStatusEvent(mode, m, prev, newStatus, trigger, opts); } catch { /* auditoria não derruba o tique */ }
    } else {
      // O evento fica pendente: só vira linha se o status FINAL da passada
      // for diferente do status inicial. Última intenção vence.
      pendingStatusEvent.set(m.id, { mode, m, newStatus, trigger, opts });
    }
    if (prev !== newStatus) {
      await patchMode(m, {
        current_status: newStatus, status_reason: opts.message ?? null,
        status_changed_at: new Date().toISOString(), last_trigger: trigger,
      });
    }
  }

  function auditCheck(key: string, label: string, ok: boolean, detail?: string, blocking = true) {
    return { key, label, status: ok ? "OK" : "NÃO", ok, detail: detail ?? null, blocking };
  }

  function normalizeModeConfig(cfgRow: any) {
    return {
      enabled: cfgRow.enabled !== false,
      volatility: Number(cfgRow.max_volatility_pct),
      score: Number(cfgRow.min_score),
      confidence: Number(cfgRow.min_confidence),
      min_approve_votes: Number(cfgRow.min_approve_votes),
      gain: Number(cfgRow.gain_pts),
      stop: Number(cfgRow.stop_pts),
      contracts: Number(cfgRow.max_contracts),
      daily_loss: Number(cfgRow.daily_loss_limit_brl),
      daily_target: Number(cfgRow.daily_gain_target_brl),
      trading_start_time: String(cfgRow.trading_start_time),
      entry_cutoff_time: String(cfgRow.entry_cutoff_time),
      force_close_time: String(cfgRow.force_close_time),
    };
  }

  function configComparison(cfgRow: any, loaded: any) {
    const saved = normalizeModeConfig(cfgRow);
    const keys = ["volatility", "score", "confidence", "gain", "stop", "contracts", "daily_loss", "daily_target", "trading_start_time", "entry_cutoff_time", "force_close_time"];
    const fields: Record<string, any> = {};
    for (const key of keys) {
      const screen = (saved as any)[key];
      const motor = (loaded as any)[key];
      fields[key] = { screen, motor, matches: String(screen) === String(motor) };
    }
    return { screen: saved, motor: loaded, fields, mismatch_count: Object.values(fields).filter((v: any) => !v.matches).length };
  }

  function finalReasonFromDecision(decision: any, committee: B3CommitteeSettings) {
    if (decision.final === "approved") return `Setup ${decision.side === "buy" ? "BUY" : "SELL"} aprovado.`;
    if (decision.final === "blocked") return decision.vetoes?.length ? `Bloqueado pelo comitê: ${decision.vetoes.join(" | ")}` : "Proteção global ou veto do comitê.";
    if (Number(decision.score) < Number(committee.min_score)) return "Score insuficiente.";
    if (Number(decision.avg_confidence) < Number(committee.min_confidence)) return "Confiança insuficiente.";
    if (Number(decision.approve_votes) < Number(committee.min_approve_votes)) return "Votos insuficientes no comitê.";
    if (decision.final === "rejected") return "Nenhum setup encontrado — agentes rejeitaram o sinal.";
    return "Nenhum setup encontrado.";
  }


  async function fetchMarketHistory(): Promise<any[]> {
    const nowIso = new Date().toISOString();
    const startOfDayBr = (() => {
      const d = new Date();
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
      }).formatToParts(d);
      const y = parts.find(p => p.type === "year")?.value;
      const mo = parts.find(p => p.type === "month")?.value;
      const da = parts.find(p => p.type === "day")?.value;
      return new Date(`${y}-${mo}-${da}T00:00:00-03:00`).toISOString();
    })();
    const { data } = await supabase.from("b3_simulation_market_snapshots")
      // O JSON `extra` tem em média 6,4 KB e não é usado no cálculo abaixo.
      // Excluí-lo evita reler ~1,9 MB por execução do motor.
      .select("market_time, price, quote_bid, quote_ask, quote_last, volume, candle_high, candle_low")
      .eq("user_id", userId)
      .eq("simulation_run_id", runId)
      .gte("market_time", startOfDayBr)
      .lte("market_time", nowIso)
      .order("market_time", { ascending: false })
      .limit(300);
    return data ?? [];
  }

  // Candles M1 REAIS, montados do fluxo de ticks pela função b3_m1_candles.
  // Os campos candle_high/candle_low de b3_simulation_market_snapshots guardam
  // extremos ACUMULADOS de janela (máxima/mínima correntes), e por isso nunca
  // formam fractal (medido: ~3.100 snapshots em 7 pregões = 0 fundos, 1 topo).
  // Toda lógica de estrutura (price action na entrada e trailing estrutural)
  // deve usar esta série, não o histórico de snapshots.
  async function fetchM1Candles(): Promise<any[]> {
    const { data } = await supabase.rpc("b3_m1_candles", {
      p_user_id: userId, p_symbol: asset.symbol, p_limit: 300,
    });
    return ((data as any[]) ?? [])
      .slice()
      .sort((a: any, b: any) => new Date(a.minute_ts).getTime() - new Date(b.minute_ts).getTime());
  }



  function deriveMarketMetrics(history: any[], ctxLocal: any, priceLocal: any) {
    const nowMs = Date.now();
    const prices: number[] = [];
    const volumes: number[] = [];
    let dayHigh = -Infinity, dayLow = Infinity;
    const priceAt = (targetOffsetMs: number) => {
      let best: any = null;
      let bestDiff = Infinity;
      for (const h of history) {
        const t = new Date(h.market_time).getTime();
        const diff = Math.abs(nowMs - targetOffsetMs - t);
        if (diff < bestDiff) { bestDiff = diff; best = h; }
      }
      if (!best) return null;
      const p = Number(best.quote_last ?? best.price ?? 0);
      return Number.isFinite(p) && p > 0 ? p : null;
    };
    for (const h of history) {
      const p = Number(h.quote_last ?? h.price ?? 0);
      if (Number.isFinite(p) && p > 0) {
        prices.push(p);
        if (p > dayHigh) dayHigh = p;
        if (p < dayLow) dayLow = p;
      }
      const v = Number(h.volume ?? 0);
      if (Number.isFinite(v)) volumes.push(v);
    }
    if (!Number.isFinite(dayHigh)) dayHigh = ctxLocal.price;
    if (!Number.isFinite(dayLow)) dayLow = ctxLocal.price;
    const p1 = priceAt(60 * 1000);
    const p3 = priceAt(3 * 60 * 1000);
    const p5 = priceAt(5 * 60 * 1000);
    const cur = ctxLocal.price;
    const var1 = p1 ? cur - p1 : null;
    const var3 = p3 ? cur - p3 : null;
    const var5 = p5 ? cur - p5 : null;
    // aceleração = variação 1m vs variação 3m (média por minuto)
    const accel = (var1 != null && var3 != null) ? (var1) - (var3 / 3) : null;
    const avgVol = volumes.length ? volumes.reduce((a, b) => a + b, 0) / volumes.length : null;
    return {
      day_high: dayHigh, day_low: dayLow,
      dist_day_high_pts: Math.round(dayHigh - cur),
      dist_day_low_pts: Math.round(cur - dayLow),
      var_1m_pts: var1 != null ? Math.round(var1) : null,
      var_3m_pts: var3 != null ? Math.round(var3) : null,
      var_5m_pts: var5 != null ? Math.round(var5) : null,
      acceleration_pts_per_min: accel != null ? Math.round(accel * 100) / 100 : null,
      avg_volume: avgVol != null ? Math.round(avgVol * 100) / 100 : null,
      samples: prices.length,
    };
  }

  // 07/08/2026: o multiplicador era 5 fixo. Como `rel` normaliza pelo PREÇO e
  // não pela volatilidade, ativos de baixa volatilidade relativa nunca saíam
  // de "lateral" — o WDO precisava de um gap de médias de 1,23x o próprio ATR
  // pra chegar a 30, contra 0,63x do WIN, e abaixo de 30 é bloqueio duro.
  // O fator por ativo equaliza isso. WINQ26 = 5 preserva o comportamento.
  function classifyTrend(ctxLocal: any, strengthFactor?: number): { direction: "alta" | "baixa" | "lateral"; strength: number } {
    const emaGap = ctxLocal.ema9 - ctxLocal.ema21;
    const abs = Math.abs(emaGap);
    const direction = emaGap > 0 ? "alta" : emaGap < 0 ? "baixa" : "lateral";
    const fator = Number(strengthFactor ?? 5) || 5;
    // força: 0..100 baseado no gap absoluto normalizado por preço + momentum
    const rel = ctxLocal.price ? (abs / ctxLocal.price) * 10000 : 0; // em basis points x10
    const strength = Math.max(0, Math.min(100, Math.round(rel * fator + Math.abs(ctxLocal.momentum ?? 0) / 3)));
    return { direction: abs < 1e-6 ? "lateral" : direction, strength };
  }

  function classifyRegime(ctxLocal: any, derived: any): string | null {
    if (!Number.isFinite(ctxLocal.volatility_pct)) return null;
    const vol = ctxLocal.volatility_pct;
    const trend = classifyTrend(ctxLocal, Number(asset?.trend_strength_factor ?? 5));
    if (vol > 3.5) return "alta_volatilidade";
    if (trend.strength >= 50 && trend.direction !== "lateral") return `tendencia_${trend.direction}`;
    if (Math.abs(derived?.var_5m_pts ?? 0) < 30 && vol < 1.5) return "range_estreito";
    return "consolidacao";
  }

  // Classifica o cenário técnico antes da aprovação final da entrada.
  // Fase 1: somente `trend_pullback` é operável. Os demais tipos são registrados
  // apenas para auditoria e bloqueiam a entrada com motivo `no_valid_setup`.
  type B3SetupName =
    | "trend_pullback"
    | "breakout_retest"
    | "consolidation_breakout"
    | "support_resistance_rejection"
    | "mean_reversion_snapback"
    | "range_fade"
    | "channel_breakout"
    | "vwap_reversion"
    | "no_valid_setup";

  function classifySetup(params: {
    ctxLocal: any; derived: any; intendedSide: "buy" | "sell"; cfg: any;
  }): { name: B3SetupName; ok: boolean; reasons: string[]; details: Record<string, any> } {
    const { ctxLocal, derived, intendedSide, cfg } = params;
    const trend = classifyTrend(ctxLocal, Number(asset?.trend_strength_factor ?? 5));
    const price = Number(ctxLocal.price);
    const vwap = Number(ctxLocal.vwap);
    const ema9 = Number(ctxLocal.ema9);
    const ema21 = Number(ctxLocal.ema21);
    const open = Number(ctxLocal.open);
    const vol = Number(ctxLocal.volatility_pct ?? 0);
    const stopPts = Math.max(1, Number(cfg.stop_pts) || 0);
    const gainPts = Math.max(0, Number(cfg.gain_pts) || 0);
    const rr = stopPts > 0 ? gainPts / stopPts : 0;
    const distHigh = Number(derived?.dist_day_high_pts ?? 0);
    const distLow = Number(derived?.dist_day_low_pts ?? 0);
    // 07/08/2026: era Math.max(stopPts, 50). O piso de 50 vinha do mini índice,
    // que gira 3.770 pontos por dia. WDO gira 28,50; PETR4 1,86; VALE3 1,47 —
    // nesses ativos é impossível estar a mais de 50 pontos da máxima, então a
    // evidência "resistência/suporte próximo" reprovava sempre e eles operavam
    // com 6 de 7 evidências em vez de 6 de 8. WINQ26 = 50 preserva.
    const nearResistancePts = Number(asset?.near_resistance_pts ?? Math.max(stopPts, 50));
    const details: Record<string, any> = {
      trend_direction: trend.direction, trend_strength: trend.strength,
      price, vwap, ema9, ema21, open, volatility_pct: vol,
      risk_reward: Number(rr.toFixed(2)), min_risk_reward: 1.5,
      dist_day_high_pts: distHigh, dist_day_low_pts: distLow,
      near_resistance_pts: nearResistancePts,
    };

    // Bloqueio DURO (estrutura mínima real — não é opinião, é pré-requisito
    // pro trade fazer sentido nesse lado): mercado tem que ter direção.
    const lateralStrengthMin = Number((cfg as any).lateral_strength_min ?? 30);
    const lateralVolMin = Number((cfg as any).lateral_vol_min ?? 0.3);
    const lateral = trend.direction === "lateral" || trend.strength < lateralStrengthMin || vol < lateralVolMin;
    const wrongDirection =
      (intendedSide === "buy" && trend.direction === "baixa") ||
      (intendedSide === "sell" && trend.direction === "alta");
    const hardBlock: string[] = [];
    if (lateral) hardBlock.push("mercado lateral — entrada bloqueada");
    if (wrongDirection) hardBlock.push("tendência contrária ao lado avaliado");

    // Condições "macias" (evidências, não certezas): cada uma some para o
    // placar. Antes era tudo em "E" (9/9 obrigatórias); agora é threshold —
    // reflete que nenhuma delas sozinha invalida a oportunidade.
    const soft: { label: string; pass: boolean }[] = [];
    if (intendedSide === "buy") {
      soft.push({ label: `força de tendência ${trend.strength} < 40`, pass: trend.strength >= 40 });
      soft.push({ label: "preço abaixo da VWAP", pass: price > vwap });
      soft.push({ label: "EMA9 não acima da EMA21", pass: ema9 > ema21 });
      soft.push({ label: "sem correção para a EMA9 (sem pullback)", pass: price <= ema9 * 1.0015 });
      soft.push({ label: "estrutura perdida (preço abaixo da EMA21)", pass: price > ema21 });
      soft.push({ label: "candle atual não é comprador", pass: price > open });
      soft.push({ label: `resistência próxima (${distHigh} pts do topo)`, pass: !(distHigh > 0 && distHigh < nearResistancePts) });
    } else {
      soft.push({ label: `força de tendência ${trend.strength} < 40`, pass: trend.strength >= 40 });
      soft.push({ label: "preço acima da VWAP", pass: price < vwap });
      soft.push({ label: "EMA9 não abaixo da EMA21", pass: ema9 < ema21 });
      soft.push({ label: "sem correção para a EMA9 (sem pullback)", pass: price >= ema9 * 0.9985 });
      soft.push({ label: "estrutura perdida (preço acima da EMA21)", pass: price < ema21 });
      soft.push({ label: "candle atual não é vendedor", pass: price < open });
      soft.push({ label: `suporte próximo (${distLow} pts do fundo)`, pass: !(distLow > 0 && distLow < nearResistancePts) });
    }
    soft.push({ label: `R:R ${rr.toFixed(2)} < 1.5`, pass: rr >= 1.5 });

    const failedSoft = soft.filter((s) => !s.pass).map((s) => s.label);
    // Threshold configurável por modo (padrão: precisa acertar 6 de 8
    // evidências macias). cfg.setup_min_soft_hits permite ajustar por modo
    // sem tocar em código de novo.
    const minHits = Number((cfg as any).setup_min_soft_hits ?? 6);
    const hits = soft.length - failedSoft.length;
    const softOk = hits >= minHits;

    const failures = [...hardBlock, ...(softOk ? [] : failedSoft)];

    if (hardBlock.length === 0 && softOk) {
      return { name: "trend_pullback", ok: true, reasons: [], details: { ...details, soft_hits: hits, soft_total: soft.length } };
    }
    // Classifica em outros setups — agora também operáveis (ok reflete se
    // aquele padrão específico tem evidência suficiente), não só telemetria.
    let name: B3SetupName = "no_valid_setup";
    let altOk = false;
    if (intendedSide === "buy" && distHigh <= 20 && trend.direction === "alta") { name = "breakout_retest"; altOk = hardBlock.length === 0 && hits >= minHits - 1; }
    else if (intendedSide === "sell" && distLow <= 20 && trend.direction === "baixa") { name = "breakout_retest"; altOk = hardBlock.length === 0 && hits >= minHits - 1; }
    else if (Math.abs(Number(derived?.var_5m_pts ?? 0)) < 40 && vol < 1.5) { name = "consolidation_breakout"; altOk = !wrongDirection && rr >= 1.5; }
    else if (intendedSide === "buy" && distLow <= nearResistancePts) { name = "support_resistance_rejection"; altOk = !lateral && rr >= 1.5; }
    else if (intendedSide === "sell" && distHigh <= nearResistancePts) { name = "support_resistance_rejection"; altOk = !lateral && rr >= 1.5; }
    return { name, ok: altOk, reasons: failures, details: { ...details, soft_hits: hits, soft_total: soft.length } };
  }

  // Price action de verdade na entrada: estrutura de fundos/topos confirmados
  // (fractal N=1, mesma técnica já usada no trailing estrutural), em vez de
  // EMA/VWAP. Só é chamada quando cfg.entry_style === 'price_action'.
  // A série vem de b3_m1_candles (candles M1 reais); snapshots não servem
  // porque candle_high/candle_low neles são extremos acumulados de janela.
  function classifySetupPriceAction(params: {
    ctxLocal: any; intendedSide: "buy" | "sell"; cfg: any; m1Candles: any[];
  }): { name: B3SetupName; ok: boolean; reasons: string[]; details: Record<string, any> } {
    const { ctxLocal, intendedSide, cfg, m1Candles } = params;
    const price = Number(ctxLocal.price);
    const open = Number(ctxLocal.open);
    const stopPts = Math.max(1, Number(cfg.stop_pts) || 0);

    const sorted = (m1Candles ?? []).slice().sort((a: any, b: any) => new Date(a.minute_ts).getTime() - new Date(b.minute_ts).getTime());
    if (sorted.length < 5) {
      return {
        name: "no_valid_setup", ok: false,
        reasons: ["aguardando candles de 1 minuto"],
        details: { m1_candles: sorted.length },
      };
    }
    const swingLows: number[] = [];
    const swingHighs: number[] = [];
    for (let i = 1; i < sorted.length - 1; i++) {
      const prev = sorted[i - 1], cur = sorted[i], next = sorted[i + 1];
      const lp = Number(prev.candle_low), lc = Number(cur.candle_low), ln = Number(next.candle_low);
      if ([lp, lc, ln].every(Number.isFinite) && lc < lp && lc < ln) swingLows.push(lc);
      const hp = Number(prev.candle_high), hc = Number(cur.candle_high), hn = Number(next.candle_high);
      if ([hp, hc, hn].every(Number.isFinite) && hc > hp && hc > hn) swingHighs.push(hc);
    }

    const details: Record<string, any> = { swing_lows_found: swingLows.length, swing_highs_found: swingHighs.length, m1_candles: sorted.length };


    if (swingLows.length < 2 || swingHighs.length < 2) {
      return { name: "no_valid_setup", ok: false, reasons: ["estrutura insuficiente — menos de 2 fundos/topos confirmados hoje"], details };
    }

    const [prevLow, lastLow] = swingLows.slice(-2);
    const [prevHigh, lastHigh] = swingHighs.slice(-2);
    const higherLow = lastLow > prevLow;
    const lowerHigh = lastHigh < prevHigh;
    const higherHigh = lastHigh > prevHigh;
    const lowerLow = lastLow < prevLow;
    Object.assign(details, { prev_low: prevLow, last_low: lastLow, prev_high: prevHigh, last_high: lastHigh });

    const hardBlock: string[] = [];
    let stopRef: number, targetRef: number;

    if (intendedSide === "buy") {
      const structureUp = higherLow && higherHigh;
      if (!structureUp) hardBlock.push("sem estrutura de alta confirmada (precisa fundo e topo mais altos)");
      if (price < lastLow) hardBlock.push("rompeu o último fundo estrutural — estrutura de alta invalidada");
      stopRef = lastLow; targetRef = lastHigh;
    } else {
      const structureDown = lowerHigh && lowerLow;
      if (!structureDown) hardBlock.push("sem estrutura de baixa confirmada (precisa topo e fundo mais baixos)");
      if (price > lastHigh) hardBlock.push("rompeu o último topo estrutural — estrutura de baixa invalidada");
      stopRef = lastHigh; targetRef = lastLow;
    }

    const stopDist = Math.abs(price - stopRef);
    const targetDist = Math.abs(targetRef - price);
    const rr = stopDist > 0 ? targetDist / stopDist : 0;

    const soft: { label: string; pass: boolean }[] = [];
    const nearStructPts = Math.max(stopPts * 0.6, 20);
    soft.push({ label: "longe do fundo/topo estrutural (pullback não confirmado)", pass: stopDist <= nearStructPts });
    soft.push({ label: intendedSide === "buy" ? "candle atual não é comprador" : "candle atual não é vendedor",
      pass: intendedSide === "buy" ? price > open : price < open });
    soft.push({ label: `R:R estrutural ${rr.toFixed(2)} < 1.5`, pass: rr >= 1.5 });

    const failedSoft = soft.filter(s => !s.pass).map(s => s.label);
    const minHits = Number((cfg as any).setup_min_soft_hits_pa ?? 2);
    const hits = soft.length - failedSoft.length;
    const softOk = hits >= minHits;
    const failures = [...hardBlock, ...(softOk ? [] : failedSoft)];
    Object.assign(details, { stop_ref: stopRef, target_ref: targetRef, risk_reward: Number(rr.toFixed(2)), soft_hits: hits, soft_total: soft.length });

    if (hardBlock.length === 0 && softOk) {
      return { name: "trend_pullback", ok: true, reasons: [], details };
    }
    return { name: "no_valid_setup", ok: false, reasons: failures, details };
  }

  // Reversão à média: entra CONTRA o movimento recente quando o preço se
  // esticou demais da referência (VWAP, com fallback na EMA21) e o próprio
  // candle já dá sinal de exaustão. Bloqueio duro quando existe tendência
  // forte na direção do esticão — brigar com tendência é o jeito mais rápido
  // de perder dinheiro nessa modalidade. Série de candles M1 reais.
  function classifySetupMeanReversion(params: {
    ctxLocal: any; cfg: any; m1Candles: any[];
  }): { name: B3SetupName; ok: boolean; reasons: string[]; details: Record<string, any>; side_override?: "buy" | "sell" } {
    const { ctxLocal, cfg, m1Candles } = params;
    const price = Number(ctxLocal.price);
    const open = Number(ctxLocal.open);
    const vwap = Number(ctxLocal.vwap);
    const ema21 = Number(ctxLocal.ema21);
    const stopPts = Math.max(1, Number(cfg.stop_pts) || 0);
    const gainPts = Math.max(0, Number(cfg.gain_pts) || 0);
    const rr = stopPts > 0 ? gainPts / stopPts : 0;
    const trend = classifyTrend(ctxLocal, Number(asset?.trend_strength_factor ?? 5));

    const sorted = (m1Candles ?? []).slice()
      .sort((a: any, b: any) => new Date(a.minute_ts).getTime() - new Date(b.minute_ts).getTime());
    if (sorted.length < 6) {
      return {
        name: "no_valid_setup", ok: false,
        reasons: ["aguardando candles de 1 minuto (mínimo 6)"],
        details: { m1_candles: sorted.length, entry_style: "mean_reversion" },
      };
    }

    // Referência da média e amplitude típica dos últimos minutos (proxy de ATR).
    const ref = Number.isFinite(vwap) && vwap > 0 ? vwap : ema21;
    const refName = Number.isFinite(vwap) && vwap > 0 ? "vwap" : "ema21";
    const recent = sorted.slice(-10);
    const ranges = recent
      .map((c: any) => Number(c.candle_high) - Number(c.candle_low))
      .filter((v: number) => Number.isFinite(v) && v >= 0);
    const atrLike = ranges.length ? ranges.reduce((a, b) => a + b, 0) / ranges.length : 0;
    const stretchPts = Number.isFinite(ref) ? price - ref : 0;
    const stretchAbs = Math.abs(stretchPts);
    // Esticão mínimo: configurável por modo. Base FIXA em fração do stop —
    // não escala com a volatilidade do momento. Base dinâmica (atrLike * 1.5)
    // subia a exigência exatamente no dia de chicote, que é o dia da
    // modalidade: 347 pts exigidos contra 307 pts de esticão real.
    const minStretch = Number((cfg as any).mean_reversion_min_stretch_pts
      ?? stopPts * Number((cfg as any).mean_reversion_min_stretch_stop_ratio ?? 0.6));
    // Lado escolhido exclusivamente pelo esticão. Sem referência ou sem o
    // esticão mínimo ainda não existe lado operável — nunca usamos o lado
    // tendencial recebido pelo motor como fallback desta modalidade.
    const mrSide: "buy" | "sell" | undefined = Number.isFinite(ref) && ref > 0 && stretchAbs >= minStretch
      ? (stretchPts > 0 ? "sell" : stretchPts < 0 ? "buy" : undefined)
      : undefined;

    const last = sorted[sorted.length - 1];
    const prev = sorted[sorted.length - 2];
    const lastHigh = Number(last?.candle_high), lastLow = Number(last?.candle_low);
    const lastClose = Number(last?.candle_close ?? price);
    const prevHigh = Number(prev?.candle_high), prevLow = Number(prev?.candle_low);

    const details: Record<string, any> = {
      entry_style: "mean_reversion",
      m1_candles: sorted.length,
      reference: refName, reference_value: Number.isFinite(ref) ? ref : null,
      price, open, vwap, ema21,
      stretch_pts: Math.round(stretchPts),
      stretch_abs_pts: Math.round(stretchAbs),
      min_stretch_pts: Math.round(minStretch),
      atr_like_pts: Math.round(atrLike * 100) / 100,
      trend_direction: trend.direction, trend_strength: trend.strength,
      risk_reward: Number(rr.toFixed(2)), min_risk_reward: 1.2,
      last_candle: { high: lastHigh, low: lastLow, close: lastClose },
      chosen_side: mrSide ?? null,
      side_source: mrSide ? "classifier_override" : null,
      min_stretch_base: (cfg as any).mean_reversion_min_stretch_pts != null ? "config" : "stop_ratio",
    };

    const hardBlock: string[] = [];
    if (!Number.isFinite(ref) || ref <= 0) hardBlock.push("referência de média indisponível (VWAP/EMA21)");
    // O lado é do classificador (contra o esticão). Só resta exigir esticão real.
    if (stretchPts === 0) hardBlock.push("preço exatamente na média de referência — sem esticão");
    if (stretchAbs < minStretch) {
      hardBlock.push(`esticão insuficiente (${Math.round(stretchAbs)} pts < ${Math.round(minStretch)} pts)`);
    }
    // Tendência forte na direção do esticão = não reverter.
    const trendStrongMin = Number((cfg as any).mean_reversion_trend_block_strength ?? 55);
    const trendAgainst = mrSide != null && (
      (mrSide === "buy" && trend.direction === "baixa" && trend.strength >= trendStrongMin) ||
      (mrSide === "sell" && trend.direction === "alta" && trend.strength >= trendStrongMin)
    );
    if (trendAgainst) {
      hardBlock.push(`tendência forte na direção do esticão (${trend.direction} ${trend.strength}) — reversão bloqueada`);
    }
    details["trend_block_strength"] = trendStrongMin;

    // Evidências macias de exaustão.
    const soft: { label: string; pass: boolean }[] = [];
    if (mrSide === "buy") {
      soft.push({ label: "candle atual não reagiu para cima (sem exaustão da queda)", pass: price > open });
      soft.push({ label: "sem rejeição do fundo (fechamento na parte baixa do candle)",
        pass: Number.isFinite(lastHigh) && Number.isFinite(lastLow) && lastHigh > lastLow
          ? (lastClose - lastLow) / (lastHigh - lastLow) >= 0.4 : false });
      soft.push({ label: "fundo ainda cedendo (fundo abaixo do fundo anterior)",
        pass: Number.isFinite(prevLow) && Number.isFinite(lastLow) ? lastLow >= prevLow : false });
    } else if (mrSide === "sell") {
      soft.push({ label: "candle atual não reagiu para baixo (sem exaustão da alta)", pass: price < open });
      soft.push({ label: "sem rejeição do topo (fechamento na parte alta do candle)",
        pass: Number.isFinite(lastHigh) && Number.isFinite(lastLow) && lastHigh > lastLow
          ? (lastHigh - lastClose) / (lastHigh - lastLow) >= 0.4 : false });
      soft.push({ label: "topo ainda avançando (topo acima do topo anterior)",
        pass: Number.isFinite(prevHigh) && Number.isFinite(lastHigh) ? lastHigh <= prevHigh : false });
    }
    soft.push({ label: `alvo maior que o esticão disponível (${gainPts} pts > ${Math.round(stretchAbs)} pts até a média)`,
      pass: gainPts > 0 ? gainPts <= Math.max(stretchAbs, stopPts) : false });
    soft.push({ label: `R:R ${rr.toFixed(2)} < 1.2`, pass: rr >= 1.2 });

    const failedSoft = soft.filter((s) => !s.pass).map((s) => s.label);
    const minHits = Number((cfg as any).setup_min_soft_hits_mr ?? 3);
    const hits = soft.length - failedSoft.length;
    const softOk = hits >= minHits;
    Object.assign(details, { soft_hits: hits, soft_total: soft.length, soft_min_hits: minHits, soft_failed: failedSoft });

    if (hardBlock.length === 0 && softOk) {
      return { name: "mean_reversion_snapback", ok: true, reasons: [], details, side_override: mrSide };
    }
    return {
      name: "no_valid_setup", ok: false,
      reasons: [...hardBlock, ...(softOk ? [] : failedSoft)],
      details,
      side_override: mrSide,
    };
  }

  // Faixa lateral: identifica topo e fundo da faixa nos candles M1 recentes e
  // opera a favor do retorno ao meio — compra perto do fundo, vende perto do
  // topo. Bloqueia quando a faixa está sendo rompida (preço fora dela ou
  // fechamento M1 além do extremo) ou quando ela é fina/instável demais.
  function classifySetupRange(params: {
    ctxLocal: any; cfg: any; m1Candles: any[];
  }): { name: B3SetupName; ok: boolean; reasons: string[]; details: Record<string, any>; side_override?: "buy" | "sell" } {
    const { ctxLocal, cfg, m1Candles } = params;
    const price = Number(ctxLocal.price);
    const open = Number(ctxLocal.open);
    const stopPts = Math.max(1, Number(cfg.stop_pts) || 0);
    const gainPts = Math.max(0, Number(cfg.gain_pts) || 0);
    const rr = stopPts > 0 ? gainPts / stopPts : 0;
    const trend = classifyTrend(ctxLocal, Number(asset?.trend_strength_factor ?? 5));

    const sorted = (m1Candles ?? []).slice()
      .sort((a: any, b: any) => new Date(a.minute_ts).getTime() - new Date(b.minute_ts).getTime());
    const lookback = Math.max(8, Math.min(60, Number((cfg as any).range_lookback_candles ?? 20)));
    if (sorted.length < 8) {
      return {
        name: "no_valid_setup", ok: false,
        reasons: ["aguardando candles de 1 minuto (mínimo 8)"],
        details: { m1_candles: sorted.length, entry_style: "range" },
      };
    }
    const window = sorted.slice(-lookback);
    const highs = window.map((c: any) => Number(c.candle_high)).filter(Number.isFinite);
    const lows = window.map((c: any) => Number(c.candle_low)).filter(Number.isFinite);
    if (highs.length < 5 || lows.length < 5) {
      return {
        name: "no_valid_setup", ok: false,
        reasons: ["candles M1 sem máxima/mínima suficientes para desenhar a faixa"],
        details: { m1_candles: sorted.length, entry_style: "range" },
      };
    }
    const rangeTop = Math.max(...highs);
    const rangeBottom = Math.min(...lows);
    const rangeSize = rangeTop - rangeBottom;
    const mid = (rangeTop + rangeBottom) / 2;
    const posInRange = rangeSize > 0 ? (price - rangeBottom) / rangeSize : 0.5;
    // Zona de operação nos extremos: 25% da faixa por padrão.
    const edgePct = Math.min(0.45, Math.max(0.05, Number((cfg as any).range_edge_pct ?? 0.25)));
    // O lado só existe nas bordas operáveis e nasce da posição na faixa.
    // O miolo não herda o lado tendencial do motor.
    const rangeSide: "buy" | "sell" | undefined = posInRange <= edgePct
      ? "buy"
      : posInRange >= 1 - edgePct
        ? "sell"
        : undefined;
    // Faixa mínima: precisa caber o stop com folga, senão qualquer oscilação
    // estoura a operação antes de voltar ao meio.
    const minRangeSize = Number((cfg as any).range_min_size_pts ?? stopPts * 1.5);

    const last = sorted[sorted.length - 1];
    const lastClose = Number(last?.candle_close ?? price);

    const details: Record<string, any> = {
      entry_style: "range",
      m1_candles: sorted.length, lookback_candles: window.length,
      range_top: rangeTop, range_bottom: rangeBottom,
      range_size_pts: Math.round(rangeSize),
      min_range_size_pts: Math.round(minRangeSize),
      range_mid: mid,
      position_in_range: Number(posInRange.toFixed(3)),
      edge_pct: edgePct,
      price, open,
      trend_direction: trend.direction, trend_strength: trend.strength,
      risk_reward: Number(rr.toFixed(2)), min_risk_reward: 1.2,
      dist_to_top_pts: Math.round(rangeTop - price),
      dist_to_bottom_pts: Math.round(price - rangeBottom),
      chosen_side: rangeSide ?? null,
      side_source: rangeSide ? "classifier_override" : null,
    };

    const hardBlock: string[] = [];
    if (rangeSize < minRangeSize) {
      hardBlock.push(`faixa estreita demais (${Math.round(rangeSize)} pts < ${Math.round(minRangeSize)} pts)`);
    }
    // Rompimento: preço fora da faixa ou fechamento M1 além do extremo.
    const brokeUp = price > rangeTop || lastClose > rangeTop;
    const brokeDown = price < rangeBottom || lastClose < rangeBottom;
    if (brokeUp) hardBlock.push("faixa rompida para cima — sem operação de range");
    if (brokeDown) hardBlock.push("faixa rompida para baixo — sem operação de range");
    // Tendência forte descaracteriza a lateralidade.
    const trendMax = Number((cfg as any).range_max_trend_strength ?? 60);
    if (trend.direction !== "lateral" && trend.strength >= trendMax) {
      hardBlock.push(`tendência forte (${trend.direction} ${trend.strength}) — faixa descaracterizada`);
    }
    details["max_trend_strength"] = trendMax;
    // O lado é do classificador: compra na banda inferior, venda na superior.
    // Só o miolo da faixa não opera.
    if (!rangeSide) {
      hardBlock.push(`preço no meio da faixa (posição ${(posInRange * 100).toFixed(0)}%) — sem borda para operar`);
    }

    // Evidências macias.
    const soft: { label: string; pass: boolean }[] = [];
    const roomToMid = Math.abs(mid - price);
    if (rangeSide) {
      soft.push({ label: rangeSide === "buy" ? "candle atual não é comprador" : "candle atual não é vendedor",
        pass: rangeSide === "buy" ? price >= open : price <= open });
    }
    soft.push({ label: `espaço até o meio da faixa insuficiente (${Math.round(roomToMid)} pts)`,
      pass: roomToMid >= Math.max(stopPts * 0.5, 10) });
    soft.push({ label: `R:R ${rr.toFixed(2)} < 1.2`, pass: rr >= 1.2 });
    soft.push({ label: `alvo além do extremo oposto da faixa (${gainPts} pts)`,
      pass: gainPts > 0 ? gainPts <= rangeSize : false });

    const failedSoft = soft.filter((s) => !s.pass).map((s) => s.label);
    const minHits = Number((cfg as any).setup_min_soft_hits_range ?? 3);
    const hits = soft.length - failedSoft.length;
    const softOk = hits >= minHits;
    Object.assign(details, { soft_hits: hits, soft_total: soft.length, soft_min_hits: minHits, soft_failed: failedSoft });

    if (hardBlock.length === 0 && softOk) {
      return { name: "range_fade", ok: true, reasons: [], details, side_override: rangeSide };
    }
    return {
      name: "no_valid_setup", ok: false,
      reasons: [...hardBlock, ...(softOk ? [] : failedSoft)],
      details,
      side_override: rangeSide,
    };
  }

  // Modalidade rompimento: reaproveita o MESMO detector de faixa da modalidade
  // `range` (máximas/mínimas dos candles M1 da janela), mas opera a saída da
  // faixa em vez do retorno ao meio — são posições opostas na mesma borda.
  //
  // O canal é medido SEM o candle do rompimento: incluí-lo esticaria a borda
  // junto com o preço e nenhum rompimento seria detectado. O rompimento é o
  // FECHAMENTO do minuto além da borda + uma folga mínima, pra não entrar em
  // pavio. O lado é derivado pela borda rompida (superior = compra, inferior =
  // venda), nunca pelo lado tendencial do motor.
  //
  // Níveis dinâmicos, devolvidos pelo classificador e não fixos em pontos:
  // alvo = 1,0 × altura do canal; stop = 0,45 × altura, medido a partir da
  // entrada — se o preço volta para dentro do canal, o rompimento falhou.
  function classifySetupBreakout(params: {
    ctxLocal: any; cfg: any; m1Candles: any[];
  }): {
    name: B3SetupName; ok: boolean; reasons: string[]; details: Record<string, any>;
    side_override?: "buy" | "sell";
    stop_pts_override?: number | null; gain_pts_override?: number | null;
  } {
    const { ctxLocal, cfg, m1Candles } = params;
    const price = Number(ctxLocal.price);
    const stopPtsCfg = Math.max(1, Number(cfg.stop_pts) || 0);
    const vol = Number(ctxLocal.volatility_pct ?? 0);
    const trend = classifyTrend(ctxLocal, Number(asset?.trend_strength_factor ?? 5));

    const sorted = (m1Candles ?? []).slice()
      .sort((a: any, b: any) => new Date(a.minute_ts).getTime() - new Date(b.minute_ts).getTime());
    const lookback = Math.max(8, Math.min(60, Number((cfg as any).range_lookback_candles ?? 20)));
    if (sorted.length < 9) {
      return {
        name: "no_valid_setup", ok: false,
        reasons: ["aguardando candles de 1 minuto (mínimo 9)"],
        details: { m1_candles: sorted.length, entry_style: "rompimento" },
      };
    }

    // Janela do canal EXCLUI o último candle fechado — ele é o candidato a rompimento.
    const windowAll = sorted.slice(-(lookback + 1));
    const channelCandles = windowAll.slice(0, -1);
    const last: any = windowAll[windowAll.length - 1];
    const highs = channelCandles.map((c: any) => Number(c.candle_high)).filter(Number.isFinite);
    const lows = channelCandles.map((c: any) => Number(c.candle_low)).filter(Number.isFinite);
    if (highs.length < 5 || lows.length < 5) {
      return {
        name: "no_valid_setup", ok: false,
        reasons: ["janela de canal sem candles suficientes"],
        details: { channel_candles: channelCandles.length, entry_style: "rompimento" },
      };
    }

    const rangeTop = Math.max(...highs);
    const rangeBottom = Math.min(...lows);
    const rangeSize = rangeTop - rangeBottom;
    const minRangeSize = Number((cfg as any).range_min_size_pts ?? stopPtsCfg * 1.5);
    // Folga mínima além da borda no FECHAMENTO do minuto, pra não entrar em pavio.
    const minClear = Number((cfg as any).breakout_min_clearance_pts ?? Math.max(stopPtsCfg * 0.1, Number(asset?.tick_size ?? 0)));
    const lastClose = Number(last?.candle_close ?? price);
    const lastOpen = Number(last?.candle_open ?? lastClose);

    const clearanceUp = lastClose - rangeTop;
    const clearanceDown = rangeBottom - lastClose;
    const brokeUp = clearanceUp >= minClear;
    const brokeDown = clearanceDown >= minClear;
    const breakoutSide: "buy" | "sell" | undefined = brokeUp ? "buy" : brokeDown ? "sell" : undefined;

    // Níveis dinâmicos a partir da altura do canal rompido.
    const stopDyn = Math.max(Number(asset?.tick_size ?? 1) * 2, Math.round(rangeSize * 0.45));
    const gainDyn = Math.round(rangeSize * 1.0);
    const rr = stopDyn > 0 ? gainDyn / stopDyn : 0;

    // PASSO 3 da especificação: o rompimento exige que o mercado ESTIVESSE
    // lateral ANTES do rompimento. Antes isso era medido pelo `trend` corrente
    // (ctxLocal) — o instante do rompimento, que por definição é o minuto em
    // que o mercado deixou de ser lateral: exigência autocontraditória, zero
    // entradas em dois pregões. Agora a consolidação prévia é derivada dos
    // PRÓPRIOS candles do canal (já excluído o candle do rompimento), pela
    // sobreposição das faixas das duas metades da janela.
    const latStrengthMin = Number((cfg as any).lateral_strength_min ?? 0);
    const latVolMin = Number((cfg as any).lateral_vol_min ?? 0);
    const halfIdx = Math.floor(channelCandles.length / 2);
    const firstHalf = channelCandles.slice(0, halfIdx);
    const secondHalf = channelCandles.slice(halfIdx);
    const hiOf = (arr: any[]) => Math.max(...arr.map((c: any) => Number(c.candle_high)).filter(Number.isFinite));
    const loOf = (arr: any[]) => Math.min(...arr.map((c: any) => Number(c.candle_low)).filter(Number.isFinite));
    const h1 = firstHalf.length ? hiOf(firstHalf) : rangeTop;
    const l1 = firstHalf.length ? loOf(firstHalf) : rangeBottom;
    const h2 = secondHalf.length ? hiOf(secondHalf) : rangeTop;
    const l2 = secondHalf.length ? loOf(secondHalf) : rangeBottom;
    const overlap = Math.min(h1, h2) - Math.max(l1, l2);
    const overlapRatio = rangeSize > 0 ? overlap / rangeSize : 0;
    // Faixas das duas metades sobrepostas em pelo menos 30% da altura do canal
    // = preço contido numa faixa durante a janela = consolidação.
    const minOverlapRatio = Number((cfg as any).breakout_min_overlap_ratio ?? 0.3);
    const wasLateral = overlapRatio >= minOverlapRatio;


    const priceBeyondBorder = breakoutSide === "buy" ? price > rangeTop : breakoutSide === "sell" ? price < rangeBottom : false;
    const clearance = breakoutSide === "buy" ? clearanceUp : breakoutSide === "sell" ? clearanceDown : Math.max(clearanceUp, clearanceDown);

    const details: Record<string, any> = {
      entry_style: "rompimento",
      lookback_candles: lookback,
      channel_candles: channelCandles.length,
      range_top: rangeTop, range_bottom: rangeBottom, range_size_pts: rangeSize,
      min_range_size_pts: minRangeSize, min_clearance_pts: minClear,
      last_minute_open: lastOpen, last_minute_close: lastClose,
      breakout_clearance_pts: clearance,
      price_vs_border: price > rangeTop ? "acima_da_borda" : price < rangeBottom ? "abaixo_da_borda" : "dentro_do_canal",
      lateralidade_previa: wasLateral,
      consolidacao_overlap_pts: Number(overlap.toFixed(1)),
      consolidacao_overlap_ratio: Number(overlapRatio.toFixed(3)),
      consolidacao_min_overlap_ratio: minOverlapRatio,
      metade_1: { high: h1, low: l1 }, metade_2: { high: h2, low: l2 },
      lateral_strength_min: latStrengthMin, lateral_vol_min: latVolMin,
      trend_strength: trend.strength, volatility_pct: vol,

      stop_dinamico_pts: stopDyn, alvo_dinamico_pts: gainDyn,
      "r:r": Number(rr.toFixed(2)),
    };

    // Bloqueios duros — um só já descarta.
    const hardBlock: string[] = [];
    if (rangeSize < minRangeSize) hardBlock.push(`canal estreito demais pra rompimento operável (${rangeSize.toFixed(0)} pts < mínimo ${minRangeSize.toFixed(0)} pts)`);
    if (!wasLateral) hardBlock.push(`sem consolidação prévia no canal (sobreposição ${(overlapRatio * 100).toFixed(0)}% < mínimo ${(minOverlapRatio * 100).toFixed(0)}% da altura do canal)`);
    if (!breakoutSide) hardBlock.push(`sem fechamento além da borda do canal (fechamento ${lastClose.toFixed(1)}, bordas ${rangeBottom.toFixed(1)}–${rangeTop.toFixed(1)}, folga mínima ${minClear.toFixed(1)} pts)`);

    // Evidências de qualidade do rompimento (placar, não certezas).
    const soft: { label: string; pass: boolean }[] = [
      { label: `preço atual voltou para dentro do canal (${price.toFixed(1)})`, pass: priceBeyondBorder },
      { label: `candle do rompimento sem corpo na direção (${lastOpen.toFixed(1)}→${lastClose.toFixed(1)})`,
        pass: breakoutSide === "buy" ? lastClose > lastOpen : breakoutSide === "sell" ? lastClose < lastOpen : false },
      { label: `folga além da borda sem convicção (< ${(minClear * 2).toFixed(1)} pts)`,
        pass: breakoutSide != null && clearance >= minClear * 2 },
    ];
    const failedSoft = soft.filter((s) => !s.pass).map((s) => s.label);
    const minHits = Number((cfg as any).breakout_min_soft_hits ?? 2);
    const hits = soft.length - failedSoft.length;
    const softOk = hits >= minHits;
    Object.assign(details, { soft_hits: hits, soft_total: soft.length, soft_min_hits: minHits, soft_failed: failedSoft });

    if (hardBlock.length === 0 && softOk) {
      return {
        name: "channel_breakout", ok: true, reasons: [], details,
        side_override: breakoutSide,
        stop_pts_override: stopDyn,
        gain_pts_override: gainDyn,
      };
    }
    return {
      name: "no_valid_setup", ok: false,
      reasons: [...hardBlock, ...(softOk ? [] : failedSoft)],
      details,
      side_override: breakoutSide,
      stop_pts_override: hardBlock.length === 0 ? stopDyn : null,
      gain_pts_override: hardBlock.length === 0 ? gainDyn : null,
    };
  }


  // ── SEXTA MODALIDADE: `pullback` (29/08/2026) ─────────────────────────────
  // Lacuna do sistema: o `indicador` entra no cruzamento de médias e o
  // `rompimento` na quebra do canal — nenhum entra no REPIQUE dentro de uma
  // tendência já estabelecida.
  //
  // Os dois erros que NÃO se repetem aqui:
  //  1. a tendência é medida na janela ANTERIOR ao recuo (a perna), nunca no
  //     instante atual — foi medir no instante errado que deixou o rompimento
  //     dois pregões sem operar;
  //  2. o lado sai da tendência da perna, nunca do intendedSide.
  //
  // Níveis devolvidos pelo classificador: stop além do extremo do recuo (se o
  // preço rompe o fundo do repique numa alta, o setup falhou) e alvo
  // proporcional à perna anterior.
  function classifySetupPullback(params: {
    ctxLocal: any; cfg: any; m1Candles: any[];
  }): {
    name: B3SetupName; ok: boolean; reasons: string[]; details: Record<string, any>;
    side_override?: "buy" | "sell";
    stop_pts_override?: number | null; gain_pts_override?: number | null;
  } {
    const { ctxLocal, cfg, m1Candles } = params;
    const price = Number(ctxLocal.price);
    const stopPtsCfg = Math.max(1, Number(cfg.stop_pts) || 0);
    const tick = Math.max(Number(asset?.tick_size ?? 1), 0.01);
    const vol = Number(ctxLocal.volatility_pct ?? 0);

    const sorted = (m1Candles ?? []).slice()
      .sort((a: any, b: any) => new Date(a.minute_ts).getTime() - new Date(b.minute_ts).getTime());
    const pbLen = Math.max(2, Math.min(8, Number((cfg as any).pullback_candles ?? 3)));
    const lookback = Math.max(10, Math.min(60, Number((cfg as any).pullback_lookback_candles ?? 20)));
    const minCandles = pbLen + 6;
    if (sorted.length < minCandles) {
      return {
        name: "no_valid_setup", ok: false,
        reasons: [`aguardando candles de 1 minuto (mínimo ${minCandles})`],
        details: { m1_candles: sorted.length, entry_style: "pullback" },
      };
    }

    // Janela: [ perna ][ recuo (pbLen) ][ candle de retomada ]
    const windowAll = sorted.slice(-(lookback + 1));
    const rest = windowAll.slice(0, -1);
    const resume: any = windowAll[windowAll.length - 1];
    const legCandles = rest.slice(0, Math.max(0, rest.length - pbLen));
    const pbCandles = rest.slice(-pbLen);
    if (legCandles.length < 5 || pbCandles.length < 2) {
      return {
        name: "no_valid_setup", ok: false,
        reasons: ["janela sem perna e recuo separáveis"],
        details: { leg_candles: legCandles.length, pullback_candles: pbCandles.length, entry_style: "pullback" },
      };
    }

    const num = (v: any) => Number(v);
    const legStart = num(legCandles[0]?.candle_open);
    const legEnd = num(legCandles[legCandles.length - 1]?.candle_close);
    const legHigh = Math.max(...legCandles.map((c: any) => num(c.candle_high)).filter(Number.isFinite));
    const legLow = Math.min(...legCandles.map((c: any) => num(c.candle_low)).filter(Number.isFinite));
    const legMove = legEnd - legStart;
    const legAbs = Math.abs(legMove);
    const legRange = legHigh - legLow;
    const legEfficiency = legRange > 0 ? legAbs / legRange : 0;

    const trendDir: "alta" | "baixa" | null = legMove > 0 ? "alta" : legMove < 0 ? "baixa" : null;
    const side: "buy" | "sell" | undefined =
      trendDir === "alta" ? "buy" : trendDir === "baixa" ? "sell" : undefined;

    const minLegPts = Number((cfg as any).pullback_min_leg_pts ?? stopPtsCfg * 1.5);
    const minLegEff = Number((cfg as any).pullback_min_leg_efficiency ?? 0.5);

    // Extremo do recuo: fundo do repique na alta, topo na baixa.
    const pbLow = Math.min(...pbCandles.map((c: any) => num(c.candle_low)).filter(Number.isFinite));
    const pbHigh = Math.max(...pbCandles.map((c: any) => num(c.candle_high)).filter(Number.isFinite));
    const pbExtreme = trendDir === "alta" ? pbLow : pbHigh;
    const retrPts = trendDir === "alta" ? legEnd - pbLow : pbHigh - legEnd;
    const retrRatio = legAbs > 0 ? retrPts / legAbs : 0;
    const minRetr = Number((cfg as any).pullback_min_retracement ?? 0.2);
    const maxRetr = Number((cfg as any).pullback_max_retracement ?? 0.7);
    // Não pode romper o início da perna — aí não é repique, é reversão.
    const keptLegOrigin = trendDir === "alta" ? pbLow > legStart : pbHigh < legStart;

    const rOpen = num(resume?.candle_open);
    const rClose = num(resume?.candle_close);
    const lastPbHigh = num(pbCandles[pbCandles.length - 1]?.candle_high);
    const lastPbLow = num(pbCandles[pbCandles.length - 1]?.candle_low);
    // Retomada: corpo do minuto a favor E fechando além do candle final do recuo.
    const bodyWithTrend = trendDir === "alta" ? rClose > rOpen : rClose < rOpen;
    const brokeResumeLevel = trendDir === "alta" ? rClose > lastPbHigh : rClose < lastPbLow;

    // Níveis dinâmicos: stop além do extremo do recuo, alvo na proporção da perna.
    const folga = Math.max(tick * 2, stopPtsCfg * 0.1);
    const stopDyn = Math.max(tick * 2, Math.round(Math.abs(price - pbExtreme) + folga));
    const targetRatio = Number((cfg as any).pullback_target_leg_ratio ?? 1.0);
    const gainDyn = Math.max(tick * 2, Math.round(legAbs * targetRatio));
    const rr = stopDyn > 0 ? gainDyn / stopDyn : 0;

    const details: Record<string, any> = {
      entry_style: "pullback",
      lookback_candles: lookback, pullback_candles: pbCandles.length, leg_candles: legCandles.length,
      tendencia_da_perna: trendDir, perna_inicio: legStart, perna_fim: legEnd,
      perna_pts: Number(legAbs.toFixed(1)), perna_min_pts: minLegPts,
      perna_eficiencia: Number(legEfficiency.toFixed(3)), perna_min_eficiencia: minLegEff,
      recuo_extremo: pbExtreme, recuo_pts: Number(retrPts.toFixed(1)),
      recuo_fracao: Number(retrRatio.toFixed(3)), recuo_min: minRetr, recuo_max: maxRetr,
      manteve_origem_da_perna: keptLegOrigin,
      retomada_open: rOpen, retomada_close: rClose,
      retomada_corpo_a_favor: bodyWithTrend, retomada_rompeu_ultimo_candle_do_recuo: brokeResumeLevel,
      price, volatility_pct: vol,
      stop_dinamico_pts: stopDyn, alvo_dinamico_pts: gainDyn, "r:r": Number(rr.toFixed(2)),
    };

    const hardBlock: string[] = [];
    if (!trendDir) hardBlock.push("perna anterior sem direção (deslocamento zero)");
    if (legAbs < minLegPts) hardBlock.push(`perna anterior curta demais (${legAbs.toFixed(0)} pts < mínimo ${minLegPts.toFixed(0)} pts)`);
    if (legEfficiency < minLegEff) hardBlock.push(`tendência não confirmada antes do recuo (eficiência ${(legEfficiency * 100).toFixed(0)}% < mínimo ${(minLegEff * 100).toFixed(0)}%)`);
    if (retrRatio < minRetr) hardBlock.push(`recuo insuficiente (${(retrRatio * 100).toFixed(0)}% < mínimo ${(minRetr * 100).toFixed(0)}% da perna)`);
    if (retrRatio > maxRetr) hardBlock.push(`recuo profundo demais (${(retrRatio * 100).toFixed(0)}% > máximo ${(maxRetr * 100).toFixed(0)}% da perna)`);
    if (!keptLegOrigin) hardBlock.push("recuo rompeu o início da perna — não é repique, é reversão");
    if (!bodyWithTrend) hardBlock.push(`minuto de retomada sem corpo a favor da tendência (${rOpen.toFixed(1)}→${rClose.toFixed(1)})`);

    const soft: { label: string; pass: boolean }[] = [
      { label: `retomada não superou o último candle do recuo (${rClose.toFixed(1)})`, pass: brokeResumeLevel },
      { label: `recuo fora da faixa nobre (30%–60% da perna: ${(retrRatio * 100).toFixed(0)}%)`,
        pass: retrRatio >= 0.3 && retrRatio <= 0.6 },
      { label: `risco-retorno abaixo de 1,2 (${rr.toFixed(2)})`, pass: rr >= 1.2 },
      { label: `preço corrente já longe do gatilho da retomada`,
        pass: trendDir === "alta" ? price >= rClose - stopDyn * 0.5 : price <= rClose + stopDyn * 0.5 },
    ];
    const failedSoft = soft.filter((s) => !s.pass).map((s) => s.label);
    const minHits = Number((cfg as any).pullback_min_soft_hits ?? 3);
    const hits = soft.length - failedSoft.length;
    const softOk = hits >= minHits;
    Object.assign(details, { soft_hits: hits, soft_total: soft.length, soft_min_hits: minHits, soft_failed: failedSoft });

    if (hardBlock.length === 0 && softOk) {
      return {
        name: "trend_pullback", ok: true, reasons: [], details,
        side_override: side, stop_pts_override: stopDyn, gain_pts_override: gainDyn,
      };
    }
    return {
      name: "no_valid_setup", ok: false,
      reasons: [...hardBlock, ...(softOk ? [] : failedSoft)],
      details,
      side_override: side,
      stop_pts_override: hardBlock.length === 0 ? stopDyn : null,
      gain_pts_override: hardBlock.length === 0 ? gainDyn : null,
    };
  }


  // ── SÉTIMA MODALIDADE: `vwap` (29/08/2026) ────────────────────────────────
  // Reversão à média com REFERÊNCIA diferente: não a média móvel, mas o preço
  // médio ponderado por volume, que é o que a mesa institucional olha. A coluna
  // `vwap` já vem no snapshot desde o início; aqui só se lê.
  //
  // A entrada é o RETORNO ao VWAP, não o afastamento: exige afastamento além do
  // limiar em algum ponto da janela recente E aproximação em curso agora.
  // Lado derivado pelo classificador: acima do VWAP é venda, abaixo é compra.
  function classifySetupVwap(params: {
    ctxLocal: any; cfg: any; m1Candles: any[];
  }): {
    name: B3SetupName; ok: boolean; reasons: string[]; details: Record<string, any>;
    side_override?: "buy" | "sell";
    stop_pts_override?: number | null; gain_pts_override?: number | null;
  } {
    const { ctxLocal, cfg, m1Candles } = params;
    const price = Number(ctxLocal.price);
    const vwap = Number(ctxLocal.vwap);
    const stopPtsCfg = Math.max(1, Number(cfg.stop_pts) || 0);
    const tick = Math.max(Number(asset?.tick_size ?? 1), 0.01);
    const vol = Number(ctxLocal.volatility_pct ?? 0);

    if (!Number.isFinite(vwap) || vwap <= 0) {
      return {
        name: "no_valid_setup", ok: false,
        reasons: ["VWAP indisponível no snapshot"],
        details: { entry_style: "vwap", vwap: ctxLocal.vwap },
      };
    }

    const sorted = (m1Candles ?? []).slice()
      .sort((a: any, b: any) => new Date(a.minute_ts).getTime() - new Date(b.minute_ts).getTime());
    if (sorted.length < 10) {
      return {
        name: "no_valid_setup", ok: false,
        reasons: ["aguardando candles de 1 minuto (mínimo 10)"],
        details: { m1_candles: sorted.length, entry_style: "vwap" },
      };
    }

    const dayHigh = Math.max(...sorted.map((c: any) => Number(c.candle_high)).filter(Number.isFinite));
    const dayLow = Math.min(...sorted.map((c: any) => Number(c.candle_low)).filter(Number.isFinite));
    const dayRange = dayHigh - dayLow;

    const dist = price - vwap;
    const distAbs = Math.abs(dist);
    const side: "buy" | "sell" | undefined = dist > 0 ? "sell" : dist < 0 ? "buy" : undefined;

    // Limiar do afastamento: o maior entre uma fração do stop e uma fração da
    // amplitude do dia (em ativo parado o stop manda; em dia amplo, a amplitude).
    //
    // 05/09/2026 — os DOIS multiplicadores agora são colunas por ativo em
    // `b3_asset_profiles` (`vwap_min_distance_stop_ratio`,
    // `vwap_min_distance_range_ratio`). Precedência: config do modo (se
    // existir) → coluna do ativo → padrão histórico (0,8 e 0,25). Como as
    // colunas nascem com o padrão histórico, esta entrega não muda nada;
    // é só o botão ficando acessível.
    const stopRatioCfg = Number(asset?.vwap_min_distance_stop_ratio);
    const stopRatio = Number.isFinite(stopRatioCfg) && stopRatioCfg > 0 ? stopRatioCfg : 0.8;
    const rangeRatioAsset = Number(asset?.vwap_min_distance_range_ratio);
    const minByStop = Number((cfg as any).vwap_min_distance_pts ?? stopPtsCfg * stopRatio);
    const rangeRatio = Number((cfg as any).vwap_min_distance_range_ratio
      ?? (Number.isFinite(rangeRatioAsset) && rangeRatioAsset > 0 ? rangeRatioAsset : 0.25));
    const threshold = Math.max(minByStop, dayRange * rangeRatio);


    // Afastamento máximo recente do MESMO lado em que o preço está agora.
    const win = Math.max(3, Math.min(30, Number((cfg as any).vwap_lookback_candles ?? 10)));
    const recent = sorted.slice(-win);
    const extremeAbove = Math.max(...recent.map((c: any) => Number(c.candle_high)).filter(Number.isFinite));
    const extremeBelow = Math.min(...recent.map((c: any) => Number(c.candle_low)).filter(Number.isFinite));
    const extreme = side === "sell" ? extremeAbove : extremeBelow;
    const maxDistAbs = Math.abs(extreme - vwap);

    // Voltando: a distância atual já é uma fração da máxima do afastamento.
    const returnRatio = Number((cfg as any).vwap_return_ratio ?? 0.7);
    const returning = maxDistAbs > 0 && distAbs <= maxDistAbs * returnRatio;
    // …mas ainda com espaço até o VWAP para valer como alvo.
    const minRoomRatio = Number((cfg as any).vwap_min_room_ratio ?? 0.25);
    const hasRoom = distAbs >= Math.max(tick * 2, threshold * minRoomRatio);

    // Níveis: alvo no próprio VWAP; stop além do extremo do afastamento.
    const folga = Math.max(tick * 2, stopPtsCfg * 0.1);
    const gainDyn = Math.max(tick * 2, Math.round(distAbs));
    const stopDyn = Math.max(tick * 2, Math.round(Math.abs(extreme - price) + folga));
    const rr = stopDyn > 0 ? gainDyn / stopDyn : 0;

    const details: Record<string, any> = {
      entry_style: "vwap",
      vwap, price, dist_vwap_pts: Number(dist.toFixed(1)),
      lado_derivado: side, amplitude_dia_pts: Number(dayRange.toFixed(1)),
      limiar_afastamento_pts: Number(threshold.toFixed(1)),
      limiar_por_stop_pts: Number(minByStop.toFixed(1)), limiar_fracao_da_amplitude: rangeRatio,
      limiar_multiplicador_do_stop: stopRatio,
      limiar_fonte: "b3_asset_profiles.vwap_min_distance_stop_ratio / _range_ratio",

      lookback_candles: recent.length,
      extremo_do_afastamento: extreme, afastamento_maximo_pts: Number(maxDistAbs.toFixed(1)),
      voltando_ao_vwap: returning, fracao_de_retorno_max: returnRatio,
      espaco_ate_o_vwap_ok: hasRoom, volatility_pct: vol,
      stop_dinamico_pts: stopDyn, alvo_dinamico_pts: gainDyn, "r:r": Number(rr.toFixed(2)),
    };

    const hardBlock: string[] = [];
    if (!side) hardBlock.push("preço exatamente no VWAP — sem afastamento a reverter");
    if (maxDistAbs < threshold) hardBlock.push(`afastamento do VWAP insuficiente (máx ${maxDistAbs.toFixed(1)} pts < limiar ${threshold.toFixed(1)} pts)`);
    if (!returning) hardBlock.push(`ainda se afastando do VWAP (atual ${distAbs.toFixed(1)} pts de máx ${maxDistAbs.toFixed(1)} pts; exigido ≤ ${(maxDistAbs * returnRatio).toFixed(1)})`);
    if (!hasRoom) hardBlock.push(`sem espaço até o VWAP para servir de alvo (${distAbs.toFixed(1)} pts)`);

    const soft: { label: string; pass: boolean }[] = [
      { label: `risco-retorno abaixo de 1,0 (${rr.toFixed(2)})`, pass: rr >= 1.0 },
      { label: `retorno ao VWAP ainda incipiente (${(distAbs / (maxDistAbs || 1) * 100).toFixed(0)}% do afastamento)`,
        pass: maxDistAbs > 0 && distAbs <= maxDistAbs * 0.85 },
      { label: `último minuto sem fechar na direção do VWAP`,
        pass: (() => {
          const last: any = sorted[sorted.length - 1];
          const o = Number(last?.candle_open); const c = Number(last?.candle_close);
          if (!Number.isFinite(o) || !Number.isFinite(c)) return false;
          return side === "sell" ? c < o : c > o;
        })() },
    ];
    const failedSoft = soft.filter((s) => !s.pass).map((s) => s.label);
    const minHits = Number((cfg as any).vwap_min_soft_hits ?? 2);
    const hits = soft.length - failedSoft.length;
    const softOk = hits >= minHits;
    Object.assign(details, { soft_hits: hits, soft_total: soft.length, soft_min_hits: minHits, soft_failed: failedSoft });

    if (hardBlock.length === 0 && softOk) {
      return {
        name: "vwap_reversion", ok: true, reasons: [], details,
        side_override: side, stop_pts_override: stopDyn, gain_pts_override: gainDyn,
      };
    }
    return {
      name: "no_valid_setup", ok: false,
      reasons: [...hardBlock, ...(softOk ? [] : failedSoft)],
      details,
      side_override: side,
      stop_pts_override: hardBlock.length === 0 ? stopDyn : null,
      gain_pts_override: hardBlock.length === 0 ? gainDyn : null,
    };
  }


  // Mapa entry_style → classificador. Acrescentar modalidade nova = uma linha
  // aqui, sem tocar no ponto de chamada dentro do laço de modos.
  type SetupClassifierArgs = {
    ctxLocal: any; derived: any; intendedSide: "buy" | "sell"; cfg: any; m1Candles: any[];
  };
  // side_override: classificadores que derivam o próprio lado (mean_reversion,
  // range, rompimento) escolhem o lado a partir do esticão/borda/rompimento; o
  // motor usa esse lado no lugar do intendedSide (que é cruzamento de médias,
  // ou seja, seguidor de tendência).
  // stop_pts_override/gain_pts_override: níveis dinâmicos devolvidos pelo
  // classificador (rompimento = frações da altura do canal). Quando presentes,
  // são gravados na ordem e a gestão de posição os usa no lugar dos fixos.
  type SetupResult = {
    name: B3SetupName; ok: boolean; reasons: string[]; details: Record<string, any>;
    side_override?: "buy" | "sell";
    stop_pts_override?: number | null;
    gain_pts_override?: number | null;
  };
  const SETUP_CLASSIFIERS: Record<string, (a: SetupClassifierArgs) => SetupResult> = {
    indicador: ({ ctxLocal, derived, intendedSide, cfg }) => classifySetup({ ctxLocal, derived, intendedSide, cfg }),
    price_action: ({ ctxLocal, intendedSide, cfg, m1Candles }) => classifySetupPriceAction({ ctxLocal, intendedSide, cfg, m1Candles }),
    mean_reversion: ({ ctxLocal, cfg, m1Candles }) => classifySetupMeanReversion({ ctxLocal, cfg, m1Candles }),
    range: ({ ctxLocal, cfg, m1Candles }) => classifySetupRange({ ctxLocal, cfg, m1Candles }),
    rompimento: ({ ctxLocal, cfg, m1Candles }) => classifySetupBreakout({ ctxLocal, cfg, m1Candles }),
    pullback: ({ ctxLocal, cfg, m1Candles }) => classifySetupPullback({ ctxLocal, cfg, m1Candles }),
    vwap: ({ ctxLocal, cfg, m1Candles }) => classifySetupVwap({ ctxLocal, cfg, m1Candles }),
  };
  function classifySetupFor(entryStyle: string | null | undefined, args: SetupClassifierArgs): SetupResult {
    const style = String(entryStyle ?? "indicador");
    const fn = SETUP_CLASSIFIERS[style];
    if (!fn) {
      // Falha fechada: modalidade não cadastrada não vira cópia do indicador.
      return {
        name: "no_valid_setup", ok: false,
        reasons: [`modalidade de entrada não cadastrada no motor: ${style}`],
        details: { entry_style: style, known_styles: Object.keys(SETUP_CLASSIFIERS) },
      };
    }
    return fn(args);
  }



  function buildDecisionContext(params: {
    ctxLocal: any; priceLocal: any; cfg: any; mode: string; intendedSide: string;
    decision: any | null; derived: any; firstStop?: any;
    entry_reason?: string | null;
    setup?: { name: string; ok: boolean; reasons: string[]; details: Record<string, any> } | null;
  }) {
    const { ctxLocal, priceLocal, cfg, mode, intendedSide, decision, derived, firstStop, entry_reason, setup } = params;
    const trend = classifyTrend(ctxLocal, Number(asset?.trend_strength_factor ?? 5));
    return {
      timestamp: new Date().toISOString(),
      asset: priceLocal.quote_symbol ?? "WINQ26",
      robot: mode,
      suggested_side: intendedSide,
      price: ctxLocal.price,
      score: decision?.score ?? null,
      score_min: Number(cfg.min_score),
      confidence: decision?.avg_confidence ?? null,
      confidence_min: Number(cfg.min_confidence),
      approve_votes: decision?.approve_votes ?? null,
      approve_votes_min: Number(cfg.min_approve_votes),
      total_votes: decision?.total_votes ?? null,
      vetoes: decision?.vetoes ?? [],
      committee_result: decision?.final ?? null,
      committee_justification: decision?.justification ?? null,
      score_composition: decision?.composition ?? null,
      agent_votes: decision?.agent_votes ?? [],
      approval_or_first_block:
        decision?.final === "approved"
          ? `Aprovado: ${decision.justification ?? ""}`
          : firstStop ? `Bloqueado em ${firstStop.label}: ${firstStop.detail ?? ""}` : (decision?.justification ?? null),
      entry_reason: entry_reason ?? null,
      trend_direction: trend.direction,
      trend_strength: trend.strength,
      volatility_pct: ctxLocal.volatility_pct,
      spread_pts: Number(ctxLocal.spread_pts ?? priceLocal.raw?.spread ?? 0),
      vwap: ctxLocal.vwap,
      dist_vwap_pts: Math.round(ctxLocal.price - ctxLocal.vwap),
      day_high: derived.day_high,
      day_low: derived.day_low,
      dist_day_high_pts: derived.dist_day_high_pts,
      dist_day_low_pts: derived.dist_day_low_pts,
      volume_current: ctxLocal.volume_ratio,
      volume_avg: derived.avg_volume,
      acceleration_pts_per_min: derived.acceleration_pts_per_min,
      candle: {
        open: ctxLocal.open, high: ctxLocal.high, low: ctxLocal.low, close: ctxLocal.price,
      },
      var_1m_pts: derived.var_1m_pts,
      var_3m_pts: derived.var_3m_pts,
      var_5m_pts: derived.var_5m_pts,
      market_regime: classifyRegime(ctxLocal, derived),
      session_phase: ctxLocal.session_phase,
      setup: setup ? {
        name: setup.name,
        ok: setup.ok,
        reasons: setup.reasons,
        details: setup.details,
      } : null,
    };
  }


  for (let i = 0; i < ticks; i++) {
    const now = new Date();
    const cur = saoPauloMinutes(now);

    const priceSrc = await B3QuoteProvider(supabase, userId, {
      symbol: asset.quote_symbol, contract: asset.contract_code, base: Number(asset.base_price_fallback),
      expectedSymbol: asset.symbol, tickSize: Number(asset.tick_size),
      spreadMaxPoints: Number(asset.spread_max_price), priceDeviationLimit: Number(asset.price_deviation_limit),
      indicatorTimeframe: asset.indicator_timeframe === "m1" ? "m1" : "tick",
    });
    rememberProvider(priceSrc);
    const ctx = priceSrc.ctx;
    const marketHistory = await fetchMarketHistory();
    const m1Candles = await fetchM1Candles();

    const derived = deriveMarketMetrics(marketHistory, ctx, priceSrc);

    const invalidMt5 = mt5InvalidReason(priceSrc);

    // Dedup: se o tick é exatamente o mesmo já processado e não há posição
    // aberta para gerenciar, nada muda — evita gravações e leituras repetidas.
    const tickTs = priceSrc.raw?.tick_ts ?? null;
    const sameTick = Boolean(tickTs && memo.quote_tick_ts
      && new Date(tickTs).getTime() === new Date(memo.quote_tick_ts).getTime());

    if (sameTick && ((await getOpen()) ?? []).length === 0) {
      log.push({ action: "tick_dedup", reason: "quote_tick_ts repetido", tick_ts: tickTs });
      continue;
    }

    await invalidateLegacyOrdersForMt5(priceSrc);
    const macroBlock = (macros ?? []).find((m: any) => {
      const a = new Date(m.block_start).getTime();
      const b = new Date(m.block_end).getTime();
      return now.getTime() >= a && now.getTime() <= b;
    });

    const globalProtectionActive = Boolean(invalidMt5 || macroBlock);
    const globalProtectionReason = invalidMt5
      ? invalidMt5
      : macroBlock
      ? `Evento macro ativo: ${macroBlock.name}`
      : "Inativa";
    const snapshotExtra: any = { ema9: ctx.ema9, ema21: ctx.ema21, rsi: ctx.rsi, macd: ctx.macd, macd_signal: ctx.macd_signal,
      momentum: ctx.momentum, volatility_pct: ctx.volatility_pct, session_phase: ctx.session_phase,
      // Telemetria de tendência do tick (para calibrar lateral_strength_min / lateral_vol_min).
      trend_direction: classifyTrend(ctx, Number(asset?.trend_strength_factor ?? 5)).direction,
      trend_strength: classifyTrend(ctx, Number(asset?.trend_strength_factor ?? 5)).strength,
      volatility: Number(ctx.volatility_pct ?? 0),
      m1_candles: m1Candles.length,
      price_source: priceSrc.source, quote_age_s: priceSrc.quote_age_s, quote_symbol: priceSrc.quote_symbol,

      bid: priceSrc.raw?.bid, ask: priceSrc.raw?.ask, last: priceSrc.raw?.last,
      provider_name: priceSrc.provider_name, fallback_to_csv: priceSrc.fallback_to_csv,
      mt5_provider_calls: providerStats.mt5_provider_calls, legacy_provider_calls: providerStats.legacy_provider_calls,
      global_protection: { active: globalProtectionActive, reason: globalProtectionReason },
      // ESTADO DO MOTOR SAIU DO SNAPSHOT (05/09/2026)
      // `tick_guard` inteiro (rótulos e mensagens por extenso, ~1.970 bytes por
      // linha) vive agora em b3_engine_state, uma linha por execução, ATUALIZADA.
      // No snapshot fica só o veredito, que é o que os contadores usam.
      guard_ok: priceSrc.guard_evaluation ? priceSrc.guard_evaluation.ok !== false : true,
      guard_block_reason: priceSrc.guard_evaluation?.first_block_reason ?? null,
    };
    const tickGuardFull = priceSrc.guard_evaluation ? {
      mode: priceSrc.guard.mode,
      ok: priceSrc.guard_evaluation.ok,
      first_block_reason: priceSrc.guard_evaluation.first_block_reason,
      settings: priceSrc.guard_evaluation.settings,
      spread_pts: priceSrc.guard_evaluation.spread_pts,
      spread_ticks: priceSrc.guard_evaluation.spread_ticks,
      tick_age_s: priceSrc.guard_evaluation.tick_age_s,
      checks: priceSrc.guard_evaluation.checks,
    } : null;

    const snapPayload: any = {
      symbol: asset.quote_symbol,
      price: ctx.price, candle_open: ctx.open, candle_high: ctx.high, candle_low: ctx.low,
      candle_close: ctx.price, volume: ctx.volume_ratio, vwap: ctx.vwap,
      market_time: now.toISOString(),
      source: priceSrc.live ? `mt5:${priceSrc.server ?? "xp"}` : (priceSrc.source === "mt5_xp_demo" ? "mt5:sem_tick" : "mock"),
      quote_source: priceSrc.quote_source,
      quote_server: priceSrc.server,
      quote_symbol: priceSrc.quote_symbol,
      quote_tick_ts: tickTs,
      quote_bid: priceSrc.raw?.bid ?? null,
      quote_ask: priceSrc.raw?.ask ?? null,
      quote_last: priceSrc.raw?.last ?? null,
      provider_name: priceSrc.provider_name,
    };
    // Hard throttle: nenhuma gravação intermediária aqui. O snapshot só é
    // persistido (1 INSERT) no fim do tick, e no máximo 1x a cada 10s.
    // Entre as persistências, preço e cotação ficam apenas em memória.
    const persistSnapshot = (now.getTime() - memo.persisted_at) >= SNAP_PERSIST_MS;
    memo.quote_tick_ts = tickTs;
    memo.last_price = ctx.price;
    memo.last_quote = { bid: priceSrc.raw?.bid ?? null, ask: priceSrc.raw?.ask ?? null, last: priceSrc.raw?.last ?? null, tick_ts: tickTs };
    const snapId: string | null = persistSnapshot ? null : memo.id;




    const intendedSide: B3Side = ctx.ema9 >= ctx.ema21 ? "buy" : "sell";
    auditEvents = [];
    const tickAudit: any = {
      snapshot_id: snapId,
      tick_index: i + 1,
      timestamp: now.toISOString(),
      source: priceSrc.source,
      provider_name: priceSrc.provider_name,
      last_tick: {
        bid: priceSrc.raw?.bid ?? null,
        ask: priceSrc.raw?.ask ?? null,
        last: priceSrc.raw?.last ?? null,
        spread: priceSrc.raw?.spread ?? ctx.spread_pts ?? null,
        tick_ts: priceSrc.raw?.tick_ts ?? null,
        age_s: priceSrc.quote_age_s,
        server: priceSrc.server,
        symbol: priceSrc.quote_symbol,
      },
      global_protection: {
        status: globalProtectionActive ? "Ativa" : "Inativa",
        active: globalProtectionActive,
        reason: globalProtectionReason,
      },
      tick_guard: tickGuardFull,
      modes: [] as any[],
    };

    // Quote-stall é um gate de ENTRADA. A existência de posição é registrada por
    // modo dentro do laço; nunca pode transformar este estado em gate global.
    const preOpenList = await getOpen();
    const quoteAgeS = Number(priceSrc.quote_age_s ?? 0);
    const anyOpenPre = (preOpenList ?? []).length > 0;
    tickAudit.quote_stall = {
      active: quoteAgeS > 10,
      duration_s: quoteAgeS,
      any_position_open: anyOpenPre,
      threshold_s: 10,
    };
    if (sigChanged("audit_quote_stall", String(quoteAgeS > 10))) {
      markAuditEvent(`quote_stall:${quoteAgeS > 10 ? "ativo" : "normal"}`);
    }


    // ───────── STOP PENDENTE NÃO EXECUTADO (somente observação) ─────────
    // Não fecha nada, não altera limiar, entrada, saída nem trailing: apenas
    // detecta que o nível de stop já foi atravessado e o tick terminou sem
    // execução, registra o evento e escala a severidade pelo tempo parado.
    const pendingStopSeen = new Set<string>();
    async function recordPendingStopIfCrossed(
      mode: string, m: any, open: any, cfg: any, blockReason: string,
    ) {
      try {
        if (!open || !cfg || pendingStopSeen.has(open.id)) return;
        pendingStopSeen.add(open.id);
        const dir = open.side === "buy" ? 1 : -1;
        // Níveis por ordem: rompimento grava stop_pts próprio na ordem; as
        // demais modalidades caem na configuração do modo.
        const stopPts = Number(open.stop_pts ?? cfg.stop_pts ?? 0);
        if (!(stopPts > 0)) return;
        const entryPrice = Number(open.entry_price);
        if (!Number.isFinite(entryPrice)) return;
        const stopLevel = entryPrice - dir * stopPts;
        const entryMs = open.entry_time ? new Date(open.entry_time).getTime() : 0;

        // Pior preço adverso já observado: tick corrente + extremos dos candles M1 desde a entrada.
        let worst = Number(priceSrc.raw?.last ?? ctx.price);
        let crossedAtMs: number | null = null;
        for (const c of m1Candles ?? []) {
          const t = new Date(c.minute_ts).getTime();
          if (!(t >= entryMs)) continue;
          const ext = dir === 1 ? Number(c.candle_low) : Number(c.candle_high);
          if (!Number.isFinite(ext)) continue;
          if (dir === 1 ? ext < worst : ext > worst) worst = ext;
          const touched = dir === 1 ? ext <= stopLevel : ext >= stopLevel;
          if (touched && crossedAtMs == null) crossedAtMs = t;
        }
        const beyondPts = (stopLevel - worst) * dir;
        if (!(beyondPts > 0)) return;

        const nowPendMs = Date.now();
        const { data: prevEvents } = await (supabase as any).from("b3_simulation_block_events")
          .select("id, created_at")
          .eq("user_id", userId).eq("related_order_id", open.id)
          .eq("trigger", "stop_pendente_nao_executado")
          .order("created_at", { ascending: true });
        const list: any[] = prevEvents ?? [];
        const firstMs = list.length ? new Date(list[0].created_at).getTime() : (crossedAtMs ?? nowPendMs);
        const lastMs = list.length ? new Date(list[list.length - 1].created_at).getTime() : 0;
        const elapsedS = Math.max(0, Math.round((nowPendMs - firstMs) / 1000));
        const attempts = list.length + 1;
        const nivel = elapsedS > 300 ? "CRÍTICO" : elapsedS > 60 ? "GRAVE" : "AVISO";
        const severity = elapsedS > 300 ? "critical" : elapsedS > 60 ? "error" : "warning";
        const message = `Stop atravessado em ${beyondPts.toFixed(0)} pts há ${elapsedS}s sem execução — motivo: ${blockReason} [${nivel}, ${attempts} tentativa(s)]`;

        // Agrupamento anti-enxurrada: no máximo 1 registro por minuto por ordem.
        if (lastMs && nowPendMs - lastMs < 60_000) return;

        markAuditEvent(`stop_pendente:${mode}`);
        await (supabase as any).from("b3_simulation_block_events").insert({
          simulation_run_id: runId, simulation_mode_id: m.id, user_id: userId, mode,
          prev_status: m.current_status ?? null, new_status: m.current_status ?? null,
          trigger: "stop_pendente_nao_executado",
          observed_value: beyondPts, limit_value: stopPts,
          related_order_id: open.id, message,
          provider_name: priceSrc.provider_name ?? null,
          price_source: priceSrc.quote_source ?? null,
          mt5_last: Number(priceSrc.raw?.last ?? ctx.price) || null,
          diagnostic_payload: {
            severidade: nivel, elapsed_s: elapsedS, attempts, block_reason: blockReason,
            stop_level: stopLevel, worst_price: worst, entry_price: entryPrice, side: open.side,
            quote_age_s: Number(priceSrc.quote_age_s ?? 0), symbol: asset.symbol,
          },
        });
        await supabase.from("system_logs").insert({
          event_type: "stop_pendente_nao_executado",
          source: `b3:${asset.symbol}:${mode}`,
          message, severity,
          technical_data: {
            order_id: open.id, run_id: runId, mode, symbol: asset.symbol,
            beyond_pts: beyondPts, stop_pts: stopPts, elapsed_s: elapsedS,
            attempts, block_reason: blockReason,
          } as any,
        });
      } catch { /* observação nunca derruba o motor */ }
    }

    // Freio de grupo reavaliado ANTES do laço de modos: o nível vale para o
    // tique inteiro e inclui a posição aberta marcada a mercado.
    let grupo: B3GrupoDecision | null = null;
    try {
      grupo = await evaluateGrupo(Number(ctx.price) || null, priceSrc, ctx);
    } catch (e: any) {
      log.push({ action: "grupo_erro", error: String(e?.message ?? e) });
    }
    const grupoNivel = grupo?.nivel ?? 0;
    const grupoMultiplicador = grupo?.multiplicador ?? 1;
    const grupoTravados: string[] = grupo?.robos_travados ?? [];

    // ── LIBERAÇÃO MANUAL DE FREIO PARA O REAL (16/09/2026) ──
    // Uma leitura por tique, antes do laço de modos. Não muda decisão nem
    // simulado: só diz quais freios deixam de barrar o ESPELHO, por robô ou
    // pelo grupo inteiro. Falha aqui = nenhuma liberação (falha FECHADA).
    let liberacoesFreio: import("./b3-liberacao-freio.server").Liberacao[] = [];
    try {
      const { listLiberacoesAtivas } = await import("./b3-liberacao-freio.server");
      liberacoesFreio = await listLiberacoesAtivas(supabase, userId);
    } catch { liberacoesFreio = []; }
    const { freioLiberado } = await import("./b3-liberacao-freio.server");
    const freioEstaLiberado = (mode: string, freio: string) =>
      liberacoesFreio.length > 0 &&
      !!freioLiberado(liberacoesFreio, rootSymbol(asset.quote_symbol), runVariant, mode, freio);


    // Timings por modo + isolamento de falha: um modo que estoura não pode
    // derrubar os modos seguintes nem impedir a gravação do snapshot.
    const modeTimings: Record<string, number> = {};
    // Instrumentação: ids dos últimos votos gravados por modo, para vincular
    // a ordem criada no mesmo tique (order_id). Não afeta decisões.
    const lastVoteIdsByMode: Record<string, string[]> = {};

    // Diagnóstico de recusa de entrada, por robô (gravação, não decisão).
    // Uma linha só quando o MOTIVO MUDA em relação à última avaliação daquele
    // robô — 250 robôs por minuto tornariam a gravação por avaliação (≈100 mil
    // linhas/pregão) mais caro que o próprio tique.
    const entryStageRows: any[] = [];

    // Zeragem/fechamento de pregão em qualquer robô: a consolidação da sombra
    // do dia é forçada no fim da passada, para não perder o último trecho.
    let zeragemNoTique = false;

    const runT0 = Date.now();

    for (const mode of activeModes) {
      const modeT0 = Date.now();
      try {
      const m = modeByName[mode];
      if (!m) {
        // Modo habilitado no banco que o motor não conseguiu processar.
        // Silêncio aqui foi o defeito que escondeu 210 robôs parados.
        entryStageRows.push({
          user_id: userId, simulation_run_id: runId, symbol: asset.symbol,
          variant: runVariant, mode, stage: "motor",
          reason: "modo_habilitado_sem_carteira",
          detail: "Modo habilitado em b3_simulation_mode_settings sem linha em b3_simulation_modes",
        });
        try {
          await (supabase as any).from("system_logs").insert({
            event_type: "b3_modo_nao_processado",
            source: "b3-simulation-tick",
            severity: "error",
            message: `Modo ${mode} habilitado não pôde ser processado (sem carteira) em ${asset.symbol}/${runVariant}`,
            technical_data: { run_id: runId, mode, symbol: asset.symbol, variant: runVariant },
          });
        } catch { /* log nunca derruba o tique */ }
        continue;
      }
      const cfg = settingsByMode[mode];
      const realizedToday = Number(realizedTodayByMode[mode] ?? 0);
      const startMin = hhmmToMin(cfg.trading_start_time);
      const cutoffMin = hhmmToMin(cfg.entry_cutoff_time);
      const forceMin = hhmmToMin(cfg.force_close_time);
      const insideHours = cur >= startMin && cur <= cutoffMin;
      const forceClose = cur >= forceMin || cur < startMin;
      // Antes da abertura o motor também "força fechamento" (não há nada aberto),
      // mas o rótulo de zeragem é enganoso — este estado é só pré-abertura.
      const beforeOpen = cur < startMin;
      // Fim de pregão: obriga a consolidação final da sombra do dia.
      if (forceClose && !beforeOpen) zeragemNoTique = true;

      const openList = await getOpen();
      const open = (openList ?? []).find((o: any) => o.simulation_mode_id === m.id);
      const openMarkPriceForProtection = liveExitMarkPrice(open, priceSrc, ctx);
      const openMtmBrlForProtection = markOpenOrderBrl(open, openMarkPriceForProtection);
      const markedTodayForProtection = realizedToday + (openMtmBrlForProtection ?? 0);

      const loadedConfig = normalizeModeConfig(cfg);
      const cfgCompare = configComparison(cfg, loadedConfig);
      const checks: any[] = [];
      const addCheck = (key: string, label: string, ok: boolean, detail?: string, blocking = true) => checks.push(auditCheck(key, label, ok, detail, blocking));
      const finalizeAudit = (finalReason: string, extra: Record<string, any> = {}) => {
        const firstStop = checks.find((c) => c.blocking && !c.ok);
        // Veredito do comitê diferente do tique anterior daquele modo → auditoria completa.
        const verdict = extra.committee
          ? String((extra.committee as any).final ?? "")
          : `sem_comite:${firstStop?.key ?? "ok"}`;
        if (sigChanged(`audit_verdict:${mode}`, verdict)) {
          markAuditEvent(`veredito:${mode}:${verdict}`);
        }
        const decisionContext = buildDecisionContext({
          ctxLocal: ctx, priceLocal: priceSrc, cfg, mode, intendedSide,
          decision: extra.committee ?? null, derived, firstStop,
          entry_reason: extra.entry_reason ?? null,
          setup: extra.setup ?? null,
        });
        tickAudit.modes.push({
          mode,
          timestamp: now.toISOString(),
          last_tick: tickAudit.last_tick,
          last_analysis: extra.last_analysis ?? null,
          last_score: extra.last_score ?? null,
          last_confidence: extra.last_confidence ?? null,
          last_setup: extra.last_setup ?? "Nenhum setup aprovado",
          last_refusal_reason: finalReason,
          first_stop: firstStop ? { key: firstStop.key, label: firstStop.label, detail: firstStop.detail } : null,
          config_loaded: cfgCompare.motor,
          config_saved: cfgCompare.screen,
          config_comparison: cfgCompare.fields,
          config_mismatch_count: cfgCompare.mismatch_count,
          protection_global: tickAudit.global_protection,
          checks,
          signals: extra.signals ?? { evaluated_side: intendedSide, buy: false, sell: false },
          committee: extra.committee ?? null,
          decision_context: decisionContext,
          trade_event: extra.trade_event ?? null,
          volatility_debug: (priceSrc as any).volatility_debug ?? null,
          series_health: (priceSrc as any).series_health ?? null,
          volatility_limit_pct: Number(cfg.max_volatility_pct),
        });

        // ── Diagnóstico: em que estágio este robô parou e por quê ──────────
        // Puro registro. Envolvido em try/catch e sem await: as linhas são
        // enfileiradas e gravadas em UM insert no fim do tique.
        try {
          const KEY_STAGE: Record<string, string> = {
            tick_received: "cotacao", mt5_server: "cotacao", mt5_symbol: "cotacao",
            valid_quote: "cotacao", spread: "cotacao",
            market_open: "horario", time_allowed: "horario",
            operation_window: "horario", force_close_window: "horario",
            global_protection: "protecao", protection_engine: "protecao",
            daily_loss: "protecao", daily_loss_aggregate: "protecao",
            daily_target: "protecao", volatility: "protecao",
            mode_enabled: "protecao", max_trades: "protecao", position_open: "protecao",
            setup: "classificador",
            score: "comite", confidence: "comite", committee: "comite",
          };
          const setupObj = (extra.setup ?? null) as any;
          const committeeObj = (extra.committee ?? null) as any;
          const r = String(finalReason ?? "");
          let estagio = firstStop ? (KEY_STAGE[firstStop.key] ?? "outro") : null;
          if (!estagio) {
            if (extra.trade_event && /aprovad/i.test(r)) estagio = "aprovado";
            else if (/grupo/i.test(r)) estagio = "freio_grupo";
            else if (/setup/i.test(r)) estagio = "classificador";
            else if (/cota[çc]|tick|pre[çc]o/i.test(r)) estagio = "cotacao";
            else if (/prote[çc]|pico|meta|perda|loss|drawdown/i.test(r)) estagio = "protecao";
            else if (/hor[áa]rio|janela|zeragem|abertura/i.test(r)) estagio = "horario";
            else if (committeeObj) estagio = "comite";
            else estagio = "outro";
          }
          // Assinatura sem números: "score 62 / mínimo 75" muda a cada tique e
          // não é mudança de estado.
          const sigValue = `${estagio}|${firstStop?.key ?? ""}|${setupObj?.name ?? ""}|${r.replace(/[\d.,+-]+/g, "#").slice(0, 140)}`;
          if (sigChanged(`entry_stage:${mode}`, sigValue)) {
            entryStageRows.push({
              user_id: userId,
              simulation_run_id: runId,
              simulation_mode_id: m.id,
              mode,
              symbol: asset.symbol,
              entry_style: String((cfg as any).entry_style ?? "indicador"),
              estagio,
              motivo: r.slice(0, 500),
              detalhe: setupObj
                ? {
                    setup: setupObj.name ?? null,
                    ok: setupObj.ok ?? null,
                    reasons: setupObj.reasons ?? null,
                    details: setupObj.details ?? null,
                    side_override: setupObj.side_override ?? null,
                    stop_pts_override: setupObj.stop_pts_override ?? null,
                    gain_pts_override: setupObj.gain_pts_override ?? null,
                    first_stop: firstStop ? { key: firstStop.key, label: firstStop.label, detail: firstStop.detail } : null,
                  }
                : firstStop
                  ? { first_stop: { key: firstStop.key, label: firstStop.label, detail: firstStop.detail } }
                  : null,
              score: committeeObj?.score != null ? Number(committeeObj.score) : null,
              confidence: committeeObj?.avg_confidence != null ? Number(committeeObj.avg_confidence) : null,
              approve_votes: committeeObj?.approve_votes != null ? Number(committeeObj.approve_votes) : null,
            });
          }
        } catch { /* diagnóstico nunca atrasa nem impede a avaliação */ }
      };


      addCheck("tick_received", "Tick recebido", priceSrc.source !== "mt5_xp_demo" || Boolean(priceSrc.raw), priceSrc.raw?.tick_ts ? `tick ${priceSrc.raw.tick_ts}` : "sem tick MT5");
      addCheck("mt5_server", "Servidor MT5", priceSrc.source !== "mt5_xp_demo" || priceSrc.server === "XPMT5-DEMO" || priceSrc.server === "XPMT5-PRD", priceSrc.server ? `recebido ${priceSrc.server}` : "sem servidor");
      addCheck("mt5_symbol", `Símbolo ${asset.symbol}`, priceSrc.source !== "mt5_xp_demo" || priceSrc.quote_symbol === asset.symbol, priceSrc.quote_symbol ? `recebido ${priceSrc.quote_symbol}` : "sem símbolo");
      addCheck("market_open", "Mercado aberto", ctx.session_phase !== "fora", `fase ${ctx.session_phase}`);
      addCheck("time_allowed", "Horário permitido", insideHours, `${cfg.trading_start_time}–${cfg.entry_cutoff_time}`);
      // Não bloqueia entrada: é sinalização. Um robô sem freio de grupo não
      // pode continuar visualmente idêntico a um robô protegido.
      addCheck("grupo_limite", "Freio de grupo", Boolean(grupoLimites),
        grupoLimites
          ? `${grupoRoot}/${runVariant} · teto ${grupoLimites.teto_brl.toFixed(0)} BRL`
          : `sem freio de grupo configurado (${grupoRoot}/${runVariant})`,
        false);
      addCheck("operation_window", "Janela operacional", insideHours, `${cfg.trading_start_time}–${cfg.entry_cutoff_time}`);
      addCheck("force_close_window", "Janela zeragem", !forceClose, `zeragem ${cfg.force_close_time}`);
      addCheck("valid_quote", "Cotação válida", !invalidMt5, invalidMt5 ?? `bid ${priceSrc.raw?.bid ?? "—"} · ask ${priceSrc.raw?.ask ?? "—"}`);
      addCheck("spread", "Spread", Number(ctx.spread_pts ?? priceSrc.raw?.spread ?? 0) > 0, `${Number(ctx.spread_pts ?? priceSrc.raw?.spread ?? 0)} pts`, false);
      addCheck("global_protection", "Proteção Global", !globalProtectionActive, globalProtectionReason);

      const quoteStalledForMode = Boolean(open) && quoteAgeS > 10;
      const entryBlockedByQuoteStall = quoteAgeS > 10;
      if (quoteStalledForMode) {
        await recordStatusIfChanged(mode, m, open ? "cotacao_interrompida_posicao_aberta" : "erro_tecnico", "quote_stall_entry_block", {
          pnl: realizedToday,
          related_order_id: open?.id ?? null,
          message: open
            ? `Cotação interrompida há ${quoteAgeS.toFixed(0)}s com posição aberta — novas entradas bloqueadas; gestão da posição mantida pelo último bid/ask conhecido.`
            : `Cotação interrompida há ${quoteAgeS.toFixed(0)}s — novas entradas bloqueadas até retomada.`,
        });
      }

      if (invalidMt5) {
        await recordStatusIfChanged(mode, m, "erro_tecnico", "price_source_guard", {
          pnl: realizedToday,
          message: invalidMt5,
          provider_name: priceSrc.provider_name,
          price_source: priceSrc.quote_source,
          rejected_price: ctx.price,
          mt5_last: priceSrc.raw?.last ?? null,
          forceLog: false,
          diagnostic_payload: {
            function: "runB3SimulationTick",
            provider: priceSrc.provider_name,
            selected_source: priceSrc.source,
            quote_source: priceSrc.quote_source,
            symbol: priceSrc.quote_symbol,
            server: priceSrc.server,
            quote_age_s: priceSrc.quote_age_s,
            bid: priceSrc.raw?.bid ?? null,
            ask: priceSrc.raw?.ask ?? null,
            last: priceSrc.raw?.last ?? null,
          },
        });
        // Nenhuma condição pode pular a gestão de posição aberta. Bloqueio é
        // sempre de entrada nova. A única razão para encerrar o ciclo de um
        // modo é ele não ter posição aberta.
        if (!open) {
          log.push({ mode, action: "skip", reason: "mt5_quote_invalid", detail: invalidMt5 });
          finalizeAudit(invalidMt5);
          continue;
        }
        log.push({ mode, action: "manage_open_despite_quote_guard", reason: "mt5_quote_invalid", detail: invalidMt5 });
      }

      // ─────────── B3 Protection (Flexibilização Inteligente) ───────────
      const todayKey = b3DayKeyBRT(now);
      // Reset diário se virou o dia.
      if (m.protection_day_key && m.protection_day_key !== todayKey) {
        try {
          await supabase.from("b3_daily_protection_history").upsert({
            user_id: userId, simulation_run_id: runId, simulation_mode_id: m.id, mode,
            day_key: m.protection_day_key,
            target_reached_at: m.target_reached_at,
            block_at: m.protection_state?.startsWith("blocked_") ? m.status_changed_at : null,
            profit_at_target_brl: m.profit_at_target_brl,
            peak_profit_after_target_brl: m.peak_profit_after_target_brl,
            profit_after_target_brl: m.profit_after_target_brl,
            given_back_brl: Math.max(0, Number(m.peak_profit_after_target_brl ?? 0) - Number(m.profit_at_target_brl ?? 0) - Number(m.profit_after_target_brl ?? 0)),
            profit_at_close_brl: null,
            trades_total: m.total_trades,
            trades_after_target: m.trades_after_target,
            drawdown_after_target_brl: Math.max(0, Number(m.peak_profit_after_target_brl ?? 0) - (Number(m.profit_at_target_brl ?? 0) + Number(m.profit_after_target_brl ?? 0))),
            block_reason: m.protection_block_reason,
            final_status: m.protection_state,
          }, { onConflict: "user_id,simulation_run_id,mode,day_key" });
        } catch { /* histórico é best-effort */ }
        const reset = resetB3ProtectionForNewDay();
        Object.assign(m, reset);
      }

      // Deriva trades/consecutive losses pós-meta a partir das ordens fechadas.
      let tradesAfterTarget = Number(m.trades_after_target ?? 0);
      let consecLosses = Number(m.consecutive_losses_after_target ?? 0);
      if (m.target_reached_at) {
        const { data: post } = await supabase.from("b3_simulation_orders")
          .select("net_result_brl, exit_time")
          .eq("simulation_run_id", runId).eq("simulation_mode_id", m.id)
          .eq("status", "closed").gte("exit_time", m.target_reached_at)
          .order("exit_time", { ascending: true });
        tradesAfterTarget = (post ?? []).length;
        consecLosses = 0;
        for (let k = (post ?? []).length - 1; k >= 0; k--) {
          if (Number(post![k].net_result_brl ?? 0) < 0) consecLosses++; else break;
        }
      }

      // Tempo operando hoje (BRT) — a partir das 09:00.
      const opMinutes = Math.max(0, saoPauloMinutes(now) - hhmmToMin(cfg.trading_start_time));

      const protCfg: B3ProtectionSettings = {
        minimum_trades_before_profit_lock: Number(cfg.minimum_trades_before_profit_lock ?? 15),
        minimum_operating_minutes: Number(cfg.minimum_operating_minutes ?? 90),
        profit_multiplier_before_lock: Number(cfg.profit_multiplier_before_lock ?? 2.0),
        post_target_allowed_retracement: Number(cfg.post_target_allowed_retracement ?? 0.30),
        consecutive_loss_after_target: Number(cfg.consecutive_loss_after_target ?? 2),
        post_target_size_reduction: Number(cfg.post_target_size_reduction ?? 0.50),
        daily_loss_limit_brl: Number(cfg.daily_loss_limit_brl),
        daily_gain_target_brl: Number(cfg.daily_gain_target_brl),
        max_volatility_pct: Number(cfg.max_volatility_pct),
        // Trava de devolução de pico — independe de meta. O piso padrão é um
        // stop do robô em reais (stop_pts × valor do ponto × contratos).
        peak_giveback_pct: Number((cfg as any).peak_giveback_pct ?? 0.40),
        peak_lock_min_profit_brl: Number(
          (cfg as any).peak_lock_min_profit_brl
          ?? (Number(cfg.stop_pts) * Number(asset?.tick_value_brl ?? POINT_VALUE_BRL) * Number(cfg.max_contracts ?? 1)),
        ),
      };

      const protCur: B3ProtectionRuntime = {
        protection_state: (m.protection_state as any) ?? "operating_normal",
        target_reached_at: m.target_reached_at ?? null,
        profit_at_target_brl: m.profit_at_target_brl != null ? Number(m.profit_at_target_brl) : null,
        trades_at_target: m.trades_at_target != null ? Number(m.trades_at_target) : null,
        peak_profit_after_target_brl: Number(m.peak_profit_after_target_brl ?? 0),
        profit_after_target_brl: Number(m.profit_after_target_brl ?? 0),
        trades_after_target: tradesAfterTarget,
        consecutive_losses_after_target: consecLosses,
        day_peak_profit_brl: Number(m.day_peak_profit_brl ?? 0),
        protection_block_reason: m.protection_block_reason ?? null,
      };

      const protDec = evaluateB3Protection(protCur, protCfg, {
        realized_today_brl: realizedToday,
        marked_today_brl: markedTodayForProtection,
        total_trades_today: Number(m.total_trades ?? 0),
        operating_minutes_today: opMinutes,
        volatility_pct: ctx.volatility_pct,
        drawdown_hit: false,
        now_iso: now.toISOString(),
      });

      // Persistir runtime de proteção — apenas quando algo muda de fato.
      const protPatch = {
        protection_state: protDec.next.protection_state,
        target_reached_at: protDec.next.target_reached_at,
        profit_at_target_brl: protDec.next.profit_at_target_brl,
        trades_at_target: protDec.next.trades_at_target,
        peak_profit_after_target_brl: protDec.next.peak_profit_after_target_brl,
        profit_after_target_brl: protDec.next.profit_after_target_brl,
        trades_after_target: protDec.next.trades_after_target,
        consecutive_losses_after_target: protDec.next.consecutive_losses_after_target,
        day_peak_profit_brl: protDec.next.day_peak_profit_brl,
        protection_block_reason: protDec.next.protection_block_reason,
        protection_day_key: todayKey,
      } as Record<string, any>;
      // A comparação campo a campo vive em `patchMode`: datas devolvidas pelo
      // banco como "+00:00" comparadas contra ISO "…Z" faziam este bloco gravar
      // a cada passada, mesmo sem nenhuma mudança de proteção.
      await patchMode(m, protPatch);



      if (protDec.transition) {
        markAuditEvent(`protecao:${mode}:${protDec.transition.to}`);
        try {
          await supabase.from("b3_simulation_block_events").insert({
            simulation_run_id: runId, simulation_mode_id: m.id, user_id: userId,
            mode,
            prev_status: protDec.transition.from,
            new_status: protDec.transition.to,
            trigger: `protection:${protDec.transition.to}`,
            observed_value: protDec.transition.to === "blocked_peak_giveback" ? markedTodayForProtection : realizedToday,
            limit_value: protDec.transition.to === "blocked_peak_giveback"
              ? Number(protDec.next.day_peak_profit_brl ?? 0) * Number(protCfg.peak_giveback_pct ?? 0.4)
              : protCfg.daily_gain_target_brl,
            pnl_at_moment: protDec.transition.to === "blocked_peak_giveback" ? markedTodayForProtection : realizedToday,
            message: protDec.transition.reason,
            related_order_id: open?.id ?? null,
            diagnostic_payload: {
              realized_today_brl: realizedToday,
              open_mtm_brl: openMtmBrlForProtection,
              marked_today_brl: markedTodayForProtection,
              day_peak_profit_brl: protDec.next.day_peak_profit_brl,
              peak_giveback_pct: protCfg.peak_giveback_pct,
              peak_lock_min_profit_brl: protCfg.peak_lock_min_profit_brl,
              mark_price: openMarkPriceForProtection,
            } as any,
          });
        } catch { /* best-effort */ }
      }
      // ────────────────── fim B3 Protection ──────────────────

      addCheck("mode_enabled", "Robô habilitado", cfg.enabled !== false, cfg.enabled === false ? "Modo desativado nas configurações." : "habilitado");
      addCheck("volatility", "Volatilidade", ctx.volatility_pct <= Number(cfg.max_volatility_pct), `${ctx.volatility_pct.toFixed(2)}% / limite ${Number(cfg.max_volatility_pct).toFixed(2)}%`);
      addCheck("max_trades", "Máximo trades", !open && 1 <= Number(cfg.max_contracts), open ? "Já existe posição aberta neste robô." : `1 / ${Number(cfg.max_contracts)} contrato(s)`);
      addCheck("daily_loss", "Loss diário", realizedToday > -Number(cfg.daily_loss_limit_brl), `${realizedToday.toFixed(2)} / -${Number(cfg.daily_loss_limit_brl).toFixed(2)} BRL`);
      const realizedTodayTotal = Object.values(realizedTodayByMode).reduce((a: number, b: any) => a + Number(b ?? 0), 0);
      addCheck("daily_loss_aggregate", "Perda diária agregada (conta)", realizedTodayTotal > -globalDailyLossLimitBrl,
        `${realizedTodayTotal.toFixed(2)} / -${globalDailyLossLimitBrl.toFixed(2)} BRL (5 modos somados)`);
      addCheck("daily_target", "Meta diária", realizedToday < Number(cfg.daily_gain_target_brl) || protDec.allow_new_entry, `${realizedToday.toFixed(2)} / ${Number(cfg.daily_gain_target_brl).toFixed(2)} BRL`);
      addCheck("position_open", "Posição aberta", !open, open ? `ordem ${open.id}` : "NÃO", false);
      addCheck("protection_engine", "Proteção diária", protDec.allow_new_entry, protDec.next.protection_block_reason ?? protDec.next.protection_state);

      if (cfg.enabled === false) {
        await recordStatusIfChanged(mode, m, "pausado", "paused",
          { pnl: realizedToday, message: "Modo desativado nas configurações." });
        // Um bloqueio pode impedir ENTRADA nova, nunca a GESTÃO de posição já
        // aberta. Sem posição, para aqui; com posição, segue para stop/gain/
        // trailing/zeragem e o gate de entrada é reaplicado depois.
        if (!open) {
          log.push({ mode, action: "skip", reason: "modo_desativado" });
          finalizeAudit("Robô desativado nas configurações.");
          continue;
        }
      }

      if (open) {
        if (priceSrc.source === "mt5_xp_demo" && open.quote_source !== "MT5 XP DEMO") {
          await supabase.from("b3_simulation_orders").update({
            status: "cancelled",
            close_reason: "Fonte alterada para MT5 XP DEMO — operação legada invalidada",
          }).eq("id", open.id).eq("user_id", userId);
          openOrdersCache = null; ordersMutated = true;
          log.push({ mode, action: "cancel_legacy_open", reason: "legacy_price_state_invalidated" });
          finalizeAudit("Posição legada aberta foi invalidada antes de nova decisão.");
          continue;
        }
        const dirSign = open.side === "buy" ? 1 : -1;
        let markAudit: B3QuoteExecutionAudit;
        try {
          // Gestão usa o último Bid/Ask conhecido mesmo quando o TTL expirou.
          // Para fechar BUY usa Bid; para fechar SELL usa Ask. O preço permanece
          // exatamente o preço auditado exigido por b3_enforce_mt5_execution_audit.
          if (priceSrc.source === "mt5_xp_demo") {
            const bid = Number(priceSrc.raw?.bid);
            const ask = Number(priceSrc.raw?.ask);
            if (!(bid > 0) || !(ask > 0)) {
              throw new Error("Último bid/ask MT5 indisponível para gerir posição aberta.");
            }
            const marketExit = open.side === "buy" ? bid : ask;
            markAudit = {
              ...quoteAuditBase(priceSrc),
              execution_price: roundToTick(marketExit, Number(asset.tick_size)),
              execution_price_origin: open.side === "buy" ? "mt5_last_known_bid_exit_mark" : "mt5_last_known_ask_exit_mark",
              legacy_price_detected: false,
            };
          } else {
            markAudit = getB3ExecutionAudit(priceSrc, open.side, "mark", "runB3SimulationTick.markToMarket");
          }
          if (priceSrc.source === "mt5_xp_demo") assertB3StrictMt5ExecutionAudit(markAudit, "runB3SimulationTick.markToMarket", asset.symbol);
          providerStats.last_price_function = markAudit.execution_price_origin;
        } catch (e) {
          await recordStatusIfChanged(mode, m, "erro_tecnico", "price_source_guard", {
            pnl: realizedToday,
            related_order_id: open.id,
            message: (e as Error).message,
            provider_name: priceSrc.provider_name,
            price_source: priceSrc.quote_source,
            rejected_price: ctx.price,
            mt5_last: priceSrc.raw?.last ?? null,
            forceLog: false,
            diagnostic_payload: { function: "runB3SimulationTick.markToMarket", attempted_context_price: ctx.price, ...quoteAuditBase(priceSrc) },
          });
          await recordPendingStopIfCrossed(mode, m, open, cfg, `auditoria de execução/guard de preço rejeitou: ${(e as Error).message}`);
          log.push({ mode, action: "skip", reason: "price_guard", message: (e as Error).message });
          finalizeAudit((e as Error).message);
          continue;
        }
        const markPrice = markAudit.execution_price;
        const movePts = (markPrice - Number(open.entry_price)) * dirSign;
        const openMtmBrlAtMark = markOpenOrderBrl(open, markPrice);
        const markedTodayAtMark = realizedToday + (openMtmBrlAtMark ?? 0);

        // ── FREIO DE PICO EM SOMBRA NO SIMULADO (15/09/2026) ──
        // Até aqui o freio de pico fechava a posição simulada a mercado. Isso
        // censura o caminho livre exatamente como o bloqueio de entrada
        // censurava a amostra do freio de grupo: a operação era interrompida no
        // pior instante, antes de se saber se recuperaria, e a medição ficava
        // enviesada a favor do freio. Agora a posição simulada SEGUE até stop,
        // alvo, trailing ou zeragem (todos ativos — não há risco novo), e a
        // medição diária diz quanto o freio pouparia ou custaria.
        //
        // NO REAL NADA MUDA: o fechamento continua sendo enfileirado no
        // instante do travamento, uma vez por posição.
        // 16/09/2026: com o freio de pico LIBERADO na tela para este robô, o
        // real também não é fechado — liberar serve justamente para a posição
        // real seguir o simulado. Nada é marcado como espelhado: se a liberação
        // for encerrada com a posição ainda aberta, o fechamento sai então.
        if (protDec.next.protection_state === "blocked_peak_giveback"
            && !picoFreioEspelhado.has(open.id) && !freioEstaLiberado(mode, "pico")) {
          picoFreioEspelhado.add(open.id);

          const peak = Number(protDec.next.day_peak_profit_brl ?? 0);
          const allowed = peak * Number(protCfg.peak_giveback_pct ?? 0.4);
          const givenBack = Math.max(0, peak - markedTodayAtMark);
          markAuditEvent(`pico_freio_sombra_aberta:${mode}`);
          await mirrorToReal(supabase, userId, runId, mode as Mode, "close", open.side, `close-pico-${open.id}`,
            "engine_auto", asset.quote_symbol, runVariant);
          try {
            await supabase.from("b3_simulation_block_events").insert({
              simulation_run_id: runId, simulation_mode_id: m.id, user_id: userId,
              mode,
              prev_status: m.current_status ?? "operando",
              new_status: "blocked_peak_giveback",
              trigger: "pico_freio_sombra_posicao_aberta",
              related_order_id: open.id,
              observed_value: givenBack,
              limit_value: allowed,
              pnl_at_moment: markedTodayAtMark,
              message: `Freio de devolução de pico: devolução ${givenBack.toFixed(2)} BRL / limite ${allowed.toFixed(2)} BRL — posição simulada MANTIDA (sombra) e fechamento enviado ao real.`,
              diagnostic_payload: {
                sombra: true,
                freio: "pico",
                realized_today_brl: realizedToday,
                open_mtm_brl: openMtmBrlAtMark,
                marked_today_brl: markedTodayAtMark,
                day_peak_profit_brl: peak,
                mark_price: markPrice,
                close_reason: null, simulado: "mantido", real: "fechado",
              } as any,
            });
          } catch { /* auditoria best-effort */ }
          try {
            await supabase.from("system_logs").insert({
              event_type: "peak_giveback_lock_sombra_posicao_aberta",
              source: `b3:${asset.symbol}:${mode}`,
              severity: "warning",
              message: `Freio de devolução de pico: posição ${open.side} MANTIDA no simulado (sombra) e encerrada no real — devolução ${givenBack.toFixed(2)} BRL / limite ${allowed.toFixed(2)} BRL.`,
              technical_data: {
                order_id: open.id, run_id: runId, mode, symbol: asset.symbol,
                variant: runVariant,
                realized_today_brl: realizedToday, open_mtm_brl: openMtmBrlAtMark,
                marked_today_brl: markedTodayAtMark, day_peak_profit_brl: peak,
                limit_brl: allowed, mark_price: markPrice,
              } as any,
            });
          } catch { /* log best-effort */ }
          log.push({ mode, action: "pico_freio_sombra", given_back_brl: givenBack, limit_brl: allowed });
        }


        // ── TRAVAMENTO DE GRUPO COM POSIÇÃO ABERTA (09/09/2026) ──
        // No SIMULADO o travamento deixou de fechar a posição. Fechar no
        // instante do travamento censurava o caminho livre exatamente como o
        // bloqueio de entrada censurava a amostra: a operação era interrompida
        // no pior momento, antes de se saber se recuperaria — e isso enviesava
        // `diferenca_brl` a favor da sombra, fazendo o freio parecer melhor do
        // que é. A posição segue até stop, alvo, trailing ou zeragem, como
        // qualquer outra (todos continuam ativos: não há risco novo).
        //
        // No REAL nada muda: o comando de fechamento continua sendo enfileirado
        // no travamento, uma vez por ordem. Essa é uma decisão de risco
        // separada, a ser revista com b3_grupo_sombra_dia em mãos.
        //
        // Desde 15/09/2026 o freio de PICO segue a mesma regra (bloco acima).
        // O disjuntor diário real continua fechando de verdade.

        // Freio de grupo liberado na tela (16/09/2026): o real segue aberto.
        if (grupoNivel >= 2 && grupoTravados.includes(mode) && !grupoFreioEspelhado.has(open.id)
            && !freioEstaLiberado(mode, "grupo")) {
          grupoFreioEspelhado.add(open.id);
          const Rgrupo = Number(grupo?.resultado_brl ?? 0);
          const tetoGrupo = Number(grupoLimites?.teto_brl ?? 0);
          markAuditEvent(`grupo_freio_sombra_aberta:${mode}`);
          // REAL: encerra como antes.
          await mirrorToReal(supabase, userId, runId, mode as Mode, "close", open.side, `close-grupo-${open.id}`,
            "engine_auto", asset.quote_symbol, runVariant);
          try {
            await supabase.from("b3_simulation_block_events").insert({
              simulation_run_id: runId, simulation_mode_id: m.id, user_id: userId,
              mode,
              prev_status: m.current_status ?? "operando",
              new_status: `grupo_nivel_${grupoNivel}`,
              trigger: "grupo_freio_sombra_posicao_aberta",
              related_order_id: open.id,
              observed_value: Rgrupo,
              limit_value: -tetoGrupo,
              pnl_at_moment: markedTodayAtMark,
              message: `Freio de grupo ${run.symbol}/${runVariant} — ${textoNivelGrupo(grupoNivel, grupoMultiplicador)}; posição simulada MANTIDA (sombra) e fechamento enviado ao real (resultado do grupo ${Rgrupo.toFixed(2)} BRL).`,
              diagnostic_payload: {
                sombra: true,
                grupo_nivel: grupoNivel, grupo_resultado_brl: Rgrupo, grupo_teto_brl: tetoGrupo,
                realized_today_brl: realizedToday, open_mtm_brl: openMtmBrlAtMark,
                marked_today_brl: markedTodayAtMark, mark_price: markPrice,
                close_reason: null, simulado: "mantido", real: "fechado",
              } as any,
            });
          } catch { /* auditoria best-effort */ }
          try {
            await supabase.from("system_logs").insert({
              event_type: "grupo_freio_sombra_posicao_aberta",
              source: `b3:${asset.symbol}:${mode}`,
              severity: "warning",
              message: `Freio de grupo nível ${grupoNivel} em ${run.symbol}/${runVariant}: posição ${open.side} MANTIDA no simulado (sombra) e encerrada no real (grupo ${Rgrupo.toFixed(2)} BRL, teto ${tetoGrupo.toFixed(2)} BRL).`,
              technical_data: {
                order_id: open.id, run_id: runId, mode, symbol: asset.symbol,
                variant: runVariant, grupo_nivel: grupoNivel, grupo_resultado_brl: Rgrupo,
                grupo_teto_brl: tetoGrupo, marked_today_brl: markedTodayAtMark,
                mark_price: markPrice,
              } as any,
            });
          } catch { /* log best-effort */ }
          log.push({ mode, action: "grupo_freio_sombra", nivel: grupoNivel, grupo_resultado_brl: Rgrupo });
        }

        // Níveis por ordem: modalidades com níveis dinâmicos (rompimento)
        // gravam stop_pts/gain_pts na ordem; as demais caem na configuração.
        const orderStopPts = Number(open.stop_pts ?? cfg.stop_pts);
        const orderGainPts = Number(open.gain_pts ?? cfg.gain_pts);
        let hitStop = movePts <= -orderStopPts;
        let hitGain = movePts >= orderGainPts;

        // ────────── avaliação INTRA-CANDLE de stop/alvo (fidelidade) ──────────
        // O cron roda 1x/min, mas o mercado anda dentro do minuto (mediana de
        // ~50 pts por candle M1 no WIN). Avaliar só o preço do tick corrente
        // fazia o stop ser percebido tarde e executado num preço muito pior
        // (medido: até +79% além do stop configurado). Aqui usamos máxima e
        // mínima dos candles M1 já carregados (b3_m1_candles) para detectar o
        // toque. A execução é sempre no Bid/Ask corrente auditado: o candle
        // prova que o nível foi tocado, mas não prova liquidez naquele preço.
        // Convenção conservadora de backtest: stop e alvo no mesmo candle → stop.
        const stopLevel = Number(open.entry_price) - dirSign * orderStopPts;
        const gainLevel = Number(open.entry_price) + dirSign * orderGainPts;
        const entryMsOpen = open.entry_time ? new Date(open.entry_time).getTime() : null;
        const lastEvalMs = open.last_eval_minute_ts ? new Date(open.last_eval_minute_ts).getTime() : null;
        const evalFromMs = lastEvalMs ?? entryMsOpen;
        const nowMs = Date.now();
        const minutoCorrenteMs = Math.floor(nowMs / 60000) * 60000;
        // DEFEITO CORRIGIDO: b3_m1_candles retorna ORDER BY m DESC (mais novo
        // primeiro). O laço abaixo faz break no primeiro toque, então sem
        // reordenar ele encontrava o toque MAIS RECENTE em vez do PRIMEIRO —
        // preço de saída e candle_minute_ts errados. Semântica correta de
        // backtest: "qual foi o PRIMEIRO candle que tocou o nível".
        const candlesToEval = (evalFromMs
          ? m1Candles.filter((c: any) => {
              const t = new Date(c.minute_ts).getTime();
              return t > evalFromMs && t <= nowMs;
            })
          : []
        ).slice().sort((a: any, b: any) => new Date(a.minute_ts).getTime() - new Date(b.minute_ts).getTime());
        // touched(): stop/trailing são adversos, alvo é favorável.
        const adverseTouch = (c: any, level: number) => {
          const low = Number(c.candle_low), high = Number(c.candle_high);
          if (!Number.isFinite(low) || !Number.isFinite(high)) return false;
          return dirSign === 1 ? low <= level : high >= level;
        };
        const favorableTouch = (c: any, level: number) => {
          const low = Number(c.candle_low), high = Number(c.candle_high);
          if (!Number.isFinite(low) || !Number.isFinite(high)) return false;
          return dirSign === 1 ? high >= level : low <= level;
        };
        let intrabarHit: { reason: string; level: number; price: number; minute_ts: string; both: boolean } | null = null;
        let lastEvaluatedMinuteTs: string | null = null;
        let candleIncompletoIgnorado = false;
        // DEFEITO CORRIGIDO: o marcador deve ser o MAIOR minute_ts entre os
        // candles COMPLETOS avaliados e nunca pode retroceder.
        let lastEvaluatedMs = lastEvalMs ?? 0;
        for (const c of candlesToEval) {
          const candleMs = new Date(c.minute_ts).getTime();
          if (candleMs < minutoCorrenteMs) {
            if (candleMs > lastEvaluatedMs) {
              lastEvaluatedMs = candleMs;
              lastEvaluatedMinuteTs = c.minute_ts;
            }
          } else {
            candleIncompletoIgnorado = true;
          }
          const stopTouched = adverseTouch(c, stopLevel);
          const gainTouched = favorableTouch(c, gainLevel);
          if (stopTouched) {
            intrabarHit = { reason: "stop", level: stopLevel, price: markAudit.execution_price, minute_ts: c.minute_ts, both: gainTouched };
            break;
          }
          if (gainTouched) {
            intrabarHit = { reason: "gain", level: gainLevel, price: markAudit.execution_price, minute_ts: c.minute_ts, both: false };
            break;
          }
        }
        if (intrabarHit) {
          if (intrabarHit.reason === "stop") hitStop = true; else hitGain = true;
        }


        // ────────── proteção de lucro: ativação + recuo (trailing) ──────────
        // Desligada por padrão (trailing_activation_pts=0). Quando ligada,
        // olha o histórico de mercado desde a entrada pra achar o MELHOR
        // ponto já alcançado (peakPts) — não confundir com o preço atual.
        // Dois modos, escolhidos por cfg.trailing_mode:
        //  'fixed'      → fecha se recuar trailing_giveback_pts do pico (pts fixos)
        //  'structural' → fecha se romper o último fundo/topo CONFIRMADO
        //                 (fractal N=1: candle_low[i] menor que o candle antes
        //                 e depois dele = fundo confirmado; simétrico pra topo
        //                 em posição vendida). Mais fiel a price action, mas
        //                 só reconhece o fundo/topo DEPOIS que o candle seguinte
        //                 já fechou — atraso é inerente ao conceito, não é bug.
        let hitTrailing = false;
        let peakPts = movePts;
        let trailingDebug: any = null;
        let trailingIntrabar: { level: number; price: number; minute_ts: string } | null = null;

        // ─────────── ZERO A ZERO (breakeven) — proteção DENTRO da operação ───────────
        // Vale para todas as modalidades. Nasce DESLIGADA: com
        // breakeven_ativa_pts vazio ou zero, nada abaixo muda o comportamento.
        let hitBreakeven = false;
        let breakevenDebug: any = null;
        let breakevenIntrabar: { level: number; price: number; minute_ts: string } | null = null;
        const beAtivaPts = Number(cfg.breakeven_ativa_pts ?? 0);
        const beOn = Number.isFinite(beAtivaPts) && beAtivaPts > 0;

        const trailingOn = Number(cfg.trailing_activation_pts) > 0;
        const entryMsForTrailing = open.entry_time ? new Date(open.entry_time).getTime() : null;
        // O pico a favor desde a entrada serve ao trailing E ao zero a zero.
        if ((trailingOn || beOn) && entryMsForTrailing) {
          const sinceEntry = marketHistory
            .filter((h: any) => {
              const t = new Date(h.market_time).getTime();
              return t >= entryMsForTrailing && t <= Date.now();
            })
            .sort((a: any, b: any) => new Date(a.market_time).getTime() - new Date(b.market_time).getTime());

          for (const h of sinceEntry) {
            const p = Number(h.quote_last ?? h.price ?? 0);
            if (!Number.isFinite(p) || p <= 0) continue;
            const move = (p - Number(open.entry_price)) * dirSign;
            if (move > peakPts) peakPts = move;
          }
          // `trailingOn` no armed: com o zero a zero ligado e o trailing
          // desligado (ativação 0), sem esta guarda o trailing armaria sozinho.
          const armed = trailingOn && peakPts >= Number(cfg.trailing_activation_pts);

          if (armed && cfg.trailing_mode === "structural") {
            // Fractal N=1 sobre candles M1 REAIS (b3_m1_candles): candle i é
            // fundo (compra) se candle_low[i] < low[i-1] e < low[i+1]; é topo
            // (venda) se candle_high[i] > high[i-1] e > high[i+1].
            // Snapshots não servem: seus extremos são acumulados de janela.
            const candlesSinceEntry = m1Candles.filter((c: any) => {
              const t = new Date(c.minute_ts).getTime();
              return t >= entryMsForTrailing && t <= Date.now();
            });
            let structuralStopPrice: number | null = null;
            for (let i = 1; i < candlesSinceEntry.length - 1; i++) {
              const prev = candlesSinceEntry[i - 1], cur = candlesSinceEntry[i], next = candlesSinceEntry[i + 1];
              if (open.side === "buy") {
                const lowPrev = Number(prev.candle_low), lowCur = Number(cur.candle_low), lowNext = Number(next.candle_low);
                if ([lowPrev, lowCur, lowNext].every(Number.isFinite) && lowCur < lowPrev && lowCur < lowNext) {
                  if (structuralStopPrice === null || lowCur > structuralStopPrice) structuralStopPrice = lowCur;
                }
              } else {
                const highPrev = Number(prev.candle_high), highCur = Number(cur.candle_high), highNext = Number(next.candle_high);
                if ([highPrev, highCur, highNext].every(Number.isFinite) && highCur > highPrev && highCur > highNext) {
                  if (structuralStopPrice === null || highCur < structuralStopPrice) structuralStopPrice = highCur;
                }
              }
            }
            trailingDebug = { mode: "structural", structural_stop_price: structuralStopPrice, peak_pts: peakPts, m1_candles_since_entry: candlesSinceEntry.length };

            if (structuralStopPrice !== null) {
              // Nível estrutural é testado contra máxima/mínima do candle; a
              // execução continua sendo no Bid/Ask corrente auditado.
              const touchCandle = candlesToEval.find((c: any) => adverseTouch(c, structuralStopPrice as number));
              if (touchCandle) {
                hitTrailing = true;
                trailingIntrabar = { level: structuralStopPrice, price: markAudit.execution_price, minute_ts: touchCandle.minute_ts };
              } else {
                hitTrailing = dirSign === 1 ? markPrice <= structuralStopPrice : markPrice >= structuralStopPrice;
              }
              trailingDebug.trailing_level_price = structuralStopPrice;
            }
          } else if (armed && Number(cfg.trailing_giveback_pts) > 0) {
            const trailLevel = Number(open.entry_price) + dirSign * (peakPts - Number(cfg.trailing_giveback_pts));
            const touchCandle = candlesToEval.find((c: any) => adverseTouch(c, trailLevel));
            if (touchCandle) {
              hitTrailing = true;
              trailingIntrabar = { level: trailLevel, price: markAudit.execution_price, minute_ts: touchCandle.minute_ts };
            } else {
              hitTrailing = (peakPts - movePts) >= Number(cfg.trailing_giveback_pts);
            }
            trailingDebug = { mode: "fixed", peak_pts: peakPts, giveback_pts: Number(cfg.trailing_giveback_pts), trailing_level_price: trailLevel };
          }
        }

        // ─────────── ZERO A ZERO: stop sobe para o preço de entrada ───────────
        // Depois que a operação anda `breakeven_ativa_pts` a favor, o nível de
        // saída passa a ser o preço de entrada (mais `breakeven_folga_pts`, se
        // configurada). Quando o trailing também está armado, o nível MAIS
        // PROTETIVO prevalece: para compra o maior, para venda o menor.
        if (beOn && entryMsForTrailing && peakPts >= beAtivaPts) {
          const folgaPts = Math.max(0, Number(cfg.breakeven_folga_pts ?? 0) || 0);
          const beLevel = Number(open.entry_price) + dirSign * folgaPts;
          const trailLevel = Number(trailingDebug?.trailing_level_price ?? NaN);
          const trailMaisProtetivo = Number.isFinite(trailLevel)
            && (dirSign === 1 ? trailLevel >= beLevel : trailLevel <= beLevel);
          breakevenDebug = {
            ativa_pts: beAtivaPts, folga_pts: folgaPts, peak_pts: peakPts,
            breakeven_level_price: beLevel,
            trailing_level_price: Number.isFinite(trailLevel) ? trailLevel : null,
            nivel_vencedor: trailMaisProtetivo ? "trailing" : "breakeven",
          };
          if (!trailMaisProtetivo) {
            const touchCandle = candlesToEval.find((c: any) => adverseTouch(c, beLevel));
            if (touchCandle) {
              hitBreakeven = true;
              breakevenIntrabar = { level: beLevel, price: markAudit.execution_price, minute_ts: touchCandle.minute_ts };
            } else {
              hitBreakeven = dirSign === 1 ? markPrice <= beLevel : markPrice >= beLevel;
            }
          }
        }

        if (forceClose || hitStop || hitGain || hitTrailing || hitBreakeven) {
          const reason = forceClose ? "force_close" : hitStop ? "stop" : hitGain ? "gain"
            : hitTrailing ? "trailing_stop" : "breakeven_stop";
          // O nível detecta o toque; o preço executado é sempre o Bid/Ask
          // corrente de markAudit, compatível com a auditoria MT5 do banco.
          const levelExec = reason === "stop" || reason === "gain"
            ? (intrabarHit && intrabarHit.reason === reason ? intrabarHit : null)
            : reason === "trailing_stop" ? trailingIntrabar
            : reason === "breakeven_stop" ? breakevenIntrabar : null;
          const exitAuditFinal: B3QuoteExecutionAudit = levelExec
            ? { ...markAudit,
                execution_price_origin: `${markAudit.execution_price_origin}+m1_market` }
            : markAudit;
          const exitPriceFinal = exitAuditFinal.execution_price;
          const tradeCtx = await closeOrder(supabase, userId, run, m, open, exitAuditFinal, reason, marketHistory, asset);
          markAuditEvent(`fechamento:${mode}:${reason}`);
          providerStats.last_exit_price = exitPriceFinal;
          openOrdersCache = null; ordersMutated = true;
          realizedTodayByMode = await getRealizedTodayByMode();
          try {
            await supabase.from("b3_simulation_orders").update({
              diagnostic_payload: {
                exit_evaluation: levelExec ? "m1_intrabar_level" : "tick_price_fallback",
                close_reason: reason,
                level_price: levelExec ? (levelExec as any).level : null,
                executed_price: exitPriceFinal,
                overshoot_pts: levelExec ? Math.abs(exitPriceFinal - Number((levelExec as any).level)) : 0,
                candle_minute_ts: levelExec ? (levelExec as any).minute_ts : null,
                candles_evaluated: candlesToEval.length,
                ambos_no_mesmo_candle: Boolean(intrabarHit?.both && reason === "stop"),
                tick_price_at_detection: markPrice,
                trailing_debug: trailingDebug,
                breakeven_debug: breakevenDebug,
                candle_incompleto_ignorado: candleIncompletoIgnorado,
              },
              last_eval_minute_ts: lastEvaluatedMinuteTs ?? open.last_eval_minute_ts ?? null,
            }).eq("id", open.id).eq("user_id", userId);
          } catch { /* diagnóstico nunca derruba o fechamento */ }
          if (reason === "stop") {
            const realPts = (exitPriceFinal - Number(open.entry_price)) * dirSign;
            await recordStatusIfChanged(mode, m, "stop_operacao", "stop_trade",
              { observed: realPts, limit: -orderStopPts, pnl: realizedTodayByMode[mode] ?? 0,
                related_order_id: open.id, message: `Stop da operação atingido (${realPts.toFixed(0)} pts).` });
          }
          log.push({ mode, action: "close", reason, price: exitPriceFinal, source: exitAuditFinal.quote_source, origin: exitAuditFinal.execution_price_origin });
          finalizeAudit(`Posição existente encerrada por ${reason}.`, {
            last_setup: `Posição ${open.side.toUpperCase()} em gestão`,
            signals: { evaluated_side: open.side, buy: false, sell: false },
            trade_event: tradeCtx,
          });
          continue;
        }

        const marcadorAntes = open.last_eval_minute_ts ?? null;
        // Sem saída: avança o marcador de minutos já avaliados (1 write/min no máximo).
        if (lastEvaluatedMinuteTs && lastEvaluatedMinuteTs !== open.last_eval_minute_ts) {
          try {
            await supabase.from("b3_simulation_orders")
              .update({ last_eval_minute_ts: lastEvaluatedMinuteTs })
              .eq("id", open.id).eq("user_id", userId);
            open.last_eval_minute_ts = lastEvaluatedMinuteTs;
          } catch { /* best-effort */ }
        }

        // ───────── REDE DE SEGURANÇA INCONDICIONAL DE STOP ─────────
        // Se o preço corrente já ultrapassou o nível de stop e a posição ainda
        // está aberta, fecha AGORA. Isto não substitui a avaliação normal —
        // é o que impede uma posição de correr 1400 pts por falha de caminho.
        const crossedNow = dirSign === 1 ? markPrice <= stopLevel : markPrice >= stopLevel;
        if (crossedNow) {
          const beyondPts = Math.abs(markPrice - stopLevel);
          try {
            const safetyAudit: B3QuoteExecutionAudit = {
              ...markAudit,
              execution_price_origin: `${markAudit.execution_price_origin}+stop_safety_net`,
            };
            await closeOrder(supabase, userId, run, m, open, safetyAudit, "stop_safety_net", marketHistory, asset);
            markAuditEvent(`fechamento:${mode}:stop_safety_net`);
            providerStats.last_exit_price = safetyAudit.execution_price;
            openOrdersCache = null; ordersMutated = true;
            realizedTodayByMode = await getRealizedTodayByMode();
            try {
              await supabase.from("b3_simulation_orders").update({
                diagnostic_payload: {
                  exit_evaluation: "stop_safety_net",
                  close_reason: "stop_safety_net",
                  motivo: "preço corrente além do nível de stop e posição ainda aberta",
                  por_que_caminhos_normais_falharam: {
                    hit_stop_tick: hitStop, hit_gain: hitGain, hit_trailing: hitTrailing,
                    intrabar_hit: intrabarHit ? intrabarHit.reason : null,
                    candles_to_eval: candlesToEval.length,
                    candle_incompleto_ignorado: candleIncompletoIgnorado,
                    marcador_antes: marcadorAntes,
                    marcador_depois: open.last_eval_minute_ts ?? null,
                  },
                  stop_level: stopLevel, gain_level: gainLevel,
                  beyond_pts: beyondPts, move_pts: movePts,
                  executed_price: safetyAudit.execution_price,
                  tick_price_at_detection: markPrice,
                  quote_age_s: Number(priceSrc.quote_age_s ?? 0),
                },
              }).eq("id", open.id).eq("user_id", userId);
            } catch { /* diagnóstico nunca derruba o fechamento */ }
            try {
              await supabase.from("system_logs").insert({
                event_type: "stop_safety_net",
                source: `b3:${asset.symbol}:${mode}`,
                severity: "critical",
                message: `Rede de segurança fechou posição ${open.side} ${beyondPts.toFixed(0)} pts além do stop.`,
                technical_data: { order_id: open.id, run_id: runId, mode, symbol: asset.symbol, stop_level: stopLevel, mark_price: markPrice, beyond_pts: beyondPts } as any,
              });
            } catch { /* best-effort */ }
            log.push({ mode, action: "close", reason: "stop_safety_net", price: safetyAudit.execution_price, beyond_pts: beyondPts });
            finalizeAudit(`Rede de segurança: stop atravessado em ${beyondPts.toFixed(0)} pts — posição encerrada.`, {
              last_setup: `Posição ${open.side.toUpperCase()} em gestão`,
              signals: { evaluated_side: open.side, buy: false, sell: false },
            });
            continue;
          } catch (safetyErr) {
            log.push({ mode, action: "safety_net_error", message: (safetyErr as Error).message });
            throw safetyErr;
          }
        }

        // Rede de segurança de OBSERVAÇÃO: se o nível de stop já foi atravessado
        // (por candle M1 ou pelo tick) e ainda assim o tick terminou sem fechar,
        // registra o stop pendente. Nada é fechado aqui.
        await recordPendingStopIfCrossed(mode, m, open, cfg, "nível atravessado e tick encerrado sem execução");

        // ───────── Instrumentação: estado da avaliação, 1x/min por ordem ─────────
        try {
          const minuteKey = Math.floor(Date.now() / 60000);
          if (openEvalLogMinute.get(open.id) !== minuteKey) {
            openEvalLogMinute.set(open.id, minuteKey);
            await supabase.from("b3_simulation_orders").update({
              diagnostic_payload: {
                exit_evaluation: "em_gestao",
                move_pts: movePts,
                stop_level: stopLevel,
                gain_level: gainLevel,
                hit_stop: hitStop,
                hit_gain: hitGain,
                hit_trailing: hitTrailing,
                candles_to_eval: candlesToEval.length,
                primeiro_candle: candlesToEval[0]?.minute_ts ?? null,
                ultimo_candle: candlesToEval[candlesToEval.length - 1]?.minute_ts ?? null,
                marcador_antes: marcadorAntes,
                marcador_depois: open.last_eval_minute_ts ?? null,
                candle_incompleto_ignorado: candleIncompletoIgnorado,
                tick_price: markPrice,
                quote_age_s: Number(priceSrc.quote_age_s ?? 0),
                at: new Date().toISOString(),
              },
            }).eq("id", open.id).eq("user_id", userId);
          }
        } catch { /* instrumentação nunca derruba o motor */ }

      }

      // Cotação antiga bloqueia somente a próxima entrada. Se havia posição,
      // todo o bloco acima já avaliou stop, alvo, trailing, force_close e
      // last_eval_minute_ts usando o último Bid/Ask conhecido.
      if (entryBlockedByQuoteStall) {
        log.push({ mode, action: "skip", reason: "quote_stall_new_entry", stall_s: quoteAgeS, had_open: quoteStalledForMode });
        finalizeAudit(`Cotação interrompida há ${quoteAgeS.toFixed(0)}s — nova entrada bloqueada; gestão de posição preservada.`);
        continue;
      }

      // Robô desativado: a ENTRADA é bloqueada, mas a GESTÃO da posição aberta
      // acima já foi executada. Antes este gate ficava ANTES do bloco de gestão,
      // e por isso posições de robôs desativados nunca eram avaliadas para
      // stop/gain/trailing — causa raiz do stop atravessado sem execução.
      if (cfg.enabled === false) {
        log.push({ mode, action: "skip", reason: "modo_desativado" });
        finalizeAudit("Robô desativado nas configurações.");
        continue;
      }

      // ── FREIO DE GRUPO NO SIMULADO: SOMBRA, NÃO BLOQUEIO (08/09/2026) ──
      // Em 08/09 o freio travou 13 dos 16 robôs de WIN e treze deles
      // produziram UMA observação no dia inteiro. O simulado não tem capital
      // para proteger; ele existe para produzir informação — e não é possível
      // calibrar o freio com dados gerados sob o freio, porque bloquear destrói
      // justamente o contrafactual que justificaria bloquear.
      //
      // A DECISÃO não muda: `decideB3Grupo` segue calculando nível,
      // multiplicador e lista de travados, e segue gravando em
      // b3_grupo_estado_dia. Muda só o EFEITO aqui: a entrada sai, marcada como
      // sombra na ordem, e o espelho para o real é recusado (com registro).
      // Desde 15/09/2026 os freios de PICO, PÓS-META e STOP DIÁRIO seguem a
      // mesma regra no simulado (bloco abaixo). No real todos continuam
      // bloqueando de verdade.
      const sombraFreioGrupo = grupoNivel >= 2 && grupoTravados.includes(mode);
      if (sombraFreioGrupo) {
        const msg = `Freio de grupo nível ${grupoNivel} (SOMBRA — entrada liberada no simulado) ${run.symbol}/${runVariant} — ${textoNivelGrupo(grupoNivel, grupoMultiplicador)}; resultado do grupo ${Number(grupo?.resultado_brl ?? 0).toFixed(2)} BRL. Nenhum comando real será enfileirado.`;
        await recordStatusIfChanged(mode, m, "sombra_grupo", `grupo_nivel_${grupoNivel}_sombra`,
          { observed: Number(grupo?.resultado_brl ?? 0), pnl: realizedToday, message: msg });
        log.push({ mode, action: "sombra_grupo", nivel: grupoNivel });
        // Linha própria no log de decisão: contável e distinguível do bloqueio
        // real, gravada mesmo quando a assinatura do motivo não mudou.
        entryStageRows.push({
          user_id: userId, simulation_run_id: runId, simulation_mode_id: m.id, mode,
          symbol: asset.symbol, entry_style: String((cfg as any).entry_style ?? "indicador"),
          estagio: "freio_grupo_sombra",
          motivo: msg.slice(0, 500),
          detalhe: {
            sombra: true, grupo_nivel: grupoNivel, grupo_multiplicador: grupoMultiplicador,
            grupo_resultado_brl: Number(grupo?.resultado_brl ?? 0),
            travados: grupoTravados, espelho_real: "barrado",
          },
        });
      }

      // ── FREIOS DE RESULTADO EM SOMBRA NO SIMULADO (15/09/2026) ──
      // Em 15/09 cinco robôs de price action do WIN passaram o dia travados
      // pelo freio de pico, num dia que fechou positivo — e não havia nenhuma
      // medição para dizer se travar acertou. Os três freios de RESULTADO
      // (pico, pós-meta e stop diário por robô) passam a registrar em vez de
      // bloquear no simulado, exatamente como o freio de grupo desde 08/09.
      //
      // Os demais bloqueios da proteção continuam bloqueando: falha
      // operacional, volatilidade extrema e drawdown não são freios de
      // resultado — não há contrafactual a medir neles.
      const SOMBRA_POR_ESTADO: Record<string, string> = {
        blocked_peak_giveback: "pico",
        blocked_post_target_loss: "pos_meta",
        blocked_stop: "stop_diario",
      };
      const freioProtecaoSombra = protDec.allow_new_entry
        ? null
        : (SOMBRA_POR_ESTADO[protDec.next.protection_state] ?? null);

      // Bloqueio de proteção B3 substitui o antigo gate "meta atingida".
      if (!protDec.allow_new_entry && !freioProtecaoSombra) {
        await recordStatusIfChanged(mode, m, protDec.next.protection_state, `protection:${protDec.next.protection_state}`,
          { pnl: realizedToday, message: protDec.next.protection_block_reason ?? "Bloqueio pós-meta." });
        log.push({ mode, action: "skip", reason: protDec.next.protection_state });
        finalizeAudit(protDec.next.protection_block_reason ?? "Proteção global/diária bloqueou nova entrada.");
        continue;
      }

      if (freioProtecaoSombra) {
        const motivoProt = protDec.next.protection_block_reason ?? protDec.next.protection_state;
        const msgProt = `${FREIO_LABEL[freioProtecaoSombra]} (SOMBRA — entrada liberada no simulado): ${motivoProt} Nenhum comando real será enfileirado.`;
        await recordStatusIfChanged(mode, m, `sombra_${freioProtecaoSombra}`, `${protDec.next.protection_state}_sombra`,
          { pnl: realizedToday, message: msgProt });
        log.push({ mode, action: `sombra_${freioProtecaoSombra}`, estado: protDec.next.protection_state });
        entryStageRows.push({
          user_id: userId, simulation_run_id: runId, simulation_mode_id: m.id, mode,
          symbol: asset.symbol, entry_style: String((cfg as any).entry_style ?? "indicador"),
          estagio: `freio_${freioProtecaoSombra}_sombra`,
          motivo: msgProt.slice(0, 500),
          detalhe: {
            sombra: true, freio: freioProtecaoSombra,
            protection_state: protDec.next.protection_state,
            realizado_hoje_brl: realizedToday,
            pico_do_dia_brl: Number(protDec.next.day_peak_profit_brl ?? 0),
            espelho_real: "barrado",
          },
        });
      }

      // ── STOP DIÁRIO POR ROBÔ TAMBÉM EM SOMBRA (16/09/2026) ──
      // O stop diário barrava a entrada por um caminho que a sombra não cobria:
      // o agente Risco recebia `daily_loss_limit` e VETAVA, e o veto derruba o
      // score do comitê para 25 — ou seja, o robô parava de entrar sem que
      // nenhum gate de freio aparecesse. Foi o que calou Amanda às 10:11 de
      // 16/09. Agora o limite diário vira RÓTULO no simulado: o estado continua
      // sendo gravado, a ordem nasce marcada com `stop_diario`, e o Risco deixa
      // de vetar por ele (ver `risk` abaixo). No REAL nada muda: o espelho
      // continua recusando comando para qualquer freio acionado.
      const lossHit = realizedToday <= -Number(cfg.daily_loss_limit_brl);

      // Todos os freios que teriam barrado ESTA entrada. Uma entrada pode ser
      // barrada por mais de um ao mesmo tempo — é o que permite julgar um
      // freio contra o outro na medição diária.
      const freiosNaSombra: string[] = [
        ...(sombraFreioGrupo ? ["grupo"] : []),
        ...(freioProtecaoSombra ? [freioProtecaoSombra] : []),
        ...(lossHit && freioProtecaoSombra !== "stop_diario" ? ["stop_diario"] : []),
      ];
      const entradaEmSombra = freiosNaSombra.length > 0;
      // LIBERAÇÃO MANUAL (16/09/2026): a ordem SIMULADA e `freios_na_sombra` não
      // mudam — a medição da sombra tem que continuar limpa, é ela que dirá se
      // essa vontade de destravar é boa ideia ao longo de semanas. Muda só quem
      // barra o ESPELHO: freio liberado pela tela deixa de barrar.
      const freiosBarrandoReal = freiosNaSombra.filter((f) => !freioEstaLiberado(mode, f));
      const espelhoBarradoPorFreio = freiosBarrandoReal.length > 0;
      const entradaSobLiberacao = entradaEmSombra && !espelhoBarradoPorFreio;



      // Diagnóstico visual: rotula o estado atual (sem bloquear gainHit).
      // `lossHit` já foi calculado acima, junto do vetor de freios em sombra.
      if (lossHit) {
        await recordStatusIfChanged(mode, m, "bloqueado_perda_diaria", "daily_loss",
          { observed: realizedToday, limit: -Number(cfg.daily_loss_limit_brl), pnl: realizedToday,
            message: `Limite diário de perda atingido (${realizedToday.toFixed(2)} BRL).` });
      } else if (beforeOpen) {
        await recordStatusIfChanged(mode, m, "aguardando_abertura", "before_open",
          { pnl: realizedToday, message: `Fora da janela de operação — abre às ${cfg.trading_start_time}.` });
      } else if (forceClose) {
        await recordStatusIfChanged(mode, m, "bloqueado_zeragem", "force_close",
          { pnl: realizedToday, message: "Janela de zeragem obrigatória." });

      } else if (!insideHours) {
        await recordStatusIfChanged(mode, m, "bloqueado_horario", "time",
          { pnl: realizedToday, message: "Fora da janela operacional." });
      } else if (macroBlock) {
        await recordStatusIfChanged(mode, m, "bloqueado_risco", "macro_risk",
          { pnl: realizedToday, message: `Evento macro: ${macroBlock.name}.` });
      } else if (ctx.volatility_pct > Number(cfg.max_volatility_pct)) {
        const vdbg = (priceSrc as any).volatility_debug ?? null;
        await recordStatusIfChanged(mode, m, "bloqueado_volatilidade", "volatility",
          { observed: ctx.volatility_pct, limit: Number(cfg.max_volatility_pct), pnl: realizedToday,
            message: `Volatilidade ${ctx.volatility_pct.toFixed(2)}% acima do limite ${Number(cfg.max_volatility_pct).toFixed(2)}%${vdbg ? ` (raw ${vdbg.raw_pct}%, ${vdbg.formula}, amostras ${vdbg.samples})` : ""}.`,
            diagnostic_payload: vdbg ? { volatility_debug: vdbg } : undefined });
      } else if (protDec.next.protection_state === "target_reached_observing") {
        await recordStatusIfChanged(mode, m, "target_reached_observing", "protection",
          { pnl: realizedToday, message: "Meta atingida — em observação (size reduzido)." });
      } else if (protDec.next.protection_state === "profit_protected") {
        await recordStatusIfChanged(mode, m, "profit_protected", "protection",
          { pnl: realizedToday, message: "Lucro protegido (size reduzido)." });
      } else {
        await recordStatusIfChanged(mode, m, "operando", "ok",
          { pnl: realizedToday, message: "Operando normalmente." });
      }

      if (!insideHours || forceClose) {
        log.push({ mode, action: "skip", reason: beforeOpen ? "aguardando_abertura" : !insideHours ? "fora_horario" : "zeragem" });
        finalizeAudit(beforeOpen
          ? `Fora da janela de operação — abre às ${cfg.trading_start_time}.`
          : !insideHours ? "Fora da janela operacional." : "Janela de zeragem obrigatória.");
        continue;
      }

      if (macroBlock) {
        log.push({ mode, action: "skip", reason: `macro:${macroBlock.name}` });
        if (sigChanged(`block:${mode}`, `macro:${macroBlock.name}`)) {
          await patchMode(m, { risk_blocks: (Number(m.risk_blocks) || 0) + 1 });
        }
        finalizeAudit(`Proteção global: evento macro ${macroBlock.name}.`);
        continue;
      }

      if (open) {
        finalizeAudit("Posição já aberta — motor apenas gerencia stop/gain/zeragem.", {
          last_setup: `Posição ${open.side.toUpperCase()} aberta`,
          signals: { evaluated_side: open.side, buy: false, sell: false },
        });
        continue;
      }

      // Se protegido/observando, elevamos o daily_gain_target passado ao Risco
      // para não bloquear por "meta atingida" — a decisão de continuar já foi tomada aqui.
      const inProtectionRun = protDec.next.protection_state === "target_reached_observing"
        || protDec.next.protection_state === "profit_protected";
      const risk: B3RiskState = {
        daily_loss_limit: Number(cfg.daily_loss_limit_brl),
        daily_gain_target: inProtectionRun ? Number.MAX_SAFE_INTEGER : Number(cfg.daily_gain_target_brl),
        realized_today_brl: realizedToday,
        open_contracts: 0,
        max_contracts: Number(cfg.max_contracts),
        requested_qty: 1,
        inside_hours: insideHours,
        force_close_now: forceClose,
        strategy_mode: mode as B3RiskState["strategy_mode"],
      };
      const localCtx = { ...ctx };
      if (localCtx.volatility_pct > Number(cfg.max_volatility_pct)) {
        if (sigChanged(`block:${mode}`, "volatility")) {
          await patchMode(m, { risk_blocks: (Number(m.risk_blocks) || 0) + 1 });
        }

        log.push({ mode, action: "skip", reason: "volatilidade" });
        finalizeAudit("Bloqueado por volatilidade.");
        continue;
      }

      // Classificação de setup técnico ANTES do comitê: modalidades contrárias
      // à tendência (mean_reversion, range) escolhem o próprio lado, e o comitê
      // precisa julgar o lado que será realmente operado — antes ele votava no
      // lado do cruzamento de médias e a ordem saía no lado oposto.
      const setupInfo = classifySetupFor(cfg.entry_style, {
        ctxLocal: localCtx, derived, intendedSide, cfg, m1Candles,
      });
      const effectiveSide: B3Side = setupInfo.side_override ?? intendedSide;
      if (setupInfo.side_override && setupInfo.side_override !== intendedSide) {
        snapshotExtra.side_overrides = {
          ...(snapshotExtra.side_overrides ?? {}),
          [mode]: { entry_style: String(cfg.entry_style ?? "indicador"), engine_side: intendedSide, classifier_side: setupInfo.side_override },
        };
      }
      const setupAllowed = setupInfo.name !== "no_valid_setup" && setupInfo.ok;
      addCheck(
        "setup",
        "Setup técnico",
        setupAllowed,
        setupAllowed
          ? `${setupInfo.name} validado${setupInfo.side_override ? ` (lado ${setupInfo.side_override.toUpperCase()} escolhido pelo setup)` : ""}`
          : `${setupInfo.name}${setupInfo.reasons.length ? ` — ${setupInfo.reasons.join("; ")}` : ""}`,
      );

      // Modalidades que derivam o próprio lado não podem herdar intendedSide
      // (contra-tendência: esticão/borda; rompimento: borda rompida). Quando o
      // classificador ainda não conseguiu derivar um lado, o setup termina
      // aqui; o comitê nunca é consultado com o lado das médias.
      const classifierSideStyle = cfg.entry_style === "mean_reversion" || cfg.entry_style === "range" || cfg.entry_style === "rompimento" || cfg.entry_style === "pullback" || cfg.entry_style === "vwap";
      if (classifierSideStyle && !setupInfo.side_override) {
        const reason = `Setup ${setupInfo.name} — ${setupInfo.reasons.join("; ") || "lado ainda não derivado pelo classificador"}`;
        log.push({ mode, action: "reject", reason: "no_classifier_side", setup: setupInfo.name });
        finalizeAudit(reason, {
          last_setup: `Bloqueado: ${setupInfo.name}`,
          signals: { evaluated_side: null, buy: false, sell: false },
          setup: setupInfo,
        });
        continue;
      }

      // Agentes recebem os limites REAIS do modo — sem isso os 5 modos
      // avaliavam o mesmo tick com constantes idênticas (3,5% / 150-300 pts).
      // O piso de volatilidade vem de `lateral_vol_min` (portão de lateralidade).
      const votes = runB3Agents(localCtx, effectiveSide, risk, {
        max_volatility_pct: Number(cfg.max_volatility_pct),
        min_volatility_pct: Number((cfg as any).lateral_vol_min ?? 0.3),
        lateral_strength_min: Number((cfg as any).lateral_strength_min ?? 30),
        // Modalidades com níveis dinâmicos (rompimento) apresentam ao comitê os
        // níveis que a ordem vai carregar, não os fixos da configuração.
        stop_pts: Number(setupInfo.stop_pts_override ?? cfg.stop_pts),
        gain_pts: Number(setupInfo.gain_pts_override ?? cfg.gain_pts),
        entry_style: String((cfg as any).entry_style ?? "indicador"),
      });

      const committee: B3CommitteeSettings = {
        min_approve_votes: Number(cfg.min_approve_votes),
        min_confidence: Number(cfg.min_confidence),
        min_score: Number(cfg.min_score),
      };
      const decision = buildB3Decision(votes, effectiveSide, committee);
      addCheck("score", "Score", Number(decision.score) >= Number(cfg.min_score), `${decision.score.toFixed(0)} / mínimo ${Number(cfg.min_score).toFixed(0)}`);
      addCheck("confidence", "Confiança", Number(decision.avg_confidence) >= Number(cfg.min_confidence), `${decision.avg_confidence.toFixed(0)} / mínimo ${Number(cfg.min_confidence).toFixed(0)}`);
      addCheck("committee", "Comitê", decision.final === "approved", decision.justification);
      addCheck("signal_buy", "Sinal BUY", decision.final === "approved" && effectiveSide === "buy", effectiveSide === "buy" ? decision.final : "lado avaliado SELL", false);
      addCheck("signal_sell", "Sinal SELL", decision.final === "approved" && effectiveSide === "sell", effectiveSide === "sell" ? decision.final : "lado avaliado BUY", false);

      // Telemetria por modo dos limiares de lateralidade efetivamente aplicados.
      {
        const tTel = classifyTrend(localCtx, Number(asset?.trend_strength_factor ?? 5));
        snapshotExtra.lateral_gates = {
          ...(snapshotExtra.lateral_gates ?? {}),
          [mode]: {
            trend_direction: tTel.direction,
            trend_strength: tTel.strength,
            volatility: Number(localCtx.volatility_pct ?? 0),
            lateral_strength_min: Number((cfg as any).lateral_strength_min ?? 30),
            lateral_vol_min: Number((cfg as any).lateral_vol_min ?? 0.3),
          },
        };
      }


      // Votos: gravados só quando o comitê muda (mesmo veredito em ticks
      // seguidos não gera novas linhas). Nenhuma regra de decisão é alterada.
      const voteSig = `${decision.final}|${effectiveSide}|${votes.map(v => `${v.agent_name}:${v.vote}:${Math.round(Number(v.confidence) || 0)}`).join(",")}`;
      if (sigChanged(`votes:${mode}`, voteSig)) {
        const voteRows = votes.map(v => ({
          simulation_run_id: runId, simulation_mode_id: m.id, user_id: userId,
          mode, agent_name: v.agent_name, vote: v.vote, confidence: v.confidence, reason: v.reason,
          // CONTEXTO DO TIQUE NÃO VIAJA MAIS EM CADA VOTO (15/09/2026).
          // Antes cada agente repetia o mesmo objeto de mercado: era
          // praticamente a tabela inteira (568 MB). O contexto do tique fica em
          // b3_simulation_market_snapshots (uma linha por tique persistido) e o
          // estado corrente em b3_engine_state; a ligação é tick_snapshot_id.
          tick_snapshot_id: snapId,
          decision: decision.final,
          score: decision.score,
          side: effectiveSide,
          has_veto: v.has_veto ?? false,
          veto_reason: v.veto_reason ?? null,
          market_data_snapshot: {} as any,
        })) as any[];
        // Instrumentação: guardamos os ids inseridos para vincular à ordem
        // criada neste mesmo tique/modo (order_id só existe depois do insert).
        try {
          const { data: insertedVotes } = await (supabase as any)
            .from("b3_simulation_agent_votes").insert(voteRows).select("id");
          lastVoteIdsByMode[mode] = (insertedVotes ?? []).map((r: any) => r.id);
        } catch {
          await (supabase as any).from("b3_simulation_agent_votes").insert(voteRows);
        }
      }


      if (decision.final === "approved" && !setupAllowed) {
        // Comitê aprovou, mas o setup técnico não é operável (Fase 1: só trend_pullback).
        const reason = `Setup ${setupInfo.name} — ${setupInfo.reasons.join("; ") || "critérios de trend_pullback não atendidos"}`;
        if (sigChanged(`block:${mode}`, `no_valid_setup:${setupInfo.name}`)) {
          await patchMode(m, { committee_rejections: (Number(m.committee_rejections) || 0) + 1 });
        }

        log.push({ mode, action: "reject", reason: "no_valid_setup", setup: setupInfo.name, side: effectiveSide });
        finalizeAudit(reason, {
          last_analysis: decision.justification,
          last_score: decision.score,
          last_confidence: decision.avg_confidence,
          last_setup: `Bloqueado: ${setupInfo.name}`,
          signals: { evaluated_side: effectiveSide, buy: false, sell: false },
          committee: decision,
          setup: setupInfo,
        });
      } else if (decision.final === "approved") {
        let entryAudit: B3QuoteExecutionAudit;
        try {
          entryAudit = getB3ExecutionAudit(priceSrc, effectiveSide, "entry", "runB3SimulationTick.openOrder");
          if (priceSrc.source === "mt5_xp_demo") assertB3StrictMt5ExecutionAudit(entryAudit, "runB3SimulationTick.openOrder", asset.symbol);
          providerStats.last_price_function = entryAudit.execution_price_origin;
        } catch (e) {
          await recordStatusIfChanged(mode, m, "erro_tecnico", "price_source_guard", {
            pnl: realizedToday,
            message: (e as Error).message,
            provider_name: priceSrc.provider_name,
            price_source: priceSrc.quote_source,
            rejected_price: ctx.price,
            mt5_last: priceSrc.raw?.last ?? null,
            forceLog: false,
            diagnostic_payload: { function: "runB3SimulationTick.openOrder", attempted_context_price: ctx.price, ...quoteAuditBase(priceSrc) },
          });
          log.push({ mode, action: "blocked", reason: "price_guard", message: (e as Error).message });
          finalizeAudit((e as Error).message, {
            last_analysis: decision.justification,
            last_score: decision.score,
            last_confidence: decision.avg_confidence,
            last_setup: `Setup ${effectiveSide.toUpperCase()} aprovado, bloqueado no preço`,
            signals: { evaluated_side: effectiveSide, buy: effectiveSide === "buy", sell: effectiveSide === "sell" },
            committee: decision,
            setup: setupInfo,
          });
          continue;
        }
        if (priceSrc.source !== "mt5_xp_demo") {
          const slip = Number(run.simulated_slippage_pts) || 0;
          entryAudit = {
            ...entryAudit,
            execution_price: roundToTick(effectiveSide === "buy" ? entryAudit.execution_price + slip : entryAudit.execution_price - slip, Number(asset.tick_size)),
            execution_price_origin: `${entryAudit.execution_price_origin}+legacy_slippage`,
          };
        }
        const entry = entryAudit.execution_price;
        // Base de contratos = configuração do modo (Conservador=1, Moderado=2,
        // Equilibrado=3, Semi_agressivo=4, Agressivo=3), não mais fixa em 1.
        // O multiplicador de proteção de risco (size_multiplier) continua
        // reduzindo o tamanho quando o motor de risco pede cautela — ele
        // agora reduz a partir da base certa, em vez de reduzir 1 contrato.
        const baseQty = Number(cfg.max_contracts) || 1;
        // Entrada em sombra por freio de resultado sai no TAMANHO DO ROBÔ: o
        // multiplicador da proteção é zero quando ela bloqueia, e usar zero aqui
        // faria a amostra livre sair com 1 contrato — livre e sombra deixariam
        // de ser comparáveis.
        const sizeMulEfetivo = freioProtecaoSombra ? 1 : protDec.size_multiplier;
        const qtyProt = Math.max(1, Math.round(baseQty * Math.max(0.05, sizeMulEfetivo)));
        // Freio de grupo no simulado não reduz contratos (é sombra, item 1 de
        // 08/09/2026): a amostra tem de sair no tamanho do robô, senão o
        // resultado livre não é comparável ao sombra. `aplicarFatorContratos`
        // segue existindo e valendo para o caminho real.
        const qty = qtyProt;
        const qtySeFreioValesse = grupoNivel >= 1 ? aplicarFatorContratos(qtyProt, grupoMultiplicador) : qtyProt;


        // ── CONTRATO DE SAÍDA CONGELADO NA ABERTURA (08/09/2026) ──
        // `stop_pts` estava NULO em 100% das ordens: o nível só existia na
        // configuração do modo, então o guardião o recalculava a cada passada
        // e uma mudança de configuração alterava o stop de posição já aberta.
        // Agora o nível efetivo (override da modalidade OU configuração
        // vigente neste instante) é gravado NA ORDEM, em pontos e em preço
        // absoluto. Mudar a configuração depois não muda mais nada aqui.
        const entryRounded = roundToTick(entry, Number(asset.tick_size));
        const dirSignEntry = effectiveSide === "buy" ? 1 : -1;
        const stopPtsFrozen = Math.max(0, Number(setupInfo.stop_pts_override ?? cfg.stop_pts ?? 0) || 0);
        const gainPtsFrozen = Math.max(0, Number(setupInfo.gain_pts_override ?? cfg.gain_pts ?? 0) || 0);
        const stopPriceFrozen = stopPtsFrozen > 0
          ? roundToTick(entryRounded - dirSignEntry * stopPtsFrozen, Number(asset.tick_size)) : null;
        const targetPriceFrozen = gainPtsFrozen > 0
          ? roundToTick(entryRounded + dirSignEntry * gainPtsFrozen, Number(asset.tick_size)) : null;

        const orderPayload: any = {
          simulation_run_id: runId, simulation_mode_id: m.id, user_id: userId,
          mode, symbol: asset.quote_symbol, contract_code: asset.contract_code, side: effectiveSide,
          entry_price: entryRounded, quantity: qty,
          // taxa da ponta de entrada, derivada do perfil do ativo
          fees: computeB3Fees({ assetProfile: asset, quantity: qty, entryPrice: entry }), status: "open",
          stop_pts: stopPtsFrozen > 0 ? stopPtsFrozen : null,
          gain_pts: gainPtsFrozen > 0 ? gainPtsFrozen : null,
          stop_price: stopPriceFrozen,
          target_price: targetPriceFrozen,
          // Sombra: esta ordem existiria no simulado mas não no real. É o que
          // separa resultado livre de resultado sombra e o que mantém a
          // curadoria fiel ao que o dinheiro real faria. O vetor diz QUAL freio
          // a teria barrado; o booleano continua sendo "algum freio barraria".
          bloqueado_na_sombra: entradaEmSombra,
          freios_na_sombra: freiosNaSombra,
          nivel_freio_na_abertura: grupoNivel,

          ...orderAuditPatch(entryAudit),
        };
        // Instrumentação permanente do veredito do comitê na própria ordem.
        // b3_simulation_orders está fora da retenção — o histórico não se perde.
        // Regra: valor ausente vira NULL (nulo é informação, zero é mentira).
        const numOrNull = (v: any) => (v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));
        const instrumentation: any = {
          entry_score: numOrNull(decision.score),
          entry_confidence: numOrNull(decision.avg_confidence),
          entry_approve_votes: numOrNull((decision as any).approve_votes),
          entry_setup: setupInfo?.name ?? null,
        };
        let insertedOrder: { id: string } | null = null;
        {
          const res = await (supabase as any).from("b3_simulation_orders")
            .insert({ ...orderPayload, ...instrumentation }).select("id").single();
          if (res.error) {
            // A instrumentação nunca pode impedir a abertura da ordem — mas a
            // falha precisa ficar visível para diagnóstico (ex.: schema cache).
            try {
              await supabase.from("system_logs").insert({
                event_type: "entry_instrumentation_insert_failed",
                source: `b3:${asset.symbol}:${mode}`,
                severity: "error",
                message: `Ordem aberta SEM instrumentação de entrada: ${res.error.message}`,
                technical_data: {
                  run_id: runId, mode, symbol: asset.quote_symbol,
                  pg_code: (res.error as any).code ?? null,
                  instrumentation,
                } as any,
              });
            } catch { /* log nunca derruba o motor */ }
            const retry = await (supabase as any).from("b3_simulation_orders")
              .insert(orderPayload).select("id").single();
            if (retry.error) {
              // Última linha de defesa de REGISTRO: se a validação de preço
              // (trigger de auditoria de execução) recusar a linha, a ordem NÃO
              // pode simplesmente desaparecer do banco — ordem que some não é
              // auditável nem reconciliável depois. Grava com status
              // 'rejected' (a trigger ignora 'rejected') e o erro anexado.
              const rejeitada = await (supabase as any).from("b3_simulation_orders")
                .insert({
                  ...orderPayload,
                  status: "rejected",
                  close_reason: `rejected: ${retry.error.message}`.slice(0, 400),
                  diagnostic_payload: {
                    ...(orderPayload.diagnostic_payload ?? {}),
                    rejected: {
                      at: new Date().toISOString(),
                      pg_code: (retry.error as any).code ?? null,
                      pg_message: retry.error.message,
                      first_error: res.error.message,
                      instrumentation,
                      payload: orderPayload,
                    },
                  },
                }).select("id").single();
              try {
                await supabase.from("system_logs").insert({
                  event_type: rejeitada.error ? "ordem_rejeitada_nao_registrada" : "ordem_rejeitada_registrada",
                  source: `b3:${asset.symbol}:${mode}`,
                  severity: rejeitada.error ? "critical" : "warning",
                  message: rejeitada.error
                    ? `Ordem recusada E não registrada: ${retry.error.message} / ${rejeitada.error.message}`
                    : `Ordem recusada pela validação de preço e REGISTRADA como 'rejected': ${retry.error.message}`,
                  technical_data: {
                    run_id: runId, mode, symbol: asset.quote_symbol, side: effectiveSide,
                    pg_code: (retry.error as any).code ?? null,
                    order_id: rejeitada.data?.id ?? null,
                    payload: orderPayload,
                  } as any,
                });
              } catch { /* log nunca derruba o motor */ }
              // Nada de espelhar real nem seguir como se a ordem existisse.
              log.push({ mode, action: "blocked", reason: "order_rejected", message: retry.error.message });
              continue;
            }
            insertedOrder = retry.data;

          } else {
            insertedOrder = res.data;
          }
        }
        // Vincula os votos deste tique/modo à ordem criada (order_id).
        try {
          const ids = lastVoteIdsByMode[mode] ?? [];
          if (ids.length && insertedOrder?.id) {
            await (supabase as any).from("b3_simulation_agent_votes")
              .update({ order_id: insertedOrder.id })
              .in("id", ids).is("order_id", null).eq("user_id", userId);
            delete lastVoteIdsByMode[mode];
          }
        } catch { /* instrumentação nunca derruba o motor */ }

        if (!insertedOrder) throw new Error("Falha ao criar ordem simulada");

        markAuditEvent(`abertura:${mode}:${effectiveSide}`);
        if (espelhoBarradoPorFreio) {
          // NO REAL, NADA MUDA: o espelho recusa a abertura quando QUALQUER
          // freio está acionado. A recusa é registrada — sem isso não há como
          // contar quantas entradas reais foram puladas, e a diferença entre o
          // resultado simulado e o real pareceria erro de conciliação.
          const freiosTexto = freiosBarrandoReal.map((f) => FREIO_LABEL[f] ?? f).join(" + ");
          markAuditEvent(`espelho_barrado:${mode}:${freiosBarrandoReal.join("+")}`);
          try {
            await supabase.from("system_logs").insert({
              event_type: "b3_espelho_barrado_freio",
              source: "b3-simulation-tick",
              severity: "warning",
              message: `[${asset.quote_symbol}/${runVariant}/${mode}] abertura ${effectiveSide.toUpperCase()} liberada no simulado e RECUSADA no real — ${freiosTexto}.`,
              technical_data: {
                // Magic vem do banco (única fonte da fórmula). Aqui é registro:
                // se a RPC falhar, fica nulo e o resto do log continua valendo.
                magic: (await supabase.rpc("b3_magic", {
                  p_symbol: rootSymbol(asset.quote_symbol), p_variant: runVariant, p_mode: mode,
                }).then((r: any) => r?.data ?? null).catch(() => null)),
                symbol: rootSymbol(asset.quote_symbol), quote_symbol: asset.quote_symbol,
                variant: runVariant, mode,
                freios_na_sombra: freiosNaSombra,
                freios_barrando_real: freiosBarrandoReal,
                grupo_nivel: grupoNivel,
                grupo_multiplicador: grupoMultiplicador,
                grupo_resultado_brl: Number(grupo?.resultado_brl ?? 0),
                protection_state: protDec.next.protection_state,
                simulation_order_id: insertedOrder.id,
                quantidade_simulada: qty, quantidade_se_freio_valesse: qtySeFreioValesse,
                side: effectiveSide,
              },
            });
            // Contagem única de recusas de abertura real (14/09/2026): todo
            // motivo cai no mesmo event_type, para dar para contar num lugar só.
            const motivoRecusa = freiosBarrandoReal.includes("grupo")
              ? "freio_de_grupo" : `freio_${freiosBarrandoReal[0]}`;
            await supabase.from("system_logs").insert({
              event_type: "b3_espelho_nao_abriu",
              source: `b3_real_mirror:${asset.quote_symbol}:${runVariant}:${mode}`,
              severity: "warning",
              message: `Abertura real NÃO enfileirada (${motivoRecusa}): ${freiosTexto}.`,
              technical_data: {
                motivo: motivoRecusa,
                freios_na_sombra: freiosNaSombra,
                freios_barrando_real: freiosBarrandoReal,
                symbol: asset.quote_symbol, variant: runVariant, mode, side: effectiveSide,
                run_id: runId, grupo_nivel: grupoNivel, grupo_multiplicador: grupoMultiplicador,
                protection_state: protDec.next.protection_state,
                simulation_order_id: insertedOrder.id,
              } as any,
            });
          } catch { /* registro nunca derruba o motor */ }
        } else {
          await mirrorToReal(supabase, userId, runId, mode as Mode, "open", effectiveSide, `open-${insertedOrder.id}`, "engine_auto", asset.quote_symbol, runVariant, {
            stop_pts: stopPtsFrozen > 0 ? stopPtsFrozen : null,
            gain_pts: gainPtsFrozen > 0 ? gainPtsFrozen : null,
            stop_price: stopPriceFrozen,
            target_price: targetPriceFrozen,
          }, entradaSobLiberacao);
          if (entradaSobLiberacao) {
            // Ordem real que existe por decisão de UMA PESSOA, não por regra do
            // sistema. Fica contável ao lado de manual_close_user.
            try {
              await supabase.from("system_logs").insert({
                event_type: "b3_espelho_abriu_sob_liberacao",
                source: `b3_real_mirror:${asset.quote_symbol}:${runVariant}:${mode}`,
                severity: "warning",
                message: `Abertura real enfileirada SOB LIBERAÇÃO MANUAL (${freiosNaSombra.join(", ")} ignorado(s)) — ${asset.quote_symbol}/${runVariant}/${mode}.`,
                technical_data: {
                  freios_na_sombra: freiosNaSombra, liberacao_manual: true,
                  symbol: asset.quote_symbol, variant: runVariant, mode, side: effectiveSide,
                  run_id: runId, simulation_order_id: insertedOrder.id,
                } as any,
              });
            } catch { /* registro nunca derruba o motor */ }
          }
        }


        providerStats.last_entry_price = entry;
        openOrdersCache = null; ordersMutated = true;
        await patchMode(m, {
          committee_approvals: (Number(m.committee_approvals) || 0) + 1,
          contracts_traded: (Number(m.contracts_traded) || 0) + qty,
        });
        log.push({ mode, action: "open", side: effectiveSide, price: entry, score: decision.score, source: entryAudit.quote_source, origin: entryAudit.execution_price_origin, setup: setupInfo.name });
        finalizeAudit(`Setup ${setupInfo.name} ${effectiveSide.toUpperCase()} aprovado e ordem simulada aberta.`, {
          last_analysis: decision.justification,
          last_score: decision.score,
          last_confidence: decision.avg_confidence,
          last_setup: `${setupInfo.name} ${effectiveSide.toUpperCase()}`,
          signals: { evaluated_side: effectiveSide, buy: effectiveSide === "buy", sell: effectiveSide === "sell" },
          committee: decision,
          setup: setupInfo,
        });
      } else {
        const field = decision.final === "blocked" ? "risk_blocks" : "committee_rejections";
        if (sigChanged(`block:${mode}`, `${decision.final}:${field}`)) {
          await patchMode(m, { [field]: (Number(m[field]) || 0) + 1 });
        }
        log.push({ mode, action: "reject", final: decision.final, score: decision.score });
        finalizeAudit(finalReasonFromDecision(decision, committee), {
          last_analysis: decision.justification,
          last_score: decision.score,
          last_confidence: decision.avg_confidence,
          last_setup: "Nenhum setup aprovado",
          signals: { evaluated_side: intendedSide, buy: false, sell: false },
          committee: decision,
          setup: setupInfo,
        });
      }
      } catch (modeErr: any) {
        const elapsedMs = Date.now() - modeT0;
        log.push({ mode, action: "error", message: modeErr?.message ?? String(modeErr), elapsed_ms: elapsedMs });
        try {
          await supabase.from("system_logs").insert({
            event_type: "b3_mode_error",
            source: "b3-simulation-tick",
            severity: "error",
            message: String(modeErr?.message ?? modeErr),
            technical_data: {
              run_id: runId,
              symbol: run?.symbol ?? asset?.symbol ?? null,
              variant: run?.variant ?? null,
              mode,
              stack: String(modeErr?.stack ?? "").slice(0, 2000),
              elapsed_ms: elapsedMs,
            },
          });
        } catch { /* log nunca deve derrubar o tick */ }
        continue;
      } finally {
        // UMA gravação de estado e NO MÁXIMO um evento de status por robô por
        // passada. O status intermediário não vira linha no banco.
        const mid = modeByName[mode]?.id ?? null;
        try { await flushStatusEvent(mid); } catch { /* auditoria não derruba o tique */ }
        try { await flushModeWrite(mid); } catch { /* estado não derruba o tique */ }
        if (mid) statusTickStart.delete(mid);
        modeTimings[mode] = Date.now() - modeT0;
      }
    }

    // Estado de robôs alterado fora do laço (ex.: reconciliação de totais).
    await flushAllModeWrites();

    // Um único INSERT por tique com os robôs cujo motivo de recusa MUDOU.
    // Falha em silêncio: diagnóstico nunca derruba nem atrasa o motor.
    if (entryStageRows.length) {
      try {
        await supabase.from("b3_entry_decision_log").insert(entryStageRows);
        log.push({ action: "entry_stage_log", rows: entryStageRows.length });
      } catch (e: any) {
        log.push({ action: "entry_stage_log_erro", error: String(e?.message ?? e) });
      }
    }

    // MEDIÇÃO DIÁRIA DO FREIO DE GRUPO: os dois caminhos, todo dia.
    // No máximo uma consolidação por minuto por grupo (o acumulado do pregão
    // não muda em segundos); na zeragem de fim de pregão a consolidação é
    // forçada, e a virada do dia já força por trocar a chave do dia.
    try {
      const { atualizarGrupoSombraDia } = await import("./b3-grupo-sombra.server");
      const sombra = await atualizarGrupoSombraDia(
        supabase, userId, runId, rootSymbol(run.symbol), runVariant, b3DayKeyBRT(new Date()),
        { force: zeragemNoTique },
      );
      if (sombra) {
        const { por_modo: _porModo, ...resumo } = sombra;
        log.push({ action: "grupo_sombra_dia", ...resumo, robos: Object.keys(_porModo).length });
      }
    } catch (e: any) {
      log.push({ action: "grupo_sombra_dia_erro", error: String(e?.message ?? e) });
    }
    snapshotExtra.timings = {
      total_ms: Date.now() - runT0,
      por_modo: modeTimings,
    };
    const auditCompleto = auditEvents.length > 0;
    snapshotExtra.audit_level = auditCompleto ? "completo" : "resumido";
    snapshotExtra.audit_events = auditCompleto ? auditEvents.slice(0, 20) : [];
    // O objeto de auditoria e as assinaturas de escrita NÃO vão mais para o
    // snapshot (eram 47% e 29% do campo `extra`). Aqui fica só o resumo
    // compacto por robô, que é o que os contadores das telas de diagnóstico
    // percorrem ao longo do tempo.
    const engineAuditAtual = auditCompleto ? tickAudit : slimEngineAudit(tickAudit);
    snapshotExtra.engine_digest = buildEngineDigest(tickAudit, auditCompleto);
    // Persistência única: 1 INSERT a cada 10s. Fora da janela, nada é gravado
    // (sem INSERT, UPDATE ou UPSERT) — o estado corrente vive só em memória.
    if (persistSnapshot) {
      const { data: snapIns, error: sErr } = await supabase.from("b3_simulation_market_snapshots")
        .insert({ simulation_run_id: runId, user_id: userId, ...snapPayload, extra: snapshotExtra })
        .select("id").single();
      if (sErr) throw sErr;
      memo.id = snapIns.id;
      memo.persisted_at = now.getTime();
      tickAudit.snapshot_id = snapIns.id;
      engineAuditAtual.snapshot_id = snapIns.id;

      // Estado CORRENTE do motor: uma linha por execução, atualizada no lugar.
      // A tabela não cresce e o cockpit continua lendo exatamente o mesmo objeto.
      // Falha aqui não derruba o motor — é registro de diagnóstico.
      try {
        await supabase.from("b3_engine_state").upsert({
          user_id: userId,
          simulation_run_id: runId,
          symbol: run.symbol ?? asset.symbol ?? null,
          variant: runVariant,
          trade_date: new Date(now.getTime() - 3 * 3600_000).toISOString().slice(0, 10),
          engine_audit: engineAuditAtual,
          write_sigs: writeSigs,
          tick_guard: tickGuardFull,
          counters: { audit_level: snapshotExtra.audit_level, audit_events: snapshotExtra.audit_events, timings: snapshotExtra.timings },
          last_snapshot_id: snapIns.id,
          market_time: now.toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id,simulation_run_id" });
      } catch (e: any) {
        log.push({ action: "engine_state_erro", error: String(e?.message ?? e) });
      }
    }
    log.push({ action: "engine_audit", audit_level: snapshotExtra.audit_level, audit_events: auditEvents, snapshot_id: memo.id, persisted: persistSnapshot, modes: tickAudit.modes.map((m: any) => ({ mode: m.mode, final_reason: m.last_refusal_reason, first_stop: m.first_stop?.label ?? null })) });



  }

  return { ok: true, processed: ticks, log: [{ action: "provider_diagnostic", ...providerStats }, ...log] };
}

export const tickB3Simulation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { run_id: string; ticks?: number }) => d)
  .handler(async ({ data, context }) => {
    return runB3SimulationTick(context.supabase, context.userId, data.run_id, data.ticks ?? 1);
  });

// ─────────────────── Escopo de sessão diária ───────────────────
// Retorna todos os runs que compartilham o session_day_id do run mais recente
// (rodando, pausado ou finalizado). Reinícios no mesmo dia = mesmo session_day_id
// = execuções consolidadas no diagnóstico.
async function resolveSessionScope(supabase: any, userId: string) {
  const { data: latest } = await supabase.from("b3_simulation_runs")
    .select("id, status, started_at, ended_at, session_day_id, session_date, symbol")
    .eq("user_id", userId)
    .order("started_at", { ascending: false })
    .limit(1).maybeSingle();
  if (!latest) return { latest: null, runs: [] as any[], runIds: [] as string[], executions: [] as any[], restartCount: 0 };
  const sid = latest.session_day_id;
  let runs: any[] = [];
  if (sid) {
    const { data } = await supabase.from("b3_simulation_runs")
      .select("id, status, started_at, ended_at, session_day_id, session_date, symbol, notes")
      .eq("user_id", userId).eq("session_day_id", sid)
      .order("started_at", { ascending: true });
    runs = data ?? [latest];
  } else {
    runs = [latest];
  }
  const executions = runs.map((r) => {
    const start = new Date(r.started_at).getTime();
    const end = r.ended_at ? new Date(r.ended_at).getTime() : Date.now();
    return {
      run_id: r.id,
      status: r.status,
      started_at: r.started_at,
      finished_at: r.ended_at,
      duration_s: Math.max(0, Math.round((end - start) / 1000)),
      ongoing: !r.ended_at,
    };
  });
  return {
    latest,
    runs,
    runIds: runs.map((r) => r.id),
    executions,
    restartCount: Math.max(0, executions.length - 1),
    sessionDate: latest.session_date,
    sessionDayId: sid,
  };
}

export const getB3EngineDiagnostic = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const scope = await resolveSessionScope(supabase as any, userId);
    if (!scope.latest) return { run: null, audit: null, snapshot: null, settings: [], price_source: null, executions: [], restart_count: 0, session_date: null };
    const activeRun = scope.runs.find((r) => r.status === "running" || r.status === "paused") ?? scope.latest;
    const [{ data: snapshot }, { data: settings }, { data: tradeSettings }, { data: engineState }] = await Promise.all([
      (supabase as any).from("b3_simulation_market_snapshots")
        .select("id, market_time, price, volume, vwap, source, quote_source, quote_server, quote_symbol, quote_tick_ts, quote_bid, quote_ask, quote_last, provider_name, extra")
        .in("simulation_run_id", scope.runIds).eq("user_id", userId)
        .order("market_time", { ascending: false }).limit(1).maybeSingle(),

      (supabase as any).from("b3_simulation_mode_settings").select("*")
        .eq("simulation_run_id", activeRun.id).eq("user_id", userId),
      (supabase as any).from("b3_trading_settings").select("price_source")
        .eq("user_id", userId).maybeSingle(),
      // Estado CORRENTE do motor: uma linha por execução, atualizada no lugar.
      (supabase as any).from("b3_engine_state").select("engine_audit, tick_guard, market_time, updated_at")
        .in("simulation_run_id", scope.runIds).eq("user_id", userId)
        .order("market_time", { ascending: false }).limit(1).maybeSingle(),
    ]);
    // Preferimos o estado corrente; snapshots antigos (antes da migração)
    // seguem servindo de reserva para não deixar a tela vazia.
    const audit = (engineState as any)?.engine_audit
      ?? (snapshot ? engineAuditFromSnapshot(snapshot) : null);
    return {
      run: activeRun,
      snapshot: snapshot ?? null,
      audit,
      settings: settings ?? [],
      price_source: tradeSettings?.price_source ?? "csv",
      executions: scope.executions,
      restart_count: scope.restartCount,
      session_date: scope.sessionDate,
    };
  });



// ─────────────────── Pipeline de Diagnóstico (read-only) ───────────────────
// Agrega os últimos snapshots com engine_audit e produz, por robô:
//   - a última execução do pipeline (etapas ordenadas com valor observado × limite)
//   - contadores (ticks, entradas analisadas, bloqueadas, autorizadas, buy/sell, ordens)
//   - histórico dos últimos 100 bloqueios
// NÃO altera regras nem parâmetros — só lê snapshots já existentes.
const PIPELINE_STEP_ORDER = [
  "tick_received",
  "valid_quote",
  "mt5_server",
  "mt5_symbol",
  "market_open",
  "time_allowed",
  "operation_window",
  "force_close_window",
  "spread",
  "global_protection",
  "mode_enabled",
  "volatility",
  "max_trades",
  "daily_loss",
  "daily_target",
  "position_open",
  "protection_engine",
  "score",
  "confidence",
  "committee",
  "signal_buy",
  "signal_sell",
] as const;

export const getB3PipelineAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const scope = await resolveSessionScope(supabase as any, userId);
    const run = scope.latest;
    if (!run) return { run: null, modes: [], history: [], totals: null, executions: [], restart_count: 0, session_date: null };

    const { data: snaps } = await (supabase as any).from("b3_simulation_market_snapshots")
      .select("id, market_time, extra, simulation_run_id")
      .in("simulation_run_id", scope.runIds).eq("user_id", userId)
      .order("market_time", { ascending: false })
      .limit(400);

    // Estado do motor: o histórico vem do resumo compacto do snapshot, e a
    // última execução completa do pipeline vem de b3_engine_state.
    const list = (snaps ?? [])
      .map((s: any) => ({ ...s, __audit: engineAuditFromSnapshot(s) }))
      .filter((s: any) => s.__audit);


    // contadores por robô
    const perMode: Record<string, any> = {};
    for (const mode of MODES) {
      perMode[mode] = {
        mode,
        ticks_received: 0,
        ticks_valid: 0,
        entries_analyzed: 0,
        entries_blocked: 0,
        entries_authorized: 0,
        buy_signals: 0,
        sell_signals: 0,
        orders_executed: 0,
        last_reason: null,
        last_step_blocked: null,
        last_pipeline: [] as any[],
        last_snapshot_at: null,
        last_tick: null,
        last_score: null,
        last_confidence: null,
        last_setup: null,
        last_decision_context: null as any,
        last_decision_id: null as string | null,
        last_decision_at: null as string | null,
        decisions: [] as any[],
        trade_events: [] as any[],
      };
    }
    const history: any[] = [];
    const allDecisions: any[] = [];
    const allTradeEvents: any[] = [];


    // snapshots vêm em ordem decrescente; iterar reverso para popular "last_*" corretamente
    for (const s of [...list].reverse()) {
      const audit = s.__audit;
      const tick = audit.last_tick ?? null;
      for (const m of audit.modes ?? []) {
        const bucket = perMode[m.mode];
        if (!bucket) continue;
        bucket.ticks_received += 1;
        const guardOk = audit.tick_guard ? audit.tick_guard.ok !== false : true;
        if (guardOk && !audit.global_protection?.active) bucket.ticks_valid += 1;
        bucket.entries_analyzed += 1;
        const approved = /aprovado/i.test(m.last_refusal_reason ?? "") && !/bloqueado/i.test(m.last_refusal_reason ?? "");
        const opened = /ordem simulada aberta/i.test(m.last_refusal_reason ?? "");
        if (opened) { bucket.entries_authorized += 1; bucket.orders_executed += 1; }
        else bucket.entries_blocked += 1;
        if (m.signals?.buy) bucket.buy_signals += 1;
        if (m.signals?.sell) bucket.sell_signals += 1;

        bucket.last_reason = m.last_refusal_reason ?? bucket.last_reason;
        bucket.last_step_blocked = m.first_stop ?? bucket.last_step_blocked;
        bucket.last_snapshot_at = s.market_time;
        bucket.last_tick = tick;
        // Card e detalhe devem descrever SEMPRE a mesma avaliação. Antes cada
        // campo era arrastado individualmente com `??`, então um tick sem score
        // mantinha o score antigo enquanto o decision_context vinha de outro
        // tick — daí card e detalhe divergirem (ex.: 72 no card, 25 no detalhe).
        // Agora score/confiança/setup/contexto só avançam em bloco, junto com o
        // id da decisão (snapshot que a originou).
        const hasEvaluation = m.last_score != null || m.decision_context != null;
        if (hasEvaluation) {
          bucket.last_score = m.last_score ?? null;
          bucket.last_confidence = m.last_confidence ?? null;
          bucket.last_setup = m.last_setup ?? null;
          bucket.last_decision_context = m.decision_context ?? null;
          bucket.last_decision_id = s.id;
          bucket.last_decision_at = s.market_time;
        }
        if (m.decision_context) {
          const dec = { ...m.decision_context, at: s.market_time, decision_id: s.id };
          bucket.decisions.push(dec);
          allDecisions.push(dec);
        }

        if (m.trade_event) {
          bucket.trade_events.push({ ...m.trade_event, at: s.market_time });
          allTradeEvents.push({ ...m.trade_event, at: s.market_time, mode: m.mode });
        }

        // Snapshots com audit_level "resumido" não carregam o array de checks;
        // nesses casos mantém-se o último pipeline completo já conhecido.
        if ((m.checks ?? []).length > 0) {
          const byKey: Record<string, any> = {};
          for (const c of m.checks) byKey[c.key] = c;
          bucket.last_pipeline = PIPELINE_STEP_ORDER
            .filter((k) => byKey[k])
            .map((k) => byKey[k]);
        }


        if (!opened && m.first_stop) {
          history.push({
            at: s.market_time,
            mode: m.mode,
            step: m.first_stop.label,
            step_key: m.first_stop.key,
            detail: m.first_stop.detail,
            reason: m.last_refusal_reason,
          });
        }
      }
    }

    history.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    allDecisions.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    allTradeEvents.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    for (const mk of MODES) {
      const b = perMode[mk];
      b.decisions = b.decisions.slice(-50).reverse();
      b.trade_events = b.trade_events.slice(-20).reverse();
    }

    // Última execução COMPLETA do pipeline (etapas com observado × limite):
    // mora no estado corrente do motor, não mais em cada snapshot.
    const { data: estados } = await (supabase as any).from("b3_engine_state")
      .select("engine_audit, market_time")
      .in("simulation_run_id", scope.runIds).eq("user_id", userId)
      .order("market_time", { ascending: true });
    for (const est of estados ?? []) {
      for (const m of (est.engine_audit as any)?.modes ?? []) {
        const b = perMode[m.mode];
        if (!b || !(m.checks ?? []).length) continue;
        const byKey: Record<string, any> = {};
        for (const c of m.checks) byKey[c.key] = c;
        b.last_pipeline = PIPELINE_STEP_ORDER.filter((k) => byKey[k]).map((k) => byKey[k]);
        if (b.last_decision_context == null && m.decision_context) {
          b.last_decision_context = m.decision_context;
        }
      }
    }




    return {
      run,
      modes: MODES.map((m) => perMode[m]),
      history: history.slice(0, 100),
      decisions: allDecisions.slice(0, 100),
      trade_events: allTradeEvents.slice(0, 50),
      totals: {
        snapshots_scanned: list.length,
        decisions_recorded: allDecisions.length,
        trades_recorded: allTradeEvents.length,
      },
      executions: scope.executions,
      restart_count: scope.restartCount,
      session_date: scope.sessionDate,
    };
  });



// ─────────────────── Auditoria de Entradas (Fase 1, read-only) ───────────────────
// Lê os snapshots do período, monta funil por robô, agrega motivos de bloqueio
// (com dedup: ocorrência única + repetições), categoriza técnico/operacional/estratégico,
// e cruza com ordens executadas do período. NÃO altera nenhuma regra.

const REASON_CATEGORY: Record<string, "tecnico" | "operacional" | "estrategico"> = {
  tick_received: "tecnico",
  valid_quote: "tecnico",
  mt5_server: "tecnico",
  mt5_symbol: "tecnico",
  spread: "tecnico",
  market_open: "operacional",
  time_allowed: "operacional",
  operation_window: "operacional",
  force_close_window: "operacional",
  global_protection: "operacional",
  mode_enabled: "operacional",
  max_trades: "operacional",
  daily_loss: "operacional",
  daily_target: "operacional",
  position_open: "operacional",
  protection_engine: "operacional",
  volatility: "estrategico",
  score: "estrategico",
  confidence: "estrategico",
  committee: "estrategico",
  signal_buy: "estrategico",
  signal_sell: "estrategico",
};

const CATEGORY_LABEL: Record<string, string> = {
  tecnico: "Bloqueio técnico",
  operacional: "Bloqueio operacional",
  estrategico: "Rejeição estratégica",
};

export const getB3EntryAuditReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { hours?: number } | undefined) => ({ hours: Math.min(Math.max(1, Number(input?.hours ?? 24)), 168) }))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const since = new Date(Date.now() - data.hours * 3600_000).toISOString();

    const scope = await resolveSessionScope(supabase as any, userId);
    const run = scope.latest;
    if (!run) return { run: null, period: { since, hours: data.hours }, modes: [], reasons: [], config_mismatches: [], totals: { snapshots_scanned: 0 }, executions: [], restart_count: 0, session_date: null };

    const { data: snaps } = await (supabase as any).from("b3_simulation_market_snapshots")
      .select("market_time, extra")
      .in("simulation_run_id", scope.runIds).eq("user_id", userId)
      .gte("market_time", since)
      .order("market_time", { ascending: true })
      .limit(1200);

    const { data: orders } = await (supabase as any).from("b3_simulation_orders")
      .select("mode, status, net_result_brl, entry_time")
      .in("simulation_run_id", scope.runIds).eq("user_id", userId)
      .gte("entry_time", since);


    const ordersByMode: Record<string, { total: number; net: number }> = {};
    for (const m of MODES) ordersByMode[m] = { total: 0, net: 0 };
    for (const o of orders ?? []) {
      const b = ordersByMode[o.mode]; if (!b) continue;
      b.total += 1; b.net += Number(o.net_result_brl ?? 0);
    }

    // Estado do motor: o histórico vem do resumo compacto do snapshot, e a
    // última execução completa do pipeline vem de b3_engine_state.
    const list = (snaps ?? [])
      .map((s: any) => ({ ...s, __audit: engineAuditFromSnapshot(s) }))
      .filter((s: any) => s.__audit);

    // Estado para dedup por (mode|step_key). Um novo "grupo" começa quando muda step_key ou detail.
    type Group = { mode: string; category: string; step_key: string; label: string; detail: string; first_at: string; last_at: string; repetitions: number; observed_values: number[]; limit_values: number[] };
    const groups: Group[] = [];
    const activeByMode: Record<string, Group | null> = {};
    for (const m of MODES) activeByMode[m] = null;

    const funnel: Record<string, any> = {};
    for (const m of MODES) {
      funnel[m] = {
        mode: m,
        ciclos: 0,
        ticks_validos: 0,
        sinais_brutos: 0,
        filtrados_ok: 0,
        enviados_comite: 0,
        aprovados_comite: 0,
        rejeitados_comite: 0,
        bloqueios_tecnicos: 0,
        bloqueios_operacionais: 0,
        rejeicoes_estrategicas: 0,
        entradas_executadas: 0,
        resultado_liquido_brl: 0,
      };
    }
    let configMismatchesLatest: any[] = [];
    let latestAt: string | null = null;

    const parseObs = (detail: string | null | undefined): { obs?: number; lim?: number } => {
      if (!detail) return {};
      // patterns like "58 < 62", "Confiança 53 < 70"
      const m1 = detail.match(/(-?\d+[\d.,]*)\s*[<>]=?\s*(-?\d+[\d.,]*)/);
      if (m1) return { obs: Number(m1[1].replace(",", ".")), lim: Number(m1[2].replace(",", ".")) };
      const m2 = detail.match(/idade\s+(\d+)\s+segundos.*limite\s+(\d+)/i);
      if (m2) return { obs: Number(m2[1]), lim: Number(m2[2]) };
      return {};
    };

    for (const s of list) {
      const audit = s.__audit;
      latestAt = s.market_time;
      if (Array.isArray(audit.config_mismatches) && audit.config_mismatches.length) {
        configMismatchesLatest = audit.config_mismatches;
      } else if (audit.modes) {
        // derivar de config_comparison do último snapshot
        const mism: any[] = [];
        for (const m of audit.modes) {
          const comp = m.config_comparison ?? {};
          for (const [field, v] of Object.entries<any>(comp)) {
            if (v && v.matches === false) mism.push({ mode: m.mode, field, screen: v.screen, motor: v.motor });
          }
        }
        if (mism.length) configMismatchesLatest = mism;
      }

      for (const m of audit.modes ?? []) {
        const f = funnel[m.mode]; if (!f) continue;
        f.ciclos += 1;
        const guardOk = audit.tick_guard ? audit.tick_guard.ok !== false : true;
        const globalOk = !audit.global_protection?.active;
        if (guardOk && globalOk) f.ticks_validos += 1;

        const buy = !!m.signals?.buy;
        const sell = !!m.signals?.sell;
        if (buy || sell) f.sinais_brutos += 1;

        const first = m.first_stop;
        const opened = /ordem simulada aberta/i.test(m.last_refusal_reason ?? "");

        if (!first && !opened) f.filtrados_ok += 1;
        if (m.committee) {
          f.enviados_comite += 1;
          if (m.committee.final === "approved") f.aprovados_comite += 1;
          else f.rejeitados_comite += 1;
        }

        if (first && !opened) {
          const cat = REASON_CATEGORY[first.key] ?? "estrategico";
          if (cat === "tecnico") f.bloqueios_tecnicos += 1;
          else if (cat === "operacional") f.bloqueios_operacionais += 1;
          else f.rejeicoes_estrategicas += 1;

          const sig = `${first.key}|${(first.detail ?? "").slice(0, 80)}`;
          const active = activeByMode[m.mode];
          if (active && `${active.step_key}|${active.detail.slice(0, 80)}` === sig) {
            active.repetitions += 1;
            active.last_at = s.market_time;
            const { obs, lim } = parseObs(first.detail);
            if (obs != null) active.observed_values.push(obs);
            if (lim != null) active.limit_values.push(lim);
          } else {
            const g: Group = {
              mode: m.mode, category: cat, step_key: first.key,
              label: first.label ?? first.key, detail: first.detail ?? "",
              first_at: s.market_time, last_at: s.market_time,
              repetitions: 1, observed_values: [], limit_values: [],
            };
            const { obs, lim } = parseObs(first.detail);
            if (obs != null) g.observed_values.push(obs);
            if (lim != null) g.limit_values.push(lim);
            groups.push(g);
            activeByMode[m.mode] = g;
          }
        } else {
          activeByMode[m.mode] = null;
        }
      }
    }

    // Somar ordens executadas do banco (fonte de verdade)
    for (const m of MODES) {
      funnel[m].entradas_executadas = ordersByMode[m].total;
      funnel[m].resultado_liquido_brl = Math.round(ordersByMode[m].net * 100) / 100;
    }

    // Divergência entre configuração da tela e a lida pelo motor: é estado do
    // AGORA e vem do estado corrente do motor (não é mais repetida por snapshot).
    if (!configMismatchesLatest.length) {
      const { data: estados } = await (supabase as any).from("b3_engine_state")
        .select("engine_audit")
        .in("simulation_run_id", scope.runIds).eq("user_id", userId);
      const mism: any[] = [];
      for (const est of estados ?? []) {
        for (const m of (est.engine_audit as any)?.modes ?? []) {
          for (const [field, v] of Object.entries<any>(m.config_comparison ?? {})) {
            if (v && v.matches === false) mism.push({ mode: m.mode, field, screen: v.screen, motor: v.motor });
          }
        }
      }
      configMismatchesLatest = mism;
    }


    // Ranking de motivos: agrupar por (mode, step_key), somando ocorrências únicas e repetições
    type ReasonAgg = { mode: string; category: string; category_label: string; step_key: string; label: string; occurrences: number; repetitions: number; first_at: string; last_at: string; avg_observed: number | null; avg_limit: number | null; avg_distance: number | null; last_detail: string };
    const rmap = new Map<string, ReasonAgg>();
    const modeSignals: Record<string, number> = Object.fromEntries(MODES.map((m) => [m, funnel[m].ciclos || 1]));
    for (const g of groups) {
      const k = `${g.mode}|${g.step_key}`;
      const obs = g.observed_values.length ? g.observed_values.reduce((a, b) => a + b, 0) / g.observed_values.length : null;
      const lim = g.limit_values.length ? g.limit_values.reduce((a, b) => a + b, 0) / g.limit_values.length : null;
      const dist = obs != null && lim != null ? obs - lim : null;
      let r = rmap.get(k);
      if (!r) {
        r = { mode: g.mode, category: g.category, category_label: CATEGORY_LABEL[g.category], step_key: g.step_key, label: g.label, occurrences: 0, repetitions: 0, first_at: g.first_at, last_at: g.last_at, avg_observed: null, avg_limit: null, avg_distance: null, last_detail: g.detail };
        rmap.set(k, r);
      }
      r.occurrences += 1;
      r.repetitions += g.repetitions;
      if (g.first_at < r.first_at) r.first_at = g.first_at;
      if (g.last_at > r.last_at) { r.last_at = g.last_at; r.last_detail = g.detail; }
      // média ponderada simples pelas amostras coletadas neste grupo
      if (obs != null) r.avg_observed = r.avg_observed == null ? obs : (r.avg_observed + obs) / 2;
      if (lim != null) r.avg_limit = r.avg_limit == null ? lim : (r.avg_limit + lim) / 2;
      if (dist != null) r.avg_distance = r.avg_distance == null ? dist : (r.avg_distance + dist) / 2;
    }
    const reasons = [...rmap.values()]
      .map((r) => ({ ...r, pct_of_cycles: Math.round((r.repetitions / (modeSignals[r.mode] || 1)) * 1000) / 10 }))
      .sort((a, b) => b.repetitions - a.repetitions);

    return {
      run,
      period: { since, until: latestAt, hours: data.hours },
      modes: MODES.map((m) => {
        const f = funnel[m];
        const sinais = f.sinais_brutos || 0;
        const comite = f.enviados_comite || 0;
        return {
          ...f,
          taxa_geracao_sinal: f.ciclos ? Math.round((sinais / f.ciclos) * 10000) / 100 : 0,
          taxa_aprov_filtros: sinais ? Math.round((comite / sinais) * 10000) / 100 : 0,
          taxa_aprov_comite: comite ? Math.round((f.aprovados_comite / comite) * 10000) / 100 : 0,
          taxa_execucao: f.aprovados_comite ? Math.round((f.entradas_executadas / f.aprovados_comite) * 10000) / 100 : 0,
          conversao_final: sinais ? Math.round((f.entradas_executadas / sinais) * 10000) / 100 : 0,
        };
      }),
      reasons,
      config_mismatches: configMismatchesLatest,
      totals: { snapshots_scanned: list.length },
      executions: scope.executions,
      restart_count: scope.restartCount,
      session_date: scope.sessionDate,
    };
  });





// `onlyIfOpen`: usado pelo guardião de saída, que roda em cadência própria e
// pode disputar a mesma ordem com o tique completo. Com a trava ligada, o
// UPDATE só afeta a linha se ela ainda estiver `open` — o segundo caminho não
// consegue fechar de novo (nem contar o resultado duas vezes na carteira).
export async function closeOrder(supabase: any, userId: string, run: any, mode: any, order: any, exitAudit: B3QuoteExecutionAudit, reason: string, marketHistory: any[] = [], assetProfile: any = WIN_FALLBACK_ASSET_PROFILE, onlyIfOpen = false) {
  if (exitAudit.quote_source === "MT5 XP DEMO") assertB3StrictMt5ExecutionAudit(exitAudit, "closeOrder", assetProfile.symbol);
  const exitPrice = exitAudit.execution_price;
  const dir = order.side === "buy" ? 1 : -1;
  const grossPts = (exitPrice - Number(order.entry_price)) * dir;
  const qty = Number(order.quantity) || 1;
  const grossBrl = grossPts * Number(assetProfile.tick_value_brl) * qty;
  // Custo derivado do PERFIL DO ATIVO (não mais de run.simulated_fee_brl):
  // futuros = R$ por contrato/ponta; ações = % sobre o volume financeiro.
  const fees = computeB3Fees({ assetProfile, quantity: qty, entryPrice: Number(order.entry_price), exitPrice: exitPrice });
  const netBrl = grossBrl - fees;

  // MFE / MAE (em pontos) a partir dos snapshots entre entry_time e agora.
  const entryTimeMs = order.entry_time ? new Date(order.entry_time).getTime() : null;
  const nowMs = Date.now();
  let mfePts = 0, maePts = 0;
  if (entryTimeMs) {
    for (const h of marketHistory) {
      const t = new Date(h.market_time).getTime();
      if (t < entryTimeMs || t > nowMs) continue;
      const p = Number(h.quote_last ?? h.price ?? 0);
      if (!Number.isFinite(p) || p <= 0) continue;
      const move = (p - Number(order.entry_price)) * dir;
      if (move > mfePts) mfePts = move;
      if (move < maePts) maePts = move;
    }
  }
  const durationS = entryTimeMs ? Math.max(0, Math.round((nowMs - entryTimeMs) / 1000)) : null;

  // Extremos gravados na ordem: o maior entre o que o histórico mostra agora e o
  // que o guardião já registrou a cada 20 s enquanto a posição estava aberta.
  // `mae_pts` fica positivo (magnitude da excursão contrária). Coleta de dado —
  // nenhuma decisão de entrada ou saída lê esses campos.
  const mfeFinal = Math.round(Math.max(mfePts, Number(order.mfe_pts ?? 0), 0));
  const maeFinal = Math.round(Math.max(-maePts, Number(order.mae_pts ?? 0), 0));

  // ── MARCAÇÃO DE STOP FURADO (08/09/2026) ──
  // Compara a perda em pontos com o stop CONGELADO NA ORDEM (não com a
  // configuração de agora). Folga de 20% para deslizamento normal. Sem
  // `stop_pts` gravado (ordens antigas) nada é marcado — não há número contra
  // o qual comparar e nada é recalculado retroativamente.
  const stopPtsOrdem = Number(order.stop_pts ?? 0);
  const perdaPts = -grossPts;
  const stopViolado = stopPtsOrdem > 0 && perdaPts > stopPtsOrdem * 1.2;
  const stopExcedidoPts = stopViolado ? Math.round(perdaPts - stopPtsOrdem) : null;

  let closeUpdate = supabase.from("b3_simulation_orders").update({
    exit_price: roundToTick(exitPrice, Number(assetProfile.tick_size)),
    exit_time: new Date().toISOString(),
    gross_result_points: grossPts,
    gross_result_brl: grossBrl,
    fees, net_result_brl: netBrl,
    status: "closed", close_reason: reason,
    mfe_pts: mfeFinal, mae_pts: maeFinal,
    stop_violado: stopViolado, stop_excedido_pts: stopExcedidoPts,

    quote_source: exitAudit.quote_source,
    quote_server: exitAudit.quote_server,
    quote_symbol: exitAudit.quote_symbol,
    quote_tick_ts: exitAudit.quote_tick_ts,
    quote_bid: exitAudit.quote_bid,
    quote_ask: exitAudit.quote_ask,
    quote_last: exitAudit.quote_last,
    execution_price: exitAudit.execution_price,
    execution_price_origin: exitAudit.execution_price_origin,
    legacy_price_detected: exitAudit.legacy_price_detected,
    provider_name: exitAudit.provider_name,
  }).eq("id", order.id).eq("user_id", userId);
  if (onlyIfOpen) closeUpdate = closeUpdate.eq("status", "open");
  const { data: closedOrder, error: closeError } = await closeUpdate.select("id, status").maybeSingle();

  if (closeError || closedOrder?.status !== "closed") {
    const failureMessage = closeError?.message
      ?? `UPDATE de fechamento não confirmou status closed para a ordem ${order.id}`;
    const failureDetails = {
      order_id: order.id,
      run_id: run.id,
      mode: mode.mode,
      symbol: assetProfile.symbol,
      close_reason: reason,
      attempted_execution_price: exitAudit.execution_price,
      quote_bid: exitAudit.quote_bid,
      quote_ask: exitAudit.quote_ask,
      database_message: failureMessage,
    };
    try {
      await supabase.from("system_logs").insert({
        event_type: "falha_ao_fechar_posicao",
        source: `b3:${assetProfile.symbol}:${mode.mode}`,
        severity: "critical",
        message: failureMessage,
        technical_data: failureDetails,
      });
    } catch { /* preservar e propagar o erro original do fechamento */ }
    try {
      await supabase.from("b3_simulation_block_events").insert({
        simulation_run_id: run.id,
        simulation_mode_id: mode.id,
        user_id: userId,
        mode: mode.mode,
        prev_status: mode.current_status ?? "operando",
        new_status: "erro_tecnico",
        trigger: "falha_ao_fechar_posicao",
        related_order_id: order.id,
        message: failureMessage,
        provider_name: exitAudit.provider_name,
        price_source: exitAudit.quote_source,
        rejected_price: exitAudit.execution_price,
        mt5_last: exitAudit.quote_last,
        diagnostic_payload: failureDetails,
      });
    } catch { /* preservar e propagar o erro original do fechamento */ }
    throw new Error(`Falha ao fechar posição ${order.id}: ${failureMessage}`);
  }

  await mirrorToReal(supabase, userId, run.id, mode.mode as Mode, "close", order.side, `close-${order.id}`,
    reason === "manual_close_user" ? "user_manual_close" : reason === "manual_close_all_user" ? "user_close_all" : "engine_auto",
    assetProfile.quote_symbol, String(run?.variant ?? "indicador"));

  const newRealized = Number(mode.realized_pnl) + netBrl;
  const newBalance = Number(mode.current_balance) + netBrl;
  const wins = Number(mode.winning_trades) + (netBrl > 0 ? 1 : 0);
  const losses = Number(mode.losing_trades) + (netBrl < 0 ? 1 : 0);
  const maxGain = Math.max(Number(mode.max_gain) || 0, netBrl);
  const maxLoss = Math.min(Number(mode.max_loss) || 0, netBrl);
  const peak = Number(mode.initial_balance) + Math.max(0, newRealized);
  const dd = Math.max(Number(mode.max_drawdown) || 0, peak - newBalance);
  const totalPts = Number(mode.points_result) + grossPts;

  await supabase.from("b3_simulation_modes").update({
    realized_pnl: newRealized,
    current_balance: newBalance,
    total_fees: Number(mode.total_fees) + fees,
    total_trades: Number(mode.total_trades) + 1,
    winning_trades: wins, losing_trades: losses,
    max_gain: maxGain, max_loss: maxLoss, max_drawdown: dd,
    points_result: totalPts,
  }).eq("id", mode.id);

  mode.realized_pnl = newRealized; mode.current_balance = newBalance;
  mode.total_fees = Number(mode.total_fees) + fees;
  mode.total_trades = Number(mode.total_trades) + 1;
  mode.winning_trades = wins; mode.losing_trades = losses;
  mode.max_gain = maxGain; mode.max_loss = maxLoss; mode.max_drawdown = dd;
  mode.points_result = totalPts;

  return {
    order_id: order.id,
    mode: mode.mode ?? null,
    side: order.side,
    entry_reason: order.entry_reason ?? null,
    exit_reason: reason,
    entry_price: Number(order.entry_price),
    exit_price: roundToTick(exitPrice, Number(assetProfile.tick_size)),
    entry_time: order.entry_time,
    exit_time: new Date().toISOString(),
    duration_s: durationS,
    gross_pts: grossPts,
    gross_brl: grossBrl,
    fees,
    net_brl: netBrl,
    quantity: qty,
    mfe_pts: Math.round(mfePts),
    mae_pts: Math.round(maePts),
  };
}


// ───────────────────── ranking / sugestão ─────────────────────
export function scoreMode(m: any) {
  const net = Number(m.realized_pnl) || 0;
  const dd = Math.max(1, Number(m.max_drawdown) || 0);
  const trades = Math.max(1, Number(m.total_trades) || 0);
  const winRate = (Number(m.winning_trades) || 0) / trades;
  const rr = net / dd;
  const blocks = Number(m.risk_blocks) || 0;
  // peso: lucro líquido normalizado + taxa de acerto + r/r - drawdown - blocks
  const norm = net / Math.max(1000, Number(m.initial_balance) * 0.05);
  return 0.40 * norm + 0.25 * (winRate * 4) + 0.20 * Math.max(-2, Math.min(2, rr)) - 0.10 * (dd / 1000) - 0.05 * (blocks / 10);
}

// ───────────────────── settings por modo ─────────────────────
export const listB3ModeSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { run_id: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: rows, error } = await (supabase as any).from("b3_simulation_mode_settings")
      .select("*").eq("simulation_run_id", data.run_id).eq("user_id", userId);
    if (error) throw error;
    // garantir 3 linhas
    const byMode: Record<string, any> = {};
    for (const r of rows ?? []) byMode[r.mode] = r;
    const missing = MODES.filter(m => !byMode[m]);
    if (missing.length) {
      const ins = missing.map(m => ({
        simulation_run_id: data.run_id, user_id: userId, mode: m, ...MODE_DEFAULTS[m],
      }));
      const { data: created } = await (supabase as any).from("b3_simulation_mode_settings").insert(ins).select("*");
      for (const r of created ?? []) byMode[r.mode] = r;
    }
    return MODES.map(m => byMode[m]);
  });

const SETTING_FIELDS = [
  "enabled","entry_style","min_approve_votes","min_confidence","min_score","max_contracts",
  "stop_pts","gain_pts","max_volatility_pct","daily_loss_limit_brl","daily_gain_target_brl",
  "trading_start_time","entry_cutoff_time","force_close_time","notes",
  "trailing_activation_pts","trailing_giveback_pts","trailing_mode",
  // B3 Protection
  "minimum_trades_before_profit_lock","minimum_operating_minutes","profit_multiplier_before_lock",
  "post_target_allowed_retracement","consecutive_loss_after_target","post_target_size_reduction",
] as const;

export const updateB3ModeSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { run_id: string; mode: Mode; patch: Record<string, any> }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const patch: Record<string, any> = {};
    for (const k of SETTING_FIELDS) if (k in data.patch) patch[k] = data.patch[k];
    if (!Object.keys(patch).length) return { ok: true };
    const { error } = await (supabase as any).from("b3_simulation_mode_settings")
      .update(patch).eq("simulation_run_id", data.run_id).eq("mode", data.mode).eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });

export const resetB3ModeSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { run_id: string; mode: Mode }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: run } = await (supabase as any).from("b3_simulation_runs")
      .select("symbol").eq("id", data.run_id).eq("user_id", userId).maybeSingle();
    const symbol = run?.symbol ?? "WINQ26";
    const { data: ud } = await (supabase as any)
      .from("b3_mode_user_defaults").select("*")
      .eq("user_id", userId).eq("symbol", symbol).eq("mode", data.mode).maybeSingle();
    // Sem padrão salvo pra esse (symbol, mode) NÃO aplicamos MODE_DEFAULTS:
    // os valores de fábrica são escala de mini índice e destruiriam a
    // calibração de WDO / PETR4 / VALE3. Deixa a configuração como está.
    if (!ud) return { ok: false, source: "none", symbol, mode: data.mode };
    const fab = MODE_DEFAULTS[data.mode];
    const def = Object.fromEntries(
      SETTING_FIELDS.map(k => [k, k in ud && ud[k] != null ? ud[k] : fab[k as keyof typeof fab]]),
    );
    const { error } = await (supabase as any).from("b3_simulation_mode_settings")
      .update({ ...def, enabled: true })
      .eq("simulation_run_id", data.run_id).eq("mode", data.mode).eq("user_id", userId);
    if (error) throw error;
    return { ok: true, source: "user_default", symbol, mode: data.mode };
  });

// ─────────────────── "meu padrão" por modo + ATIVO ───────────────────
// A chave é (user_id, symbol, mode): o padrão do WIN não vale pro WDO.
export const saveModeAsDefault = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { run_id: string; mode: Mode; values: Record<string, any> }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: run } = await (supabase as any).from("b3_simulation_runs")
      .select("symbol").eq("id", data.run_id).eq("user_id", userId).maybeSingle();
    if (!run) throw new Error("Run não encontrada");
    const symbol = run.symbol ?? "WINQ26";
    const patch: Record<string, any> = {};
    for (const k of SETTING_FIELDS) if (k in data.values && k !== "enabled" && k !== "notes") patch[k] = data.values[k];
    const { error } = await (supabase as any).from("b3_mode_user_defaults")
      .upsert({ user_id: userId, symbol, mode: data.mode, ...patch }, { onConflict: "user_id,symbol,mode" });
    if (error) throw error;
    return { ok: true, symbol };
  });

export const listModeUserDefaults = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { symbol?: string } | undefined) => d ?? {})
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let q = (supabase as any).from("b3_mode_user_defaults").select("*").eq("user_id", userId);
    if (data.symbol) q = q.eq("symbol", data.symbol);
    const { data: rows, error } = await q;
    if (error) throw error;
    return rows ?? [];
  });

export const deleteModeUserDefault = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { mode: Mode; symbol: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await (supabase as any).from("b3_mode_user_defaults")
      .delete().eq("user_id", userId).eq("symbol", data.symbol).eq("mode", data.mode);
    if (error) throw error;
    return { ok: true };
  });


// ─────────────────── Painel unificado (cockpit) — todos os ativos ───────────────────
// Junta os 5 modos de CADA simulação 'running' do usuário (hoje: WIN + WDO,
// escala sozinho quando mais ativos forem adicionados) num formato enxuto
// pra um card compacto — não reaproveita getB3SimulationDetail (que traz
// até 500 ordens) porque o cockpit só precisa da posição aberta atual e do
// resultado de hoje, não do histórico completo.
export const getB3CockpitOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  // FILTROS DA TELA (somente leitura, 26/08/2026)
  //
  // São 250 robôs: 10 ativos × 5 modalidades × 5 modos. A tela precisa recortar
  // por ativo, modalidade e modo, e o recorte tem que valer para TODA soma —
  // cards, testeira por ativo e placar. Um total que não acompanha o filtro
  // induz a erro de leitura, que é pior do que não filtrar.
  //
  // `variant` (singular) continua aceito para não quebrar chamada antiga.
  // `symbols` recebe a RAIZ do ativo (WIN, WDO, PETR4) — o contrato rola de
  // vencimento e ninguém filtra por "WINV26".
  .inputValidator((d?: {
    variant?: string | null;
    variants?: string[] | null;
    symbols?: string[] | null;
    modes?: string[] | null;
  }) => d ?? {})
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const variantFilter = data?.variant && data.variant !== "all" ? String(data.variant) : null;
    const f = buildCockpitFilter(data);
    const { data: runs, error: runsErr } = await (supabase as any)
      .from("b3_simulation_runs").select("id, symbol, variant").eq("user_id", userId).eq("status", "running");
    if (runsErr) throw runsErr;


    const sessionDate = currentB3SessionDate();
    const dayStartUtc = `${sessionDate}T03:00:00.000Z`; // BRT = UTC-3 (sem horário de verão)

    // Ambiente da conta (real x simulação) — usado apenas pela UI pra liberar
    // ou bloquear o botão de reativação após stop diário.
    const { data: tset } = await (supabase as any).from("b3_trading_settings")
      .select("environment").eq("user_id", userId).maybeSingle();
    const environment = (tset?.environment ?? "simulation") as string;

    // Intervenções de reset de stop diário registradas hoje.
    const { data: interv } = await (supabase as any).from("b3_intervencoes")
      .select("symbol, variant, mode, acao")
      .eq("user_id", userId).eq("trade_date", sessionDate).eq("acao", "reset_stop_diario");

    // Freio escalonado por grupo (somente leitura): o card precisa explicar por
    // que o robô está operando com 2 contratos em vez de 5, ou por que não entra.
    // Chaveado pela RAIZ do ativo — contrato vencido não pode perder a linha.
    const { data: grupoEstados } = await (supabase as any).from("b3_grupo_estado_dia")
      .select("symbol, variant, nivel_atual, multiplicador, ultima_mudanca_ts, robos_travados, resultado_brl")
      .eq("user_id", userId).eq("trade_date", sessionDate);
    const grupoByKey: Record<string, any> = {};
    for (const g of (grupoEstados ?? []) as any[]) {
      grupoByKey[`${rootSymbol(g.symbol)}|${g.variant}`] = g;
    }
    // Quais grupos TÊM freio configurado. Sem linha aqui, o card avisa.
    const { data: grupoLimitesRows } = await (supabase as any).from("b3_grupo_limites")
      .select("symbol, variant, ativo, teto_brl").eq("user_id", userId);
    const grupoComFreio = new Set<string>();
    for (const g of (grupoLimitesRows ?? []) as any[]) {
      if (g.ativo !== false && Number(g.teto_brl) > 0) {
        grupoComFreio.add(`${rootSymbol(g.symbol)}|${g.variant ?? "indicador"}`);
      }
    }
    // Livre × sombra do dia por grupo: desde 08/09/2026 o freio de grupo só
    // registra no simulado, então o card precisa mostrar o resultado real e o
    // que existiria com o freio ligado — e a diferença, que é a medição.
    // A medição é por ROBÔ (mode) e também consolidada por grupo (mode = "").
    // O card mostra a linha do robô; a testeira da modalidade, a do grupo.
    const { data: sombraRows } = await (supabase as any).from("b3_grupo_sombra_dia")
      .select("symbol, variant, mode, resultado_livre_brl, resultado_sombra_brl, ops_livre, ops_sombra, diferenca_brl, sombra_por_freio")
      .eq("user_id", userId).eq("trade_date", sessionDate);
    const shapeSombra = (s: any) => ({
      resultado_livre_brl: Number(s.resultado_livre_brl ?? 0),
      resultado_sombra_brl: Number(s.resultado_sombra_brl ?? 0),
      ops_livre: Number(s.ops_livre ?? 0),
      ops_sombra: Number(s.ops_sombra ?? 0),
      diferenca_brl: Number(s.diferenca_brl ?? 0),
      // Atribuição por freio (15/09/2026). Dias anteriores vêm vazios: nada é
      // recalculado, a medição por freio vale daqui para frente.
      por_freio: (s.sombra_por_freio ?? {}) as Record<string, any>,
    });

    const sombraByKey: Record<string, any> = {};      // robô: root|variant|mode
    const sombraGrupoByKey: Record<string, any> = {}; // grupo: root|variant
    for (const s of (sombraRows ?? []) as any[]) {
      const base = `${rootSymbol(s.symbol)}|${s.variant}`;
      const mode = String(s.mode ?? "");
      if (mode === "") sombraGrupoByKey[base] = shapeSombra(s);
      else sombraByKey[`${base}|${mode}`] = shapeSombra(s);
    }

    // AUTORIZAÇÃO REAL (04/09/2026): quais robôs desta lista simulada estão
    // realmente espelhando dinheiro. Cruzamento pela RAIZ do ativo — a
    // autorização é cadastrada como "WIN" e a execução roda em "WINV26".
    const { data: prdAuths } = await (supabase as any).from("b3_prd_authorizations")
      .select("symbol, variant, mode, enabled, revoked_at, max_qty")
      .eq("user_id", userId).eq("enabled", true).is("revoked_at", null);
    const authByKey = new Map<string, { max_qty: number }>();
    for (const a of (prdAuths ?? []) as any[]) {
      authByKey.set(
        `${cockpitRootSymbol(a.symbol)}|${a.variant ?? "indicador"}|${a.mode}`,
        { max_qty: Number(a.max_qty ?? 0) },
      );
    }

    const cards: any[] = [];


    const assetBySymbol: Record<string, any> = {};
    // Execução fora do recorte de ativo/modalidade não é nem lida: economiza as
    // consultas por execução (modos, ordens, snapshot) além de sumir da tela.
    const runsVisiveis = ((runs ?? []) as any[]).filter((r) => cockpitKeep(f, r.symbol, r.variant));
    for (const run of runsVisiveis) {
      const asset = await loadAssetProfile(supabase, run.symbol);
      assetBySymbol[run.symbol] = asset;

      const [{ data: modes }, { data: settings }, { data: openOrders }, { data: snaps }, { data: closedToday }] = await Promise.all([
        (supabase as any).from("b3_simulation_modes")
          .select("mode, initial_balance, current_balance, current_status, protection_state, protection_block_reason, day_peak_profit_brl")
          .eq("simulation_run_id", run.id).eq("user_id", userId),
        (supabase as any).from("b3_simulation_mode_settings").select("mode, enabled, daily_loss_limit_brl, peak_giveback_pct")
          .eq("simulation_run_id", run.id).eq("user_id", userId),
        (supabase as any).from("b3_simulation_orders").select("id, mode, side, entry_price, quantity, entry_time, created_at")
          .eq("simulation_run_id", run.id).eq("user_id", userId).eq("status", "open"),
        // Só o resumo compacto por robô é usado aqui (score, confiança e a
        // etapa que barrou), então projetamos esse caminho do JSON.
        (supabase as any).from("b3_simulation_market_snapshots").select("price, engine_digest:extra->engine_digest, engine_modes:extra->engine_audit->modes")
          .eq("simulation_run_id", run.id).eq("user_id", userId).order("market_time", { ascending: false }).limit(1),
        (supabase as any).from("b3_simulation_orders").select("mode, net_result_brl")
          .eq("simulation_run_id", run.id).eq("user_id", userId).eq("status", "closed")
          .gte("exit_time", dayStartUtc),
      ]);

      const livePrice = Number(snaps?.[0]?.price ?? 0) || null;
      // Resumo compacto (chaves curtas) com reserva para linhas antigas.
      const digest: any[] = snaps?.[0]?.engine_digest ?? [];
      const auditModes: any[] = digest.length
        ? digest.map((d: any) => ({
            mode: d.m,
            last_score: d.s ?? null,
            last_confidence: d.c ?? null,
            first_stop: d.k ? { label: ENGINE_STEP_LABEL[d.k] ?? d.k } : null,
            last_refusal_reason: d.r ?? null,
          }))
        : (snaps?.[0]?.engine_modes ?? []);
      const enabledByMode: Record<string, boolean> = {};
      const lossLimitByMode: Record<string, number | null> = {};
      const givebackByMode: Record<string, number | null> = {};
      for (const s of settings ?? []) {
        enabledByMode[s.mode] = s.enabled !== false;
        lossLimitByMode[s.mode] = s.daily_loss_limit_brl == null ? null : Number(s.daily_loss_limit_brl);
        givebackByMode[s.mode] = s.peak_giveback_pct == null ? null : Number(s.peak_giveback_pct);
      }
      const openByMode: Record<string, any> = {};
      for (const o of openOrders ?? []) openByMode[o.mode] = o;

      // Stop pendente não executado (só leitura dos eventos gravados pelo motor).
      // O alerta só continua de pé enquanto a condição que o gerou existir: se o
      // preço voltou para dentro do nível de stop, o aviso é descartado aqui.
      // Alerta que não se apaga sozinho ensina o operador a ignorar vermelho.
      const openIds = (openOrders ?? []).map((o: any) => o.id);
      const pendingByMode: Record<string, any> = {};
      if (openIds.length) {
        const { data: pendEvents } = await (supabase as any).from("b3_simulation_block_events")
          .select("mode, related_order_id, observed_value, limit_value, message, created_at, diagnostic_payload")
          .eq("user_id", userId).eq("trigger", "stop_pendente_nao_executado")
          .in("related_order_id", openIds)
          // Eventos com mais de 180 s são descartados abaixo; filtrar no banco
          // evita ler o histórico inteiro (tabela com payloads grandes).
          .gte("created_at", new Date(Date.now() - 180_000).toISOString())
          .order("created_at", { ascending: false })
          .limit(40);
        for (const ev of pendEvents ?? []) {
          if (pendingByMode[ev.mode]) continue;
          const ageMs = Date.now() - new Date(ev.created_at).getTime();
          if (ageMs > 180_000) continue; // evento velho = já resolvido/sem sinal recente
          const openOrd = (openOrders ?? []).find((o: any) => o.id === ev.related_order_id);
          if (!openOrd) continue;
          const dir = openOrd.side === "buy" ? 1 : -1;
          const stopLevel = Number(
            ev.diagnostic_payload?.stop_level
              ?? (Number(openOrd.entry_price) - dir * Number(ev.limit_value ?? 0)),
          );
          // Ainda atravessado? compra: preço no nível ou abaixo; venda: no nível
          // ou acima. Sem preço vivo ou sem nível, mantém o aviso (não inventa).
          if (livePrice != null && Number.isFinite(stopLevel) && stopLevel > 0) {
            const stillCrossed = dir === 1 ? livePrice <= stopLevel : livePrice >= stopLevel;
            if (!stillCrossed) continue;
          }
          pendingByMode[ev.mode] = {
            beyond_pts: Number(ev.observed_value ?? 0),
            stop_pts: Number(ev.limit_value ?? 0),
            stop_level: Number.isFinite(stopLevel) ? stopLevel : null,
            elapsed_s: Number(ev.diagnostic_payload?.elapsed_s ?? 0),
            severidade: ev.diagnostic_payload?.severidade ?? "AVISO",
            block_reason: ev.diagnostic_payload?.block_reason ?? null,
            message: ev.message ?? null,
            at: ev.created_at,
          };
        }
      }
      const auditByMode: Record<string, any> = {};
      for (const a of auditModes) auditByMode[a.mode] = a;
      // Realizado do dia por modo: soma do net das ordens fechadas hoje.
      const realizedTodayByMode: Record<string, number> = {};
      for (const o of closedToday ?? []) {
        realizedTodayByMode[o.mode] = (realizedTodayByMode[o.mode] ?? 0) + Number(o.net_result_brl ?? 0);
      }
      const variant = (run.variant ?? "indicador") as string;

      for (const m of MODES) {
        if (f.modes && !f.modes.has(m)) continue; // recorte de modo

        const mode = (modes ?? []).find((x: any) => x.mode === m);
        const open = openByMode[m];
        const audit = auditByMode[m];
        let unrealizedPts: number | null = null, unrealizedBrl: number | null = null;
        if (open && livePrice != null) {
          const dir = open.side === "buy" ? 1 : -1;
          unrealizedPts = (livePrice - Number(open.entry_price)) * dir;
          unrealizedBrl = unrealizedPts * Number(asset.tick_value_brl) * Number(open.quantity);
        }
        const realizedToday = realizedTodayByMode[m] ?? 0;
        const reactivatedToday = (interv ?? []).some((i: any) =>
          i.symbol === asset.quote_symbol && (i.variant ?? "indicador") === variant && i.mode === m);
        cards.push({
          run_id: run.id, symbol: run.symbol, variant, mode: m,
          quote_symbol: asset.quote_symbol,
          tick_size: Number(asset.tick_size),
          environment,
          enabled: enabledByMode[m] ?? true,
          // Selo "REAL": este robô está autorizado e ligado no espelhamento de
          // dinheiro de verdade, com o teto de contratos da autorização.
          real_auth: authByKey.get(`${cockpitRootSymbol(run.symbol)}|${variant}|${m}`) ?? null,

          // entry_time viaja para a tela poder mostrar "desde HH:MM (N min)":
          // com dois robôs do mesmo ativo em lados opostos, a ordem de entrada
          // é a única forma de saber quem entrou primeiro.
          open: open ? {
            side: open.side, entry_price: Number(open.entry_price), quantity: Number(open.quantity),
            entry_time: open.entry_time ?? open.created_at ?? null,
          } : null,
          live_price: livePrice,
          unrealized_pts: unrealizedPts, unrealized_brl: unrealizedBrl,
          balance: Number(mode?.current_balance ?? mode?.initial_balance ?? 0),
          realized_today: realizedToday,
          total_today: realizedToday + (unrealizedBrl ?? 0),
          pnl_accumulated: Number(mode?.current_balance ?? 0) - Number(mode?.initial_balance ?? 0),
          current_status: mode?.current_status ?? null,
          protection_state: mode?.protection_state ?? null,
          protection_block_reason: mode?.protection_block_reason ?? null,
          daily_loss_limit_brl: lossLimitByMode[m] ?? null,
          // Pico do dia e limite de devolução: canal visual próprio no card
          // (a cor da linha continua significando constância).
          day_peak_profit_brl: mode?.day_peak_profit_brl == null ? null : Number(mode.day_peak_profit_brl),
          peak_giveback_pct: givebackByMode[m] ?? null,
          reactivated_today: reactivatedToday,
          score: audit?.last_score ?? null, confidence: audit?.last_confidence ?? null,
          blocked_reason: open ? null : (audit?.first_stop?.label ?? audit?.last_refusal_reason ?? null),
          pending_stop: open ? (pendingByMode[m] ?? null) : null,
          grupo: (() => {
            const chaveGrupo = `${rootSymbol(run.symbol)}|${variant}`;
            // Sombra DESTE robô — o número do grupo vive na testeira da modalidade.
            const sombra = sombraByKey[`${chaveGrupo}|${m}`] ?? null;
            // Grupo sem configuração: opera sem freio e a tela precisa dizer.
            if (!grupoComFreio.has(chaveGrupo)) {
              return {
                nivel: 0, multiplicador: 1, travado: false, desde: null,
                resultado_brl: 0, sem_limite: true, sombra_apenas: true, sombra,
                texto: "sem freio de grupo configurado",
              };
            }
            const g = grupoByKey[chaveGrupo];
            const nivel = Number(g?.nivel_atual ?? 0);
            if (!g || nivel <= 0) return sombra ? { nivel: 0, multiplicador: 1, travado: false, desde: null, resultado_brl: 0, sombra_apenas: true, sombra, texto: null } : null;
            const mult = Number(g.multiplicador ?? 1);
            return {
              nivel,
              multiplicador: mult,
              // No simulado, "travado" agora significa SOMBRA: o robô entra e o
              // espelho para o real é recusado.
              travado: Array.isArray(g.robos_travados) && g.robos_travados.includes(m),
              sombra_apenas: true,
              desde: g.ultima_mudanca_ts ?? null,
              resultado_brl: Number(g.resultado_brl ?? 0),
              sombra,
              texto: `grupo ${asset.quote_symbol}/${variant} — ${textoNivelGrupo(nivel, mult)} (sombra: simulado entra, real não)`,
            };
          })(),

        });
      }
    }
    // ── Testeira por ativo e subtotal por modalidade (SOMENTE LEITURA) ──
    // Mesmo método de linha do tempo de eventos do placar: +margem na entrada,
    // −margem na saída (ou agora), ordenado com entradas antes de saídas, e o
    // máximo acumulado × 1,30. Somar picos individuais superestima.
    const runList: any[] = runsVisiveis;
    const runIds = runList.map((r) => r.id);
    const porAtivo: any[] = [];
    if (runIds.length) {
      const runById: Record<string, any> = {};
      for (const r of runList) runById[r.id] = r;
      const priceByRun: Record<string, number | null> = {};
      for (const c of cards) if (priceByRun[c.run_id] == null) priceByRun[c.run_id] = c.live_price ?? null;

      // A testeira tem que somar EXATAMENTE o que os cards somam. O card conta
      // como realizado toda ordem FECHADA HOJE (exit_time no dia), então filtrar
      // a testeira por entry_time deixava de fora ordem aberta antes da virada de
      // sessão e fechada hoje — cabeçalho zerado com cards somando. São duas
      // leituras: fechadas por exit_time (igual ao card) + todas as abertas.
      const [{ data: closedDay }, { data: openAll }] = await Promise.all([
        (supabase as any).from("b3_simulation_orders")
          .select("simulation_run_id, mode, side, status, quantity, entry_price, entry_time, exit_time, net_result_brl, created_at")
          .eq("user_id", userId).in("simulation_run_id", runIds).eq("status", "closed")
          .gte("exit_time", dayStartUtc),
        (supabase as any).from("b3_simulation_orders")
          .select("simulation_run_id, mode, side, status, quantity, entry_price, entry_time, exit_time, net_result_brl, created_at")
          .eq("user_id", userId).in("simulation_run_id", runIds).eq("status", "open"),
      ]);
      const dayOrders: any[] = [...(closedDay ?? []), ...(openAll ?? [])];

      const nowMs = Date.now();
      type Agg = {
        realizado: number; nao_realizado: number; ops: number; ganhos: number;
        events: { t: number; dm: number }[];
        robots: Map<string, { variant: string; mode: string; brl: number }>;
      };
      const mkAgg = (): Agg => ({ realizado: 0, nao_realizado: 0, ops: 0, ganhos: 0, events: [], robots: new Map() });
      const byAsset = new Map<string, { contracts: Set<string>; agg: Agg; byVariant: Map<string, Agg> }>();
      const ensureAsset = (root: string) => {
        if (!byAsset.has(root)) byAsset.set(root, { contracts: new Set(), agg: mkAgg(), byVariant: new Map() });
        return byAsset.get(root)!;
      };
      // Semeia toda run visível: ativo sem operação no dia tem testeira em zero
      // de propósito, e não "sem testeira" (que a tela lia como R$ 0,00 sem ops).
      for (const r of runList) {
        const variant = (r.variant ?? "indicador") as string;
        const entryAsset = ensureAsset(rootSymbol(r.symbol));
        entryAsset.contracts.add(r.symbol);
        if (!entryAsset.byVariant.has(variant)) entryAsset.byVariant.set(variant, mkAgg());
      }

      for (const o of dayOrders ?? []) {
        const run = runById[o.simulation_run_id];
        if (!run) continue;
        const root = rootSymbol(run.symbol);
        const variant = (run.variant ?? "indicador") as string;
        // Recorte completo (ativo, modalidade e modo): a ordem descartada aqui
        // não entra em nenhuma soma nem na linha do tempo de margem, então o
        // pico de capital também é do recorte, não do sistema inteiro.
        if (!cockpitKeep(f, run.symbol, variant, o.mode)) continue;
        const asset = assetBySymbol[run.symbol] ?? WIN_FALLBACK_ASSET_PROFILE;
        const entryAsset = ensureAsset(root);
        entryAsset.contracts.add(run.symbol);
        if (!entryAsset.byVariant.has(variant)) entryAsset.byVariant.set(variant, mkAgg());
        const aggs = [entryAsset.agg, entryAsset.byVariant.get(variant)!];


        const qty = Number(o.quantity ?? 0);
        const entry = Number(o.entry_price ?? 0);
        const margem = String(asset.margin_model ?? "per_contract") === "per_contract"
          ? Number(asset.margin_per_contract_brl ?? 0) * qty
          : entry * qty * Number(asset.margin_percent_position ?? 0) / 100;
        const tIn = new Date(o.entry_time ?? o.created_at ?? nowMs).getTime();
        const tOut = o.exit_time ? new Date(o.exit_time).getTime() : nowMs;

        let brl = 0;
        if (o.status === "closed") {
          brl = Number(o.net_result_brl ?? 0);
          for (const a of aggs) {
            a.realizado += brl; a.ops += 1; if (brl > 0) a.ganhos += 1;
          }
        } else {
          const live = priceByRun[o.simulation_run_id];
          if (live != null) {
            const dir = o.side === "buy" ? 1 : -1;
            brl = (live - entry) * dir * Number(asset.tick_value_brl ?? POINT_VALUE_BRL) * qty;
          }
          for (const a of aggs) a.nao_realizado += brl;
        }
        for (const a of aggs) {
          a.events.push({ t: tIn, dm: margem });
          a.events.push({ t: tOut, dm: -margem });
          const key = `${variant}|${o.mode}`;
          if (!a.robots.has(key)) a.robots.set(key, { variant, mode: o.mode, brl: 0 });
          a.robots.get(key)!.brl += brl;
        }
      }

      const picoDe = (evts: { t: number; dm: number }[]) => {
        const sorted = [...evts].sort((a, b) => a.t - b.t || b.dm - a.dm);
        let acc = 0, pico = 0;
        for (const e of sorted) { acc += e.dm; if (acc > pico) pico = acc; }
        return pico * 1.3;
      };
      const shape = (a: Agg) => {
        const resultado = a.realizado + a.nao_realizado;
        const pico = picoDe(a.events);
        const ranked = Array.from(a.robots.values()).sort((x, y) => y.brl - x.brl);
        return {
          resultado_brl: resultado,
          realizado_brl: a.realizado,
          nao_realizado_brl: a.nao_realizado,
          ops: a.ops,
          ganhos: a.ganhos,
          taxa_acerto: a.ops ? a.ganhos / a.ops : null,
          pico_capital_brl: pico,
          retorno_sobre_capital: pico > 0 ? resultado / pico : null,
          melhor_robo: ranked[0] ?? null,
          pior_robo: ranked.length > 1 ? ranked[ranked.length - 1] : null,
        };
      };

      for (const [root, v] of byAsset.entries()) {
        porAtivo.push({
          symbol: root,
          contracts: Array.from(v.contracts),
          ...shape(v.agg),
          por_modalidade: Array.from(v.byVariant.entries()).map(([variant, agg]) => ({
            variant, ...shape(agg),
            // Livre × sombra do GRUPO: aqui tudo em volta também é de grupo.
            sombra: sombraGrupoByKey[`${root}|${variant}`] ?? null,
          })),
        });
      }
      porAtivo.sort((a, b) => b.resultado_brl - a.resultado_brl);
    }

    // Cor do robô: quem decide é o banco (b3_cor_do_robo, via
    // b3_cores_dos_robos). A tela só pinta — nenhuma regra de cor é
    // reimplementada aqui, para não divergir da curadoria.
    try {
      const { data: cores } = await (supabase as any).rpc("b3_cores_dos_robos");
      const corByKey: Record<string, any> = {};
      for (const c of cores ?? []) {
        corByKey[`${rootSymbol(c.symbol)}|${c.variant ?? "indicador"}|${c.mode}`] = c;
      }
      for (const card of cards) {
        const c = corByKey[`${rootSymbol(card.symbol)}|${card.variant}|${card.mode}`]
          ?? corByKey[`${rootSymbol(card.quote_symbol)}|${card.variant}|${card.mode}`];
        card.cor = c?.cor ?? "neutro";
        card.curadoria = c
          ? {
              streak_days: Number(c.streak_days ?? 0),
              neg_streak: Number(c.neg_streak ?? 0),
              medal: Boolean(c.medal),
              rank_day: c.rank_day == null ? null : Number(c.rank_day),
              caiu_de_verde_em: c.caiu_de_verde_em ?? null,
            }
          : null;
      }
    } catch {
      for (const card of cards) { card.cor = "neutro"; card.curadoria = null; }
    }

    return {
      session_date: sessionDate,
      variant: variantFilter ?? "all",
      filtro_ativo: f.active,
      cards, por_ativo: porAtivo,
    };

  });

// ─────────────────── placar do dia (topo do Cockpit) ───────────────────
// Somente LEITURA. Não toca em nenhuma regra do motor: apenas soma ordens
// de b3_simulation_orders, perfis de b3_asset_profiles e o capital
// disponível de b3_trading_settings.
// O pico de exposição é reconstruído por linha do tempo de eventos
// (+margem na entrada, −margem na saída ou agora), porque não existe
// histórico de exposição gravado.
export const getB3CockpitScoreboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  // Mesmos filtros da tela (ativo, modalidade e modo): o placar tem que
  // descrever o recorte que o usuário está vendo — saldo do dia, exposição,
  // contagem de posicionados e pico de capital. Placar que não acompanha o
  // filtro induz a erro de leitura.
  .inputValidator((d?: {
    variant?: string | null;
    variants?: string[] | null;
    symbols?: string[] | null;
    modes?: string[] | null;
  }) => d ?? {})
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const variantFilter = data?.variant && data.variant !== "all" ? String(data.variant) : null;
    const f = buildCockpitFilter(data);
    const sessionDate = currentB3SessionDate();
    const dayStartUtc = `${sessionDate}T03:00:00.000Z`; // BRT = UTC-3

    const [{ data: runs }, { data: tset }] = await Promise.all([
      (supabase as any).from("b3_simulation_runs")
        .select("id, symbol, variant").eq("user_id", userId).eq("status", "running"),
      (supabase as any).from("b3_trading_settings")
        .select("capital_disponivel_brl").eq("user_id", userId).maybeSingle(),
    ]);
    const capitalDisponivelBrl = Number(tset?.capital_disponivel_brl ?? 0) || 0;

    const runList: any[] = ((runs ?? []) as any[])
      .filter((r) => cockpitKeep(f, r.symbol, r.variant));
    const modesVisiveis = MODES.filter((m) => !f.modes || f.modes.has(m));
    const runIds = runList.map((r) => r.id);
    const empty = {
      session_date: sessionDate,
      filtro_ativo: f.active,
      capital_disponivel_brl: capitalDisponivelBrl,
      saldo_dia_brl: 0, se_fechasse_agora_brl: 0,
      exposicao_atual_brl: 0, robots_posicionados: 0, robots_total: runList.length * modesVisiveis.length,
      lucro_bruto_brl: 0, prejuizo_bruto_brl: 0, aberto_positivo_brl: 0, aberto_negativo_brl: 0,
      melhor_robo: null as any, pior_robo: null as any,
      pico_exposicao_brl: 0, pico_exposicao_hora: null as string | null, pico_posicoes: 0,
      stops_pendentes: 0,
      quotes_health: [] as { symbol: string; age_s: number | null; stale: boolean }[],
      quote_guard_limit_s: 45,
    };
    if (!runIds.length) return empty;

    // Perfis dos ativos das runs ativas.
    const profiles: Record<string, any> = {};
    for (const symbol of Array.from(new Set(runList.map((r) => r.symbol)))) {
      profiles[symbol] = await loadAssetProfile(supabase, symbol);
    }
    const runById: Record<string, any> = {};
    for (const r of runList) runById[r.id] = r;

    // Ordens do dia (abertas + fechadas hoje) e último preço por run.
    const [{ data: orders }, { data: snaps }] = await Promise.all([
      (supabase as any).from("b3_simulation_orders")
        .select("id, simulation_run_id, mode, side, status, quantity, entry_price, entry_time, exit_time, net_result_brl, created_at")
        .eq("user_id", userId).in("simulation_run_id", runIds).in("status", ["open", "closed"])
        .gte("entry_time", dayStartUtc),
      (supabase as any).from("b3_simulation_market_snapshots")
        .select("simulation_run_id, price, market_time")
        .eq("user_id", userId).in("simulation_run_id", runIds)
        .order("market_time", { ascending: false }).limit(400),
    ]);

    const priceByRun: Record<string, number> = {};
    for (const s of snaps ?? []) {
      if (priceByRun[s.simulation_run_id] == null && Number(s.price) > 0) {
        priceByRun[s.simulation_run_id] = Number(s.price);
      }
    }

    const nowMs = Date.now();
    let saldoDia = 0, lucroBruto = 0, prejuizoBruto = 0;
    let abertoPos = 0, abertoNeg = 0, exposicaoAtual = 0, posicionados = 0;
    const byRobot = new Map<string, { symbol: string; variant: string; mode: string; brl: number }>();
    const events: { t: number; dm: number; dq: number }[] = [];

    for (const o of orders ?? []) {
      const run = runById[o.simulation_run_id];
      if (!run) continue;
      // Recorte de modo: a ordem de um modo desmarcado não soma no saldo, na
      // exposição, no melhor/pior robô nem na linha do tempo do pico.
      if (f.modes && !f.modes.has(String(o.mode))) continue;
      const asset = profiles[run.symbol] ?? WIN_FALLBACK_ASSET_PROFILE;
      const qty = Number(o.quantity ?? 0);
      const entry = Number(o.entry_price ?? 0);
      const key = `${run.symbol}|${run.variant ?? "indicador"}|${o.mode}`;
      if (!byRobot.has(key)) {
        byRobot.set(key, { symbol: run.symbol, variant: run.variant ?? "indicador", mode: o.mode, brl: 0 });
      }

      // Margem exigida pela posição, conforme o modelo do ativo.
      const margem = String(asset.margin_model ?? "per_contract") === "per_contract"
        ? Number(asset.margin_per_contract_brl ?? 0) * qty
        : entry * qty * Number(asset.margin_percent_position ?? 0) / 100;

      const tIn = new Date(o.entry_time ?? o.created_at ?? nowMs).getTime();
      const tOut = o.exit_time ? new Date(o.exit_time).getTime() : nowMs;
      events.push({ t: tIn, dm: margem, dq: 1 });
      events.push({ t: tOut, dm: -margem, dq: -1 });

      if (o.status === "closed") {
        const net = Number(o.net_result_brl ?? 0);
        saldoDia += net;
        if (net >= 0) lucroBruto += net; else prejuizoBruto += net;
        byRobot.get(key)!.brl += net;
      } else {
        posicionados += 1;
        exposicaoAtual += margem;
        const live = priceByRun[o.simulation_run_id];
        if (live != null) {
          const dir = o.side === "buy" ? 1 : -1;
          const brl = (live - entry) * dir * Number(asset.tick_value_brl ?? POINT_VALUE_BRL) * qty;
          if (brl >= 0) abertoPos += brl; else abertoNeg += brl;
          byRobot.get(key)!.brl += brl;
        }
      }
    }

    // Pico do dia: acumula os eventos em ordem de tempo (entradas antes de
    // saídas no mesmo instante, para não subestimar o pico).
    events.sort((a, b) => a.t - b.t || b.dq - a.dq);
    let accM = 0, accQ = 0, picoM = 0, picoQ = 0, picoT: number | null = null;
    for (const e of events) {
      accM += e.dm; accQ += e.dq;
      if (accM > picoM) { picoM = accM; picoT = e.t; }
      if (accQ > picoQ) picoQ = accQ;
    }

    const ranked = Array.from(byRobot.values()).sort((a, b) => b.brl - a.brl);
    const horaPico = picoT == null ? null : new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit",
    }).format(new Date(picoT));

    // Stops pendentes não executados: ordens abertas com evento recente (3 min)
    // gravado pelo motor E que ainda estejam com o preço além do nível de stop.
    // Se o preço voltou para dentro, a condição não existe mais e o placar não
    // conta. Somente leitura.
    const openToday = (orders ?? []).filter((o: any) => o.status === "open");
    const openIdsToday = openToday.map((o: any) => o.id);
    let stopsPendentes = 0;
    if (openIdsToday.length) {
      const { data: pendEvents } = await (supabase as any).from("b3_simulation_block_events")
        .select("related_order_id, created_at, limit_value, diagnostic_payload")
        .eq("user_id", userId).eq("trigger", "stop_pendente_nao_executado")
        .in("related_order_id", openIdsToday)
        .gte("created_at", new Date(Date.now() - 180_000).toISOString());
      const stillOpen = new Set<string>();
      for (const ev of pendEvents ?? []) {
        const o = openToday.find((x: any) => x.id === ev.related_order_id);
        if (!o) continue;
        const dir = o.side === "buy" ? 1 : -1;
        const stopLevel = Number(
          ev.diagnostic_payload?.stop_level
            ?? (Number(o.entry_price) - dir * Number(ev.limit_value ?? 0)),
        );
        const live = priceByRun[o.simulation_run_id];
        if (live != null && Number.isFinite(stopLevel) && stopLevel > 0) {
          const stillCrossed = dir === 1 ? live <= stopLevel : live >= stopLevel;
          if (!stillCrossed) continue;
        }
        stillOpen.add(ev.related_order_id);
      }
      stopsPendentes = stillOpen.size;
    }

    // Saúde da cotação: idade do último tick por ativo das runs ativas.
    const quotesHealth: { symbol: string; age_s: number | null; stale: boolean }[] = [];
    const quoteGuardLimitS = 45;
    for (const symbol of Array.from(new Set(runList.map((r) => r.symbol)))) {
      const asset = profiles[symbol] ?? WIN_FALLBACK_ASSET_PROFILE;
      const candidates = Array.from(new Set([asset.symbol, asset.quote_symbol, symbol].filter(Boolean)));
      // Uma consulta por símbolo (índice user_id+symbol+tick_ts): a lista de
      // símbolos numa só consulta não usa o índice e varre a tabela de ticks.
      const tickTsList = await Promise.all((candidates as string[]).map(async (sym) => {
        const { data: q } = await (supabase as any).from("b3_mt5sim_quotes")
          .select("tick_ts").eq("user_id", userId).eq("symbol", sym)
          .order("tick_ts", { ascending: false }).limit(1);
        return q?.[0]?.tick_ts ? new Date(q[0].tick_ts).getTime() : null;
      }));
      const validTs = tickTsList.filter((t): t is number => t != null);
      const tickTs = validTs.length ? Math.max(...validTs) : null;
      const ageS = tickTs == null ? null : Math.max(0, Math.round((Date.now() - tickTs) / 1000));
      quotesHealth.push({ symbol, age_s: ageS, stale: ageS == null || ageS > quoteGuardLimitS });
    }

    return {
      ...empty,
      saldo_dia_brl: saldoDia,
      se_fechasse_agora_brl: saldoDia + abertoPos + abertoNeg,
      exposicao_atual_brl: exposicaoAtual * 1.3,
      robots_posicionados: posicionados,
      lucro_bruto_brl: lucroBruto,
      prejuizo_bruto_brl: prejuizoBruto,
      aberto_positivo_brl: abertoPos,
      aberto_negativo_brl: abertoNeg,
      melhor_robo: ranked[0] ?? null,
      pior_robo: ranked.length > 1 ? ranked[ranked.length - 1] : null,
      pico_exposicao_brl: picoM * 1.3,
      pico_exposicao_hora: horaPico,
      pico_posicoes: picoQ,
      stops_pendentes: stopsPendentes,
      quotes_health: quotesHealth,
      quote_guard_limit_s: quoteGuardLimitS,
    };
  });



// Botão de fechamento manual por modo. Usa a MESMA cadeia de validação de
// cotação que o motor automático (B3QuoteProvider + getB3ExecutionAudit +
// assertB3StrictMt5ExecutionAudit) — ou seja, se a cotação estiver vencida,
// o fechamento manual é recusado exatamente como o fechamento automático
// seria, em vez de fechar "no escuro" com preço desatualizado.
export const closeModeOrderManually = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { run_id: string; mode: Mode }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: run } = await supabase.from("b3_simulation_runs")
      .select("*").eq("id", data.run_id).eq("user_id", userId).maybeSingle();
    if (!run) throw new Error("Simulação não encontrada.");
    const { data: mode } = await (supabase as any).from("b3_simulation_modes")
      .select("*").eq("simulation_run_id", data.run_id).eq("mode", data.mode).eq("user_id", userId).maybeSingle();
    if (!mode) throw new Error("Modo não encontrado nessa simulação.");
    const { data: open } = await (supabase as any).from("b3_simulation_orders")
      .select("*").eq("simulation_run_id", data.run_id).eq("mode", data.mode).eq("user_id", userId)
      .eq("status", "open").maybeSingle();
    if (!open) throw new Error("Não há posição aberta nesse modo agora.");

    const asset = await loadAssetProfile(supabase, run.symbol);
    const priceSrc = await B3QuoteProvider(supabase, userId, {
      symbol: asset.quote_symbol, contract: asset.contract_code, base: Number(asset.base_price_fallback),
      expectedSymbol: asset.symbol, tickSize: Number(asset.tick_size),
      spreadMaxPoints: Number(asset.spread_max_price), priceDeviationLimit: Number(asset.price_deviation_limit),
      indicatorTimeframe: asset.indicator_timeframe === "m1" ? "m1" : "tick",
    });
    const exitAudit = getB3ExecutionAudit(priceSrc, open.side, "exit", "closeModeOrderManually");
    if (priceSrc.source === "mt5_xp_demo") assertB3StrictMt5ExecutionAudit(exitAudit, "closeModeOrderManually", asset.symbol);

    const closed = await closeOrder(supabase, userId, run, mode, open, exitAudit, "manual_close_user", [], asset);
    return { ok: true, closed };
  });

// Botão de pânico: fecha toda posição aberta nos 5 modos dessa simulação e
// desativa (enabled=false) os 5, pra nada reabrir sozinho depois. Continua
// mesmo se algum modo individual falhar ao fechar (ex: sem posição aberta
// naquele modo) — reporta o resultado de cada um em vez de abortar tudo.
export const closeAllModesManually = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { run_id: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: run } = await supabase.from("b3_simulation_runs")
      .select("*").eq("id", data.run_id).eq("user_id", userId).maybeSingle();
    if (!run) throw new Error("Simulação não encontrada.");

    const asset = await loadAssetProfile(supabase, run.symbol);
    const priceSrc = await B3QuoteProvider(supabase, userId, {
      symbol: asset.quote_symbol, contract: asset.contract_code, base: Number(asset.base_price_fallback),
      expectedSymbol: asset.symbol, tickSize: Number(asset.tick_size),
      spreadMaxPoints: Number(asset.spread_max_price), priceDeviationLimit: Number(asset.price_deviation_limit),
      indicatorTimeframe: asset.indicator_timeframe === "m1" ? "m1" : "tick",
    });

    const results: Record<string, any> = {};
    for (const modeName of MODES) {
      try {
        const { data: mode } = await (supabase as any).from("b3_simulation_modes")
          .select("*").eq("simulation_run_id", data.run_id).eq("mode", modeName).eq("user_id", userId).maybeSingle();
        const { data: open } = await (supabase as any).from("b3_simulation_orders")
          .select("*").eq("simulation_run_id", data.run_id).eq("mode", modeName).eq("user_id", userId)
          .eq("status", "open").maybeSingle();
        if (!mode || !open) { results[modeName] = { closed: false, reason: "sem posição aberta" }; continue; }
        const exitAudit = getB3ExecutionAudit(priceSrc, open.side, "exit", "closeAllModesManually");
        if (priceSrc.source === "mt5_xp_demo") assertB3StrictMt5ExecutionAudit(exitAudit, "closeAllModesManually", asset.symbol);
        const closed = await closeOrder(supabase, userId, run, mode, open, exitAudit, "manual_close_all_user", [], asset);
        results[modeName] = { closed: true, result: closed };
      } catch (e) {
        results[modeName] = { closed: false, reason: (e as Error).message };
      }
    }

    // Pausa os 5 modos — evita qualquer entrada nova até o usuário reativar
    // manualmente cada um (mesmo padrão do toggle "enabled" já existente).
    await (supabase as any).from("b3_simulation_mode_settings")
      .update({ enabled: false })
      .eq("simulation_run_id", data.run_id).eq("user_id", userId);

    return { ok: true, results };
  });

// ───────────────────── B3 Protection: state & history ─────────────────────
export const getB3ProtectionState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { run_id: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: rows, error } = await (supabase as any).from("b3_simulation_modes")
      .select("id, mode, protection_state, target_reached_at, profit_at_target_brl, trades_at_target, peak_profit_after_target_brl, profit_after_target_brl, trades_after_target, consecutive_losses_after_target, protection_block_reason, protection_day_key, total_trades, realized_pnl")
      .eq("simulation_run_id", data.run_id).eq("user_id", userId);
    if (error) throw error;
    return rows ?? [];
  });

export const listB3ProtectionHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { from?: string; to?: string; mode?: Mode; run_id?: string; limit?: number }) => d ?? {})
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let q = (supabase as any).from("b3_daily_protection_history")
      .select("*").eq("user_id", userId)
      .order("day_key", { ascending: false })
      .limit(Math.min(500, Math.max(1, Number(data.limit ?? 200))));
    if (data.from) q = q.gte("day_key", data.from);
    if (data.to) q = q.lte("day_key", data.to);
    if (data.mode) q = q.eq("mode", data.mode);
    if (data.run_id) q = q.eq("simulation_run_id", data.run_id);
    const { data: rows, error } = await q;
    if (error) throw error;
    return rows ?? [];
  });

// ─────────── Cockpit: comandos separados (zerar posições x desligar robôs) ───────────
// Fecha toda posição aberta dos 5 modos da run SEM desligar nenhum modo.
// Espelha closeAllModesManually, mas sem o update de enabled=false: o usuário
// pediu para separar "zerar posições" de "desligar robôs".
export const closeAllPositionsOnly = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { run_id: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: run } = await supabase.from("b3_simulation_runs")
      .select("*").eq("id", data.run_id).eq("user_id", userId).maybeSingle();
    if (!run) throw new Error("Simulação não encontrada.");

    const asset = await loadAssetProfile(supabase, run.symbol);
    const priceSrc = await B3QuoteProvider(supabase, userId, {
      symbol: asset.quote_symbol, contract: asset.contract_code, base: Number(asset.base_price_fallback),
      expectedSymbol: asset.symbol, tickSize: Number(asset.tick_size),
      spreadMaxPoints: Number(asset.spread_max_price), priceDeviationLimit: Number(asset.price_deviation_limit),
      indicatorTimeframe: asset.indicator_timeframe === "m1" ? "m1" : "tick",
    });

    const results: Record<string, any> = {};
    for (const modeName of MODES) {
      try {
        const { data: mode } = await (supabase as any).from("b3_simulation_modes")
          .select("*").eq("simulation_run_id", data.run_id).eq("mode", modeName).eq("user_id", userId).maybeSingle();
        const { data: open } = await (supabase as any).from("b3_simulation_orders")
          .select("*").eq("simulation_run_id", data.run_id).eq("mode", modeName).eq("user_id", userId)
          .eq("status", "open").maybeSingle();
        if (!mode || !open) { results[modeName] = { closed: false, reason: "sem posição aberta" }; continue; }
        const exitAudit = getB3ExecutionAudit(priceSrc, open.side, "exit", "closeAllPositionsOnly");
        if (priceSrc.source === "mt5_xp_demo") assertB3StrictMt5ExecutionAudit(exitAudit, "closeAllPositionsOnly", asset.symbol);
        const closed = await closeOrder(supabase, userId, run, mode, open, exitAudit, "manual_close_all_user", [], asset);
        results[modeName] = { closed: true, result: closed };
      } catch (e) {
        results[modeName] = { closed: false, reason: (e as Error).message };
      }
    }
    return { ok: true, results };
  });

// Desliga (enabled=false) os 5 modos da run, sem tocar em posição aberta.
export const disableAllModes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { run_id: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await (supabase as any).from("b3_simulation_mode_settings")
      .update({ enabled: false })
      .eq("simulation_run_id", data.run_id).eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });

// Reativa um modo que bateu o stop diário. Exige motivo escrito (>= 20 chars),
// é recusado quando o ambiente da conta não é simulação, e registra a
// intervenção em b3_intervencoes (symbol = raiz do ativo).
export const resetB3DailyStop = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { run_id: string; mode: Mode; motivo: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const motivo = (data.motivo ?? "").trim();
    if (motivo.length < 20) throw new Error("Informe um motivo com pelo menos 20 caracteres.");

    const { data: tset } = await (supabase as any).from("b3_trading_settings")
      .select("environment").eq("user_id", userId).maybeSingle();
    const environment = (tset?.environment ?? "simulation") as string;
    if (environment !== "simulation") {
      throw new Error("O stop diário não é contornável em conta real. Reativação bloqueada.");
    }

    const { data: run } = await (supabase as any).from("b3_simulation_runs")
      .select("id, symbol, variant").eq("id", data.run_id).eq("user_id", userId).maybeSingle();
    if (!run) throw new Error("Simulação não encontrada.");
    const { data: mode } = await (supabase as any).from("b3_simulation_modes")
      .select("id, current_status, realized_pnl, current_balance, initial_balance")
      .eq("simulation_run_id", data.run_id).eq("mode", data.mode).eq("user_id", userId).maybeSingle();
    if (!mode) throw new Error("Modo não encontrado nessa simulação.");
    if (mode.current_status !== "blocked_stop") throw new Error("Esse robô não está bloqueado por stop diário.");

    const { data: cfg } = await (supabase as any).from("b3_simulation_mode_settings")
      .select("daily_loss_limit_brl").eq("simulation_run_id", data.run_id)
      .eq("mode", data.mode).eq("user_id", userId).maybeSingle();
    const asset = await loadAssetProfile(supabase, run.symbol);

    const { error: updErr } = await (supabase as any).from("b3_simulation_modes")
      .update({
        current_status: "operando",
        protection_state: "operating_normal",
        protection_block_reason: null,
        // Reativação manual zera o pico do dia, senão a trava de devolução de
        // pico volta a bloquear no tick seguinte.
        day_peak_profit_brl: 0,
        status_changed_at: new Date().toISOString(),
        status_reason: "reset_stop_diario (painel)",
      })
      .eq("id", mode.id).eq("user_id", userId);
    if (updErr) throw updErr;

    await (supabase as any).from("b3_intervencoes").insert({
      user_id: userId,
      trade_date: currentB3SessionDate(),
      symbol: asset.quote_symbol,
      variant: run.variant ?? "indicador",
      mode: data.mode,
      acao: "reset_stop_diario",
      pnl_no_momento: Number(mode.current_balance ?? 0) - Number(mode.initial_balance ?? 0),
      limite_vigente: cfg?.daily_loss_limit_brl == null ? null : Number(cfg.daily_loss_limit_brl),
      motivo,
      origem: "painel",
    });

    return { ok: true };
  });


// ─────────────────── painel por ativo (/b3/ativo/$symbol) ───────────────────
// Somente LEITURA. Nenhuma regra de entrada, saída, trailing, limiar,
// quantidade, capital, taxa ou janela é lida/alterada aqui: apenas soma
// b3_simulation_orders, b3_simulation_mode_settings e b3_asset_profiles.
// Datas sempre em America/Sao_Paulo (currentB3SessionDate).
export const getB3AssetDashboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { symbol: string; variant?: string; mode?: string; de?: string; ate?: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const root = String(data.symbol ?? "").toUpperCase();
    const variantFilter = data.variant && data.variant !== "all" ? data.variant : null;
    const modeFilter = data.mode && data.mode !== "all" ? data.mode : null;
    const today = currentB3SessionDate();
    const isDate = (s: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ""));
    let de = isDate(data.de) ? String(data.de) : today;
    let ate = isDate(data.ate) ? String(data.ate) : de;
    if (de > ate) { const t = de; de = ate; ate = t; }
    const sessionDate = ate;
    const addDays = (d: string, n: number) => {
      const dt = new Date(`${d}T12:00:00.000Z`);
      dt.setUTCDate(dt.getUTCDate() + n);
      return dt.toISOString().slice(0, 10);
    };
    // Fronteiras do período em UTC — o dia do pregão BRT começa às 03:00Z.
    const dayStartUtc = `${de}T03:00:00.000Z`;
    const dayEndUtc = `${addDays(ate, 1)}T03:00:00.000Z`;
    const multiDay = de !== ate;
    const brtDay = (iso: string | number | Date) =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
      }).format(new Date(iso));


    const rootOf = (s: string) => {
      const up = String(s ?? "").toUpperCase();
      const m = up.match(/^([A-Z]{3})[A-Z]\d{2}$/);
      return m ? m[1] : up;
    };

    const { data: allRuns } = await (supabase as any).from("b3_simulation_runs")
      .select("id, symbol, variant, status").eq("user_id", userId);
    // Runs do ativo em qualquer status — pregões passados podem ter runs encerradas.
    const assetRuns = (allRuns ?? []).filter((r: any) => rootOf(r.symbol) === root);
    const variantsPresent = Array.from(new Set(assetRuns.map((r: any) => r.variant ?? "indicador"))) as string[];
    const runList = variantFilter
      ? assetRuns.filter((r: any) => (r.variant ?? "indicador") === variantFilter)
      : assetRuns;

    // Dias com pregão (dias que de fato têm ordens) — usados pelas setas de
    // navegação, que pulam fim de semana e dia sem pregão.
    const { data: diasScore } = await (supabase as any).from("b3_robot_daily_score")
      .select("trade_date, symbol").eq("user_id", userId)
      .gte("trade_date", addDays(today, -400)).order("trade_date", { ascending: true }).limit(20000);
    const diasDisponiveis = Array.from(new Set(
      ((diasScore ?? []) as any[])
        .filter((r) => rootOf(String(r.symbol)) === root)
        .map((r) => String(r.trade_date)),
    )).sort() as string[];

    const base = {
      session_date: sessionDate,
      periodo: { de, ate },
      multi_day: multiDay,
      dias_disponiveis: diasDisponiveis,
      dias: [] as any[],
      orders: [] as any[],
      root,
      variant: variantFilter ?? "all",
      mode: modeFilter ?? "all",
      variants_present: variantsPresent,
      // Ativos com run ativa — os chips da tela vêm daqui, então um ativo novo
      // aparece sozinho no dia em que a run for criada, sem novo deploy.
      assets_present: Array.from(new Set(
        ((allRuns ?? []) as any[]).filter((r) => r.status === "running").map((r) => rootOf(r.symbol)),
      )).sort() as string[],
      contracts: Array.from(new Set(assetRuns.map((r: any) => r.symbol))) as string[],
      quote_symbol: null as string | null,
      tick_size: 5,
      scale_brl: 0,
      resultado_dia_brl: 0,
      realizado_brl: 0,
      aberto_brl: 0,
      pior_ponto_brl: 0,
      pior_ponto_pct: 0,
      ganhos_brl: 0,
      perdas_brl: 0,
      ops_total: 0,
      ops_lucro: 0,
      pico_exposicao_brl: 0,
      pico_exposicao_hora: null as string | null,
      pico_exposicao_data: null as string | null,
      pico_contratos: 0,
      groups: [] as any[],
    };
    if (!runList.length) return base;


    const profiles: Record<string, any> = {};
    for (const symbol of Array.from(new Set(runList.map((r: any) => r.symbol))) as string[]) {
      profiles[symbol] = await loadAssetProfile(supabase, symbol);
    }
    const firstProfile = profiles[runList[0].symbol];
    const runById: Record<string, any> = {};
    for (const r of runList) runById[r.id] = r;
    const runIds = runList.map((r: any) => r.id);

    const [{ data: orders }, { data: snaps }, { data: settings }, { data: saudeRows }] = await Promise.all([
      (supabase as any).from("b3_simulation_orders")
        .select("id, simulation_run_id, mode, side, status, quantity, entry_price, exit_price, entry_time, exit_time, net_result_brl, gross_result_points, close_reason, created_at")
        .eq("user_id", userId).in("simulation_run_id", runIds).in("status", ["open", "closed"])
        .gte("entry_time", dayStartUtc).lt("entry_time", dayEndUtc)
        .order("entry_time", { ascending: true }).limit(20000),
      (supabase as any).from("b3_simulation_market_snapshots")
        .select("simulation_run_id, price, market_time")
        .eq("user_id", userId).in("simulation_run_id", runIds)
        .order("market_time", { ascending: false }).limit(200),
      (supabase as any).from("b3_simulation_mode_settings")
        .select("simulation_run_id, mode, enabled, daily_loss_limit_brl")
        .eq("user_id", userId).in("simulation_run_id", runIds),
      (supabase as any).from("b3_pregao_saude")
        .select("trade_date, limpo, motivo_sujo")
        .eq("user_id", userId).gte("trade_date", de).lte("trade_date", ate).limit(2000),
    ]);

    const saudeByDay: Record<string, any> = {};
    for (const s of (saudeRows ?? []) as any[]) saudeByDay[String(s.trade_date)] = s;

    const priceByRun: Record<string, number> = {};
    for (const s of snaps ?? []) {
      if (priceByRun[s.simulation_run_id] == null && Number(s.price) > 0) {
        priceByRun[s.simulation_run_id] = Number(s.price);
      }
    }

    // Fundo de escala = soma dos limites de perda dos modos HABILITADOS
    // das runs consideradas (respeita o filtro de modalidade/modo). Deduplica
    // por modalidade+modo: runs repetidas do mesmo robô não dobram a escala.
    const settingByKey: Record<string, any> = {};
    const scaleByRobot: Record<string, number> = {};
    for (const s of settings ?? []) {
      settingByKey[`${s.simulation_run_id}|${s.mode}`] = s;
      if (modeFilter && s.mode !== modeFilter) continue;
      if (s.enabled === false) continue;
      const run = runById[s.simulation_run_id];
      if (!run) continue;
      const k = `${run.variant ?? "indicador"}|${s.mode}`;
      scaleByRobot[k] = Math.max(scaleByRobot[k] ?? 0, Number(s.daily_loss_limit_brl ?? 0) || 0);
    }
    const scale = Object.values(scaleByRobot).reduce((a, b) => a + b, 0);

    const nowMs = Date.now();
    const rows = (orders ?? []).filter((o: any) => !modeFilter || o.mode === modeFilter);


    type Agg = { ops: number; wins: number; ganhos: number; perdas: number; resultado: number; aberto: number; open: boolean };
    const perMode = new Map<string, Agg>(); // `${variant}|${mode}`
    const ensure = (k: string) => {
      if (!perMode.has(k)) perMode.set(k, { ops: 0, wins: 0, ganhos: 0, perdas: 0, resultado: 0, aberto: 0, open: false });
      return perMode.get(k)!;
    };

    let realizado = 0, aberto = 0, ganhos = 0, perdas = 0, opsTotal = 0, opsLucro = 0;
    const events: { t: number; dm: number; dq: number }[] = [];
    const closedTimeline: { t: number; net: number }[] = [];
    type DayAgg = { resultado: number; ops: number; wins: number };
    const perDay = new Map<string, DayAgg>();
    const ensureDay = (d: string) => {
      if (!perDay.has(d)) perDay.set(d, { resultado: 0, ops: 0, wins: 0 });
      return perDay.get(d)!;
    };
    const orderRows: any[] = [];
    const hhmm = (t: number) => new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit",
    }).format(new Date(t));

    for (const o of rows) {
      const run = runById[o.simulation_run_id];
      if (!run) continue;
      const asset = profiles[run.symbol] ?? WIN_FALLBACK_ASSET_PROFILE;
      const variant = (run.variant ?? "indicador") as string;
      const agg = ensure(`${variant}|${o.mode}`);
      const qty = Number(o.quantity ?? 0);
      const entry = Number(o.entry_price ?? 0);

      const margem = String(asset.margin_model ?? "per_contract") === "per_contract"
        ? Number(asset.margin_per_contract_brl ?? 0) * qty
        : entry * qty * Number(asset.margin_percent_position ?? 0) / 100;
      const tIn = new Date(o.entry_time ?? o.created_at ?? nowMs).getTime();
      const tOut = o.exit_time ? new Date(o.exit_time).getTime() : nowMs;
      events.push({ t: tIn, dm: margem, dq: qty });
      events.push({ t: tOut, dm: -margem, dq: -qty });
      const dia = brtDay(tIn);
      const dayAgg = ensureDay(dia);

      if (o.status === "closed") {
        const net = Number(o.net_result_brl ?? 0);
        realizado += net;
        opsTotal += 1;
        agg.ops += 1;
        agg.resultado += net;
        dayAgg.ops += 1;
        dayAgg.resultado += net;
        if (net > 0) { ganhos += net; opsLucro += 1; agg.ganhos += net; agg.wins += 1; dayAgg.wins += 1; }
        else { perdas += net; agg.perdas += net; }
        closedTimeline.push({ t: tOut, net });
      } else {
        agg.open = true;
        const live = priceByRun[o.simulation_run_id];
        if (live != null) {
          const dir = o.side === "buy" ? 1 : -1;
          const brl = (live - entry) * dir * Number(asset.tick_value_brl ?? POINT_VALUE_BRL) * qty;
          aberto += brl;
          agg.aberto += brl;
          agg.resultado += brl;
        }
      }

      orderRows.push({
        id: o.id,
        trade_date: dia,
        hora_entrada: hhmm(tIn),
        hora_saida: o.exit_time ? hhmm(tOut) : null,
        variant, mode: o.mode, side: o.side, status: o.status,
        quantity: qty,
        entry_price: entry,
        exit_price: o.exit_price == null ? null : Number(o.exit_price),
        pontos: o.gross_result_points == null ? null : Number(o.gross_result_points),
        net_brl: o.status === "closed" ? Number(o.net_result_brl ?? 0) : null,
        close_reason: o.close_reason ?? null,
      });
    }


    // Pico de exposição (margem simultânea × 1,30) por linha do tempo de eventos.
    events.sort((a, b) => a.t - b.t || b.dq - a.dq);
    let accM = 0, accQ = 0, picoM = 0, picoQ = 0, picoT: number | null = null;
    for (const e of events) {
      accM += e.dm; accQ += e.dq;
      if (accM > picoM) { picoM = accM; picoT = e.t; picoQ = Math.max(picoQ, accQ); }
      if (accQ > picoQ) picoQ = accQ;
    }
    const horaPico = picoT == null ? null : new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit",
    }).format(new Date(picoT));

    // Pior ponto do dia: mínimo do acumulado realizado ao longo do dia,
    // considerando também o resultado atual (realizado + aberto).
    closedTimeline.sort((a, b) => a.t - b.t);
    let acc = 0, pior = 0;
    for (const c of closedTimeline) { acc += c.net; if (acc < pior) pior = acc; }
    const resultado = realizado + aberto;
    if (resultado < pior) pior = resultado;

    const modeOrder: Record<string, number> = {};
    MODES.forEach((m, i) => { modeOrder[m] = i; });
    const groupMap = new Map<string, any[]>();
    for (const [key, agg] of perMode.entries()) {
      const [variant, mode] = key.split("|");
      const run = runList.find((r: any) => (r.variant ?? "indicador") === variant);
      const st = run ? settingByKey[`${run.id}|${mode}`] : null;
      if (!groupMap.has(variant)) groupMap.set(variant, []);
      groupMap.get(variant)!.push({
        variant, mode,
        run_id: run?.id ?? null, symbol: run?.symbol ?? null,
        ops: agg.ops,
        wins: agg.wins,
        hit_rate: agg.ops ? (agg.wins / agg.ops) * 100 : 0,
        ganhos_brl: agg.ganhos,
        perdas_brl: agg.perdas,
        resultado_brl: agg.resultado,
        aberto_brl: agg.aberto,
        tem_posicao: agg.open,
        enabled: st ? st.enabled !== false : true,
        daily_loss_limit_brl: st?.daily_loss_limit_brl == null ? null : Number(st.daily_loss_limit_brl),
      });
    }
    // Modos habilitados sem nenhuma ordem hoje também aparecem (card zerado).
    for (const s of settings ?? []) {
      if (modeFilter && s.mode !== modeFilter) continue;
      const run = runById[s.simulation_run_id];
      if (!run) continue;
      const variant = (run.variant ?? "indicador") as string;
      if (!groupMap.has(variant)) groupMap.set(variant, []);
      const list = groupMap.get(variant)!;
      if (list.some((c) => c.mode === s.mode)) continue;
      list.push({
        variant, mode: s.mode, run_id: run.id, symbol: run.symbol,
        ops: 0, wins: 0, hit_rate: 0,
        ganhos_brl: 0, perdas_brl: 0, resultado_brl: 0, aberto_brl: 0, tem_posicao: false,
        enabled: s.enabled !== false,
        daily_loss_limit_brl: s.daily_loss_limit_brl == null ? null : Number(s.daily_loss_limit_brl),
      });
    }

    const groups = Array.from(groupMap.entries())
      .map(([variant, modes]) => {
        const sorted = modes.sort((a, b) => (modeOrder[a.mode] ?? 99) - (modeOrder[b.mode] ?? 99));
        const ops = sorted.reduce((s, m) => s + m.ops, 0);
        const wins = sorted.reduce((s, m) => s + m.wins, 0);
        return {
          variant, modes: sorted, ops, wins,
          hit_rate: ops ? (wins / ops) * 100 : 0,
          resultado_brl: sorted.reduce((s, m) => s + m.resultado_brl, 0),
          ganhos_brl: sorted.reduce((s, m) => s + m.ganhos_brl, 0),
          perdas_brl: sorted.reduce((s, m) => s + m.perdas_brl, 0),
        };
      })
      .sort((a, b) => a.variant.localeCompare(b.variant));

    // Série por pregão — usada pela barra por dia quando o período tem mais
    // de um dia. Marca dia sujo (b3_pregao_saude.limpo = false).
    const dias = Array.from(perDay.entries())
      .map(([d, v]) => ({
        trade_date: d,
        resultado_brl: v.resultado,
        ops: v.ops,
        wins: v.wins,
        limpo: saudeByDay[d]?.limpo !== false,
        motivo_sujo: saudeByDay[d]?.motivo_sujo ?? null,
      }))
      .sort((a, b) => a.trade_date.localeCompare(b.trade_date));

    return {
      ...base,
      dias,
      orders: orderRows,
      quote_symbol: firstProfile?.quote_symbol ?? null,
      tick_size: Number(firstProfile?.tick_size ?? 5),
      scale_brl: scale,
      resultado_dia_brl: resultado,
      realizado_brl: realizado,
      aberto_brl: aberto,
      pior_ponto_brl: pior,
      pior_ponto_pct: scale > 0 ? Math.min(100, (Math.abs(Math.min(0, pior)) / scale) * 100) : 0,
      ganhos_brl: ganhos,
      perdas_brl: perdas,
      ops_total: opsTotal,
      ops_lucro: opsLucro,
      pico_exposicao_brl: picoM * 1.3,
      pico_exposicao_hora: horaPico,
      pico_exposicao_data: picoT == null ? null : brtDay(picoT),
      pico_contratos: picoQ,
      groups,
    };

  });


// ─────────────────────── BI analítico (/b3/bi) ───────────────────────
// Somente LEITURA. Lê apenas b3_robot_daily_score (uma linha por dia/ativo/
// modalidade/modo, com pico_margem_brl já com folga) e b3_pregao_saude
// (veredito de pregão limpo). Nada do motor é lido ou alterado aqui.
// Datas em America/Sao_Paulo (as colunas já são `date` do dia BRT).
export const getB3BiDashboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    de: string; ate: string;
    symbol?: string; variant?: string; mode?: string;
    excluir_intervencao?: boolean;
  }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const de = String(data.de);
    const ate = String(data.ate);
    const fSymbol = data.symbol && data.symbol !== "all" ? String(data.symbol).toUpperCase() : null;
    const fVariant = data.variant && data.variant !== "all" ? String(data.variant) : null;
    const fMode = data.mode && data.mode !== "all" ? String(data.mode) : null;
    const excluirIntervencao = data.excluir_intervencao !== false;

    const [{ data: rowsRaw }, { data: saudeRaw }] = await Promise.all([
      (supabase as any).from("b3_robot_daily_score")
        .select("trade_date, symbol, variant, mode, net_brl, trades, wins, win_rate, max_dd_brl, score, rank_day, qualified, pico_margem_brl, pico_contratos, pico_hora, dia_com_intervencao, motivo_intervencao")
        .eq("user_id", userId).gte("trade_date", de).lte("trade_date", ate)
        .order("trade_date", { ascending: true }).limit(20000),
      (supabase as any).from("b3_pregao_saude")
        .select("trade_date, limpo, motivo_sujo, fechamentos_manuais, stops_pendentes, cotacao_parada, guard_preco, minutos_com_candle, minutos_esperados")
        .eq("user_id", userId).gte("trade_date", de).lte("trade_date", ate)
        .order("trade_date", { ascending: true }).limit(2000),
    ]);

    const saude = (saudeRaw ?? []) as any[];
    const saudeByDay: Record<string, any> = {};
    for (const s of saude) saudeByDay[String(s.trade_date)] = s;

    const rows = ((rowsRaw ?? []) as any[]).filter((r) => {
      if (excluirIntervencao && r.dia_com_intervencao === true) return false;
      if (fSymbol && String(r.symbol).toUpperCase() !== fSymbol) return false;
      if (fVariant && String(r.variant ?? "indicador") !== fVariant) return false;
      if (fMode && String(r.mode) !== fMode) return false;
      return true;
    });

    const N = (v: any) => Number(v ?? 0);
    const capOf = (list: any[]) => list.reduce((m, r) => Math.max(m, N(r.pico_margem_brl)), 0);
    const netOf = (list: any[]) => list.reduce((s, r) => s + N(r.net_brl), 0);

    // ── cartões do cenário
    const total_positivo = rows.filter((r) => N(r.net_brl) > 0).reduce((s, r) => s + N(r.net_brl), 0);
    const total_negativo = rows.filter((r) => N(r.net_brl) < 0).reduce((s, r) => s + N(r.net_brl), 0);
    const resultado = total_positivo + total_negativo;
    const pico_investimento = capOf(rows);
    const retorno_pct = pico_investimento > 0 ? (resultado / pico_investimento) * 100 : 0;

    // ── torre por dia
    const byDay = new Map<string, any[]>();
    for (const r of rows) {
      const d = String(r.trade_date);
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d)!.push(r);
    }
    const dias = Array.from(byDay.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([d, list]) => {
        const s = saudeByDay[d];
        return {
          trade_date: d,
          resultado_brl: netOf(list),
          trades: list.reduce((x, r) => x + N(r.trades), 0),
          pico_margem_brl: capOf(list),
          limpo: s ? s.limpo !== false : true,
          motivo_sujo: s?.motivo_sujo ?? null,
          intervencao: list.some((r) => r.dia_com_intervencao === true),
        };
      });
    const pregoes = dias.length;
    const pregoes_positivos = dias.filter((d) => d.resultado_brl > 0).length;
    const pregoes_negativos = dias.filter((d) => d.resultado_brl < 0).length;
    const pregoes_limpos = dias.filter((d) => d.limpo).length;

    // ── composição por dimensão
    const compose = (keyOf: (r: any) => string) => {
      const m = new Map<string, any[]>();
      for (const r of rows) {
        const k = keyOf(r);
        if (!m.has(k)) m.set(k, []);
        m.get(k)!.push(r);
      }
      return Array.from(m.entries()).map(([label, list]) => {
        const res = netOf(list);
        const cap = capOf(list);
        return {
          label,
          resultado_brl: res,
          capital_brl: cap,
          retorno_pct: cap > 0 ? (res / cap) * 100 : 0,
          trades: list.reduce((x, r) => x + N(r.trades), 0),
          dias: new Set(list.map((r) => String(r.trade_date))).size,
        };
      }).sort((a, b) => b.resultado_brl - a.resultado_brl);
    };

    // Rótulo puramente textual do servidor: a chave `mode` é a identidade.
    const modeLabelOf = (m: string) => String(m ?? "");
    const composicao = {
      robo: compose((r) => `${r.symbol} · ${r.variant ?? "indicador"} · ${modeLabelOf(r.mode)}`),
      ativo: compose((r) => String(r.symbol).toUpperCase()),
      modalidade: compose((r) => String(r.variant ?? "indicador")),
      modo: compose((r) => modeLabelOf(r.mode)),
    };

    // ── pizza: capital exigido por ativo (MAX por ativo)
    const capitalPorAtivo = composicao.ativo
      .map((a) => ({ label: a.label, capital_brl: a.capital_brl }))
      .filter((a) => a.capital_brl > 0)
      .sort((a, b) => b.capital_brl - a.capital_brl);
    const capital_total_brl = capitalPorAtivo.reduce((s, a) => s + a.capital_brl, 0);

    // ── tabela por robô
    const roboMap = new Map<string, any[]>();
    for (const r of rows) {
      const k = `${r.symbol}|${r.variant ?? "indicador"}|${r.mode}`;
      if (!roboMap.has(k)) roboMap.set(k, []);
      roboMap.get(k)!.push(r);
    }
    const robos = Array.from(roboMap.entries()).map(([k, list]) => {
      const [symbol, variant, mode] = k.split("|");
      const res = netOf(list);
      const cap = capOf(list);
      const trades = list.reduce((x, r) => x + N(r.trades), 0);
      const wins = list.reduce((x, r) => x + N(r.wins), 0);
      return {
        symbol, variant, mode,
        dias: new Set(list.map((r) => String(r.trade_date))).size,
        resultado_brl: res,
        capital_brl: cap,
        retorno_pct: cap > 0 ? (res / cap) * 100 : 0,
        pior_dd_brl: list.reduce((m, r) => Math.min(m, -Math.abs(N(r.max_dd_brl))), 0),
        trades, wins,
        acerto_pct: trades ? (wins / trades) * 100 : 0,
      };
    }).sort((a, b) => b.retorno_pct - a.retorno_pct);

    return {
      periodo: { de, ate },
      // Ativos que existem nos dados do período (antes dos filtros) — o filtro
      // de ativo da tela vem daqui, para não oferecer ativo sem histórico.
      symbols_present: Array.from(
        new Set(((rowsRaw ?? []) as any[]).map((r) => String(r.symbol).toUpperCase())),
      ).sort() as string[],
      filtros: {
        symbol: fSymbol ?? "all",
        variant: fVariant ?? "all",
        mode: fMode ?? "all",
        excluir_intervencao: excluirIntervencao,
      },
      cartoes: {
        total_positivo, total_negativo, resultado,
        pico_investimento, retorno_pct,
        pregoes, pregoes_positivos, pregoes_negativos, pregoes_limpos,
      },
      dias,
      composicao,
      capital_por_ativo: capitalPorAtivo,
      capital_total_brl,
      robos,
    };
  });
