// Guardião de saída — caminho enxuto e de cadência própria para POSIÇÕES ABERTAS.
//
// POR QUE EXISTE (pregão de 02/09/2026)
// 33 ordens fecharam além de 1,05× o stop contratado, fator médio 1,33×, custo
// do excesso R$ 1.460,09. Medido nos tiques brutos: no primeiro tique que
// cruzou o stop a perda era de 1,03× a 1,08× — quase todo o excesso apareceu
// ENTRE o toque e a execução. A causa não é a granularidade do dado (o motor já
// olha o candle do minuto corrente, montado de tique), é a FREQUÊNCIA: a gestão
// de posição vive dentro do tique completo, disparado a cada ~45 s.
//
// O QUE ESTE MÓDULO FAZ
// Só o que é crítico de risco: lê ordens abertas, lê a cotação corrente do
// ativo, confere stop / alvo / trailing / zero a zero e fecha quem cruzou.
// Sem classificadores, sem comitê, sem snapshot, sem busca de entrada. Por isso
// pode rodar muito mais vezes que o tique completo pelo mesmo custo.
//
// O QUE ESTE MÓDULO NÃO FAZ
// Não abre posição. Não muda parâmetro de robô. Não fecha por horário
// (zeragem/force_close), por freio de grupo nem por stop diário — isso continua
// exclusivo do tique completo, para não existirem duas autoridades sobre a
// mesma regra. Não afrouxa a auditoria: o preço executado é sempre o Bid/Ask
// corrente e fresco do MT5, exatamente como no tique completo.
//
// CORRIDA COM O TIQUE COMPLETO
// Os dois caminhos podem olhar a mesma ordem ao mesmo tempo. O fechamento aqui
// usa `onlyIfOpen`, então o UPDATE só vale se a linha ainda estiver aberta —
// quem chegar depois não fecha de novo nem soma o resultado duas vezes.

import { closeOrder, loadAssetProfile } from "@/lib/b3-simulation.functions";
import {
  B3QuoteProvider,
  getB3ExecutionAudit,
  assertB3StrictMt5ExecutionAudit,
  type B3PriceContextResult,
  type B3QuoteExecutionAudit,
} from "@/lib/b3-price-source.server";

export interface GuardiaoResultado {
  ordens_abertas: number;
  fechadas: number;
  ignoradas: number;
  erros: number;
  marcadas_a_mercado: number;
  janela_ms: number;
  detalhes: any[];
}

/** Config de saída de um robô, com defaults conservadores. */
function saidaCfg(cfg: any) {
  return {
    stop_pts: Number(cfg?.stop_pts ?? 0),
    gain_pts: Number(cfg?.gain_pts ?? 0),
    trailing_activation_pts: Number(cfg?.trailing_activation_pts ?? 0),
    trailing_giveback_pts: Number(cfg?.trailing_giveback_pts ?? 0),
    trailing_mode: String(cfg?.trailing_mode ?? "fixed"),
    breakeven_ativa_pts: Number(cfg?.breakeven_ativa_pts ?? 0),
    breakeven_folga_pts: Number(cfg?.breakeven_folga_pts ?? 0),
  };
}

export async function runB3GuardiaoSaida(supabase: any): Promise<GuardiaoResultado> {
  const t0 = Date.now();
  const detalhes: any[] = [];
  let fechadas = 0, ignoradas = 0, erros = 0, marcadas = 0;

  // 1) Ordens abertas de todos os usuários. É a leitura mais barata do sistema:
  //    em pregão normal são poucas dezenas de linhas.
  const { data: abertas, error: errAbertas } = await supabase
    .from("b3_simulation_orders")
    .select("*")
    .eq("status", "open");
  if (errAbertas) throw new Error(`guardião: falha ao ler ordens abertas — ${errAbertas.message}`);
  const ordens = abertas ?? [];
  if (!ordens.length) {
    const vazio: GuardiaoResultado = {
      ordens_abertas: 0, fechadas: 0, ignoradas: 0, erros: 0, marcadas_a_mercado: 0,
      janela_ms: Date.now() - t0, detalhes,
    };
    try {
      await supabase.from("system_logs").insert({
        event_type: "b3_guardiao_summary",
        source: "b3-guardiao-saida",
        severity: "info",
        message: `Guardião avaliou 0 posição(ões) em ${vazio.janela_ms} ms.`,
        technical_data: vazio,
      });
    } catch { /* log nunca derruba o guardião */ }
    return vazio;
  }

  // 2) Execuções e carteiras envolvidas (uma leitura por conjunto, não por ordem).
  const runIds = Array.from(new Set(ordens.map((o: any) => o.simulation_run_id)));
  const modeIds = Array.from(new Set(ordens.map((o: any) => o.simulation_mode_id)));
  const [{ data: runs }, { data: modos }] = await Promise.all([
    supabase.from("b3_simulation_runs").select("*").in("id", runIds),
    supabase.from("b3_simulation_modes").select("*").in("id", modeIds),
  ]);
  const runById = new Map<string, any>((runs ?? []).map((r: any) => [r.id, r]));
  const modeById = new Map<string, any>((modos ?? []).map((m: any) => [m.id, m]));

  // Configuração de saída por (execução, modo).
  const { data: settings } = await supabase
    .from("b3_simulation_mode_settings")
    .select("*")
    .in("simulation_run_id", runIds);
  const cfgKey = (runId: string, mode: string) => `${runId}:${mode}`;
  const cfgByKey = new Map<string, any>((settings ?? []).map((s: any) => [cfgKey(s.simulation_run_id, s.mode), s]));

  // 3) Cotação: uma leitura por (usuário + ativo), compartilhada por todos os
  //    robôs daquele ativo. O provedor ainda tem cache de 1,5 s por cima.
  const priceCache = new Map<string, B3PriceContextResult | null>();
  const assetCache = new Map<string, any>();

  const getAsset = async (symbol: string) => {
    if (!assetCache.has(symbol)) assetCache.set(symbol, await loadAssetProfile(supabase, symbol));
    return assetCache.get(symbol);
  };

  const getPrice = async (userId: string, asset: any): Promise<B3PriceContextResult | null> => {
    const key = `${userId}:${asset.symbol}`;
    if (priceCache.has(key)) return priceCache.get(key) ?? null;
    let info: B3PriceContextResult | null = null;
    try {
      info = await B3QuoteProvider(supabase, userId, {
        symbol: asset.quote_symbol, contract: asset.contract_code, base: Number(asset.base_price_fallback),
        expectedSymbol: asset.symbol, tickSize: Number(asset.tick_size),
        spreadMaxPoints: Number(asset.spread_max_price), priceDeviationLimit: Number(asset.price_deviation_limit),
        indicatorTimeframe: asset.indicator_timeframe === "m1" ? "m1" : "tick",
      });
    } catch {
      info = null;
    }
    priceCache.set(key, info);
    return info;
  };

  // 4) Histórico de tiques por (usuário + ativo), só quando trailing ou zero a
  //    zero estão ligados em alguma ordem daquele ativo — é a única parte que
  //    precisa olhar para trás. Uma consulta por ativo, nunca por ordem.
  const histCache = new Map<string, any[]>();
  const getHistorico = async (userId: string, quoteSymbol: string, desdeMs: number) => {
    const key = `${userId}:${quoteSymbol}`;
    if (histCache.has(key)) return histCache.get(key)!;
    let rows: any[] = [];
    try {
      const { data } = await supabase
        .from("b3_mt5sim_quotes")
        .select("received_at, last, bid, ask")
        .eq("user_id", userId)
        .eq("symbol", quoteSymbol)
        .gte("received_at", new Date(desdeMs).toISOString())
        .order("received_at", { ascending: true })
        .limit(5000);
      rows = (data ?? []).map((q: any) => ({
        market_time: q.received_at,
        quote_last: Number(q.last ?? 0) || Number(q.bid ?? 0) || Number(q.ask ?? 0),
      }));
    } catch {
      rows = [];
    }
    histCache.set(key, rows);
    return rows;
  };

  for (const open of ordens) {
    const run = runById.get(open.simulation_run_id);
    const m = modeById.get(open.simulation_mode_id);
    const userId = open.user_id;
    if (!run || !m || !userId) { ignoradas++; continue; }
    // Execução parada não é gerida aqui: o tique completo é que decide o
    // destino de posição órfã (inclusive zeragem por horário).
    if (run.status !== "running") { ignoradas++; continue; }

    try {
      const asset = await getAsset(run.symbol);
      const info = await getPrice(userId, asset);
      if (!info || info.source !== "mt5_xp_demo") { ignoradas++; continue; }

      // Cotação velha/bloqueada: o guardião não força nada. Preço ruim
      // executado com pressa é pior que a próxima passada.
      let markAudit: B3QuoteExecutionAudit;
      try {
        markAudit = getB3ExecutionAudit(info, open.side, "exit", "b3GuardiaoSaida");
        assertB3StrictMt5ExecutionAudit(markAudit, "b3GuardiaoSaida", asset.symbol);
      } catch {
        ignoradas++;
        continue;
      }

      const dirSign = open.side === "buy" ? 1 : -1;
      const markPrice = Number(markAudit.execution_price);
      const entry = Number(open.entry_price);
      if (!Number.isFinite(markPrice) || !Number.isFinite(entry) || entry <= 0) { ignoradas++; continue; }

      const cfg = saidaCfg(cfgByKey.get(cfgKey(open.simulation_run_id, open.mode)));
      const stopPts = Number(open.stop_pts ?? cfg.stop_pts);
      const gainPts = Number(open.gain_pts ?? cfg.gain_pts);
      const movePts = (markPrice - entry) * dirSign;

      let motivo: string | null = null;
      let nivel: number | null = null;
      const debug: any = { move_pts: movePts, mark_price: markPrice };

      if (Number.isFinite(stopPts) && stopPts > 0) {
        const stopLevel = entry - dirSign * stopPts;
        debug.stop_level = stopLevel;
        if (dirSign === 1 ? markPrice <= stopLevel : markPrice >= stopLevel) {
          motivo = "stop"; nivel = stopLevel;
        }
      }
      if (!motivo && Number.isFinite(gainPts) && gainPts > 0) {
        const gainLevel = entry + dirSign * gainPts;
        debug.gain_level = gainLevel;
        if (dirSign === 1 ? markPrice >= gainLevel : markPrice <= gainLevel) {
          motivo = "gain"; nivel = gainLevel;
        }
      }

      // Trailing (recuo fixo) e zero a zero dependem do PICO a favor desde a
      // entrada — precisam do histórico de tiques.
      const trailingOn = cfg.trailing_activation_pts > 0 && cfg.trailing_giveback_pts > 0
        && cfg.trailing_mode !== "structural";
      const beOn = cfg.breakeven_ativa_pts > 0;
      if (!motivo && (trailingOn || beOn) && open.entry_time) {
        const entryMs = new Date(open.entry_time).getTime();
        const hist = await getHistorico(userId, asset.quote_symbol ?? asset.symbol, entryMs);
        let peakPts = movePts;
        for (const h of hist) {
          const t = new Date(h.market_time).getTime();
          if (t < entryMs) continue;
          const p = Number(h.quote_last);
          if (!Number.isFinite(p) || p <= 0) continue;
          const mv = (p - entry) * dirSign;
          if (mv > peakPts) peakPts = mv;
        }
        debug.peak_pts = peakPts;

        // Nível mais protetivo vence, igual ao tique completo.
        let trailLevel: number | null = null;
        if (trailingOn && peakPts >= cfg.trailing_activation_pts) {
          trailLevel = entry + dirSign * (peakPts - cfg.trailing_giveback_pts);
          debug.trailing_level = trailLevel;
        }
        let beLevel: number | null = null;
        if (beOn && peakPts >= cfg.breakeven_ativa_pts) {
          beLevel = entry + dirSign * Math.max(0, cfg.breakeven_folga_pts);
          debug.breakeven_level = beLevel;
        }
        const trailMaisProtetivo = trailLevel !== null && (beLevel === null
          || (dirSign === 1 ? trailLevel >= beLevel : trailLevel <= beLevel));
        const nivelEscolhido = trailMaisProtetivo ? trailLevel : beLevel;
        const motivoEscolhido = trailMaisProtetivo ? "trailing_stop" : "breakeven_stop";
        if (nivelEscolhido !== null
          && (dirSign === 1 ? markPrice <= nivelEscolhido : markPrice >= nivelEscolhido)) {
          motivo = motivoEscolhido; nivel = nivelEscolhido;
        }
      }

      // O trailing estrutural (fractal N=1) depende de candle M1 confirmado —
      // por natureza só reconhece o nível depois do candle seguinte fechar.
      // Fica no tique completo; acelerá-lo não muda nada.
      if (cfg.trailing_mode === "structural") debug.trailing_structural_no_tique_completo = true;

      // MARCAÇÃO A MERCADO (item 4 da leva de 02/09)
      // `unrealized_points` / `unrealized_brl` existiam vazias. Aqui elas são
      // preenchidas pelo MESMO Bid/Ask auditado que decide o fechamento — nunca
      // por preço histórico de outro snapshot — então o valor em tela é o mesmo
      // que o motor usaria se fechasse a posição naquele instante.
      // Escrita econômica: só grava quando o número muda de fato (ponto inteiro
      // e centavo), para não multiplicar I/O a cada 20 s por posição parada.
      //
      // EXCURSÃO MÁXIMA (mfe_pts / mae_pts) — pedido de 04/09.
      // `mfe_pts` = melhor ponto que a posição chegou a ver a favor;
      // `mae_pts` = pior ponto contra (guardado como número positivo).
      // São apenas coleta de dado: nenhuma decisão de entrada ou saída lê esses
      // campos. Servem para medir, depois, quantas ordens VENCEDORAS passaram
      // por excursão contrária maior que o stop do modo — sem isso, avaliar um
      // stop menor seria ajuste ao passado.
      // Mesma escrita econômica: só grava quando um extremo é realmente superado.
      if (open.exit_time == null) {
        const qty = Number(open.quantity) || 1;
        const unrealPts = Math.round(movePts);
        const unrealBrl = Number((movePts * Number(asset.tick_value_brl) * qty).toFixed(2));
        const jaPts = open.unrealized_points == null ? null : Math.round(Number(open.unrealized_points));
        const jaBrl = open.unrealized_brl == null ? null : Number(Number(open.unrealized_brl).toFixed(2));

        // Quando o trailing/zero a zero já varreu o histórico de tiques desta
        // posição, `debug.peak_pts` traz o pico real desde a entrada — melhor
        // que o instante corrente. Fora disso, vale a marcação a mercado.
        const favorAgora = Math.max(Number(debug.peak_pts ?? movePts), movePts);
        const contraAgora = Math.max(0, -movePts);
        const jaMfe = open.mfe_pts == null ? null : Number(open.mfe_pts);
        const jaMae = open.mae_pts == null ? null : Number(open.mae_pts);
        const novoMfe = Math.round(Math.max(favorAgora, jaMfe ?? favorAgora, 0));
        const novoMae = Math.round(Math.max(contraAgora, jaMae ?? contraAgora, 0));

        const patch: Record<string, number> = {};
        if (jaPts !== unrealPts || jaBrl !== unrealBrl) {
          patch.unrealized_points = unrealPts;
          patch.unrealized_brl = unrealBrl;
        }
        if (jaMfe === null || novoMfe > Math.round(jaMfe)) patch.mfe_pts = novoMfe;
        if (jaMae === null || novoMae > Math.round(jaMae)) patch.mae_pts = novoMae;

        if (Object.keys(patch).length) {
          try {
            await supabase.from("b3_simulation_orders")
              .update(patch)
              .eq("id", open.id).eq("user_id", userId).eq("status", "open");
            marcadas++;
          } catch { /* marcação nunca derruba a gestão de risco */ }
        }
      }


      if (!motivo) { ignoradas++; continue; }

      const exitAudit: B3QuoteExecutionAudit = {
        ...markAudit,
        execution_price_origin: `${markAudit.execution_price_origin}+guardiao`,
      };
      const marketHistory = histCache.get(`${userId}:${asset.quote_symbol ?? asset.symbol}`) ?? [];

      try {
        const closed = await closeOrder(supabase, userId, run, m, open, exitAudit, motivo, marketHistory, asset, true);
        fechadas++;
        detalhes.push({
          order_id: open.id, symbol: asset.symbol, mode: open.mode, variant: run.variant ?? null,
          reason: motivo, level: nivel, executed_price: exitAudit.execution_price,
          beyond_pts: nivel === null ? null : Math.abs(markPrice - nivel),
          net_brl: closed?.net_brl ?? null,
        });
        try {
          await supabase.from("b3_simulation_orders").update({
            diagnostic_payload: {
              exit_evaluation: "guardiao_saida",
              close_reason: motivo,
              level_price: nivel,
              executed_price: exitAudit.execution_price,
              overshoot_pts: nivel === null ? 0 : Math.abs(exitAudit.execution_price - nivel),
              quote_age_s: Number(info.quote_age_s ?? 0),
              guardiao_debug: debug,
            },
          }).eq("id", open.id).eq("user_id", userId);
        } catch { /* diagnóstico nunca derruba o fechamento */ }
      } catch (e) {
        // Caso normal: o tique completo fechou a mesma ordem primeiro (a trava
        // `onlyIfOpen` impediu o fechamento duplo). Não é erro de risco.
        ignoradas++;
        detalhes.push({ order_id: open.id, reason: motivo, skipped: (e as Error).message.slice(0, 160) });
      }
    } catch (e) {
      erros++;
      detalhes.push({ order_id: open.id, error: (e as Error).message.slice(0, 200) });
      try {
        await supabase.from("system_logs").insert({
          event_type: "b3_guardiao_erro",
          source: "b3-guardiao-saida",
          severity: "error",
          message: (e as Error).message,
          technical_data: { order_id: open.id, run_id: open.simulation_run_id, mode: open.mode },
        });
      } catch { /* log nunca derruba o guardião */ }
    }
  }

  const janela_ms = Date.now() - t0;
  const res: GuardiaoResultado = {
    ordens_abertas: ordens.length, fechadas, ignoradas, erros,
    marcadas_a_mercado: marcadas, janela_ms, detalhes,
  };

  // LOG DE DURAÇÃO EM TODA PASSADA (não só quando fecha ordem).
  // É a única forma de saber quanto custa uma passada com ~75 posições abertas
  // antes de decidir se a cadência pode cair de 20 s para 10 s.
  try {
    await supabase.from("system_logs").insert({
      event_type: "b3_guardiao_summary",
      source: "b3-guardiao-saida",
      severity: erros > 0 ? "warning" : "info",
      message: `Guardião avaliou ${ordens.length} posição(ões) em ${janela_ms} ms: ${fechadas} encerrada(s), ${ignoradas} sem gatilho, ${marcadas} marcada(s) a mercado, ${erros} erro(s).`,
      technical_data: res,
    });
  } catch { /* log nunca derruba o guardião */ }

  return res;
}
