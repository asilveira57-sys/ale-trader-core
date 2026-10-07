// Cockpit Real — leitura consolidada da operação com DINHEIRO REAL.
// A verdade da execução real é `b3_mt5_commands` (env='real'): é lá que o
// executor grava broker_ticket, filled_price e filled_at. Esta tela lê dali,
// não de b3_live_orders, justamente para nunca mostrar zero havendo posição.
//
// NADA aqui participa do motor de simulação (runB3SimulationTick), do comitê
// ou dos classificadores. Este módulo escreve apenas:
//   1) b3_real_execution_state  (parar / religar o real)
//   2) b3_prd_authorizations.enabled = false (ao parar)
//   3) b3_mt5_commands action='close' (zerar posição real)
//   4) system_logs (rastro de toda ação)
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { assertMasterPassword } from "@/lib/prd-master-password.server";
import {
  buildBrokerState, buildRealLedger, isPregaoOpen, loadAssetProfiles, normalizeAccountMode,
  rootSymbol, saoPauloDate,
  STALE_REPORT_S, type RealCommandRow,
} from "@/lib/b3-real-cockpit.server";
import { addDays, brtDate, periodRowLimit, resolvePeriod } from "@/lib/b3-period";


const MINUTE = 60_000;

// ─────────────────────────── leitura da tela ───────────────────────────
export const getB3RealCockpit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      preset: z.string().nullish(),
      start: z.string().nullish(),
      end: z.string().nullish(),
    }).partial().optional().parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const now = new Date();
    const nowMs = now.getTime();
    const sessionDate = saoPauloDate(now);
    // Recorte de DATA da tela (leitura). O padrão é sempre "hoje".
    const period = resolvePeriod(data ?? null, now);
    const dayStartUtc = period.start_utc;
    const dayEndUtc = period.end_utc;
    // O livro FIFO precisa de história ANTES da janela, senão um fechamento
    // dentro do recorte fica órfão (ou inventa posição). O corte é na SAÍDA.
    const ledgerStartUtc = `${addDays(period.start, -5)}T03:00:00.000Z`;
    const rowLimit = periodRowLimit(period.days);
    const pregaoOpen = isPregaoOpen(now);
    const inWindow = (iso: string | null | undefined) =>
      !!iso && iso >= dayStartUtc && iso < dayEndUtc;

    const [{ data: cmds }, { data: tset }, { data: auths }, { data: stateRow }, { data: brokerRow }] = await Promise.all([
      supabase.from("b3_mt5_commands")
        .select("id, action, side, symbol, quantity, mode, variant, status, error_message, created_at, filled_at, filled_price, broker_ticket, magic_number, broker_position_ticket")
        .eq("user_id", userId).eq("env", "real")
        .gte("created_at", ledgerStartUtc).lt("created_at", dayEndUtc)
        .order("created_at", { ascending: true }).limit(rowLimit),

      supabase.from("b3_trading_settings")
        .select("capital_disponivel_brl, environment").eq("user_id", userId).maybeSingle(),
      supabase.from("b3_prd_authorizations")
        .select("symbol, variant, mode, enabled, max_qty, max_daily_loss_brl, authorized_at, revoked_at")
        .eq("user_id", userId).order("symbol").order("variant").order("mode"),
      supabase.from("b3_real_execution_state")
        .select("real_enabled, stopped_at, stopped_reason, resumed_at, updated_at")
        .eq("user_id", userId).maybeSingle(),
      // Verdade da corretora, reportada pelo executor a cada 2s. Sem cache.
      supabase.from("b3_mt5_account_state")
        .select("reportado_em, saldo, capital_liquido, margem_livre, negociacao_permitida, posicoes, account_login, server_name, modo_conta")
        .eq("user_id", userId).maybeSingle(),
    ]);

    const commands = ((cmds ?? []) as unknown as RealCommandRow[]);
    const profileFor = await loadAssetProfiles(supabase);

    // ── 1. Estado do real (o botão de parar) ──
    const realEnabled = stateRow ? (stateRow as any).real_enabled !== false : true;
    const realState = {
      real_enabled: realEnabled,
      stopped_at: (stateRow as any)?.stopped_at ?? null,
      stopped_reason: (stateRow as any)?.stopped_reason ?? null,
      resumed_at: (stateRow as any)?.resumed_at ?? null,
    };

    // ── 2. Estado do executor, inferido do que ele gravou ──
    const desc = [...commands].reverse();
    const lastFilled = desc.find((c) => c.status === "filled");
    const lastDryRun = desc.find((c) => /DRY_RUN/i.test(String(c.error_message ?? "")));
    const lastAny = desc[0] ?? null;
    const lastAnyAgeMs = lastAny ? nowMs - new Date(lastAny.created_at).getTime() : null;

    let executorState: "real_ativo" | "modo_teste" | "sem_sinal" | "sem_comando";
    let executorRef: RealCommandRow | null = null;
    if (lastFilled && lastDryRun) {
      const filledAt = new Date(lastFilled.created_at).getTime();
      const dryAt = new Date(lastDryRun.created_at).getTime();
      executorState = filledAt >= dryAt ? "real_ativo" : "modo_teste";
      executorRef = filledAt >= dryAt ? lastFilled : lastDryRun;
    } else if (lastFilled) {
      executorState = "real_ativo"; executorRef = lastFilled;
    } else if (lastDryRun) {
      executorState = "modo_teste"; executorRef = lastDryRun;
    } else if (lastAny && lastAnyAgeMs != null && lastAnyAgeMs < 3 * 60 * MINUTE) {
      executorState = "sem_sinal"; executorRef = lastAny;
    } else if (pregaoOpen) {
      executorState = "sem_sinal"; executorRef = lastAny;
    } else {
      executorState = "sem_comando"; executorRef = lastAny;
    }

    const executor = {
      state: executorState,
      pregao_open: pregaoOpen,
      last_command_at: executorRef?.created_at ?? lastAny?.created_at ?? null,
      last_command_age_s: executorRef?.created_at
        ? Math.round((nowMs - new Date(executorRef.created_at).getTime()) / 1000)
        : null,
      last_command: executorRef
        ? {
            action: executorRef.action, side: executorRef.side, symbol: executorRef.symbol,
            quantity: Number(executorRef.quantity ?? 0), status: executorRef.status,
            mode: executorRef.mode, variant: executorRef.variant,
            error_message: executorRef.error_message ?? null,
          }
        : null,
    };

    // ── 3. Livro real: posição aberta + operações encerradas, por FIFO ──
    // Modo da conta reportado pelo executor. Sem informação: HEDGE (a conta real
    // é hedge desde 31/08/2026 e errar para hedge MOSTRA posição a mais, o erro
    // seguro; errar para netting esconde posição aberta sem stop).
    const accountMode = normalizeAccountMode((brokerRow as any)?.modo_conta);
    const ledger = buildRealLedger(commands, profileFor, accountMode);

    // Cotação viva (sem cache) para marcar a mercado a posição aberta.
    const symbols = Array.from(new Set([
      ...ledger.positions.map((p) => p.root),
      ...(auths ?? []).filter((a: any) => a.enabled).map((a: any) => rootSymbol(String(a.symbol))),
    ]));
    const quoteByRoot: Record<string, { price: number | null; tick_ts: string | null; age_s: number | null }> = {};
    for (const root of symbols) {
      const p = profileFor(root);
      // As cotações chegam no contrato (WINV26), não na raiz: aceita qualquer
      // contrato conhecido da raiz e usa o tick mais recente.
      // Uma consulta por contrato (índice user_id+symbol+tick_ts). A lista de
      // símbolos numa só consulta não usa o índice e varre a tabela de ticks.
      const perSymbol = await Promise.all(p.quote_symbols.map(async (sym: string) => {
        const { data: q } = await supabase.from("b3_mt5sim_quotes")
          .select("bid, ask, last, tick_ts")
          .eq("user_id", userId).eq("symbol", sym)
          .order("tick_ts", { ascending: false }).limit(1);
        return (q ?? [])[0] as any;
      }));
      const row = perSymbol.filter(Boolean).sort((a: any, b: any) =>
        new Date(b.tick_ts).getTime() - new Date(a.tick_ts).getTime())[0] as any;
      const price = row ? Number(row.last ?? row.bid ?? row.ask) : null;
      quoteByRoot[root] = {
        price: Number.isFinite(price as number) && (price as number) > 0 ? Number(price) : null,
        tick_ts: row?.tick_ts ?? null,
        age_s: row?.tick_ts ? Math.round((nowMs - new Date(row.tick_ts).getTime()) / 1000) : null,
      };
    }


    // ── 3b. Verdade da corretora + divergência contra o livro por comandos ──
    const broker = buildBrokerState(brokerRow as any, ledger.positions, profileFor, nowMs);

    // POSIÇÃO ABERTA SÓ CONTA SE A CORRETORA CONFIRMAR (04/09/2026).
    // O livro por comandos podia manter uma posição "aberta" para sempre quando
    // o MT5 fechava por conta dele (stop/alvo na corretora) e o comando voltava
    // rejeitado — e essa posição fantasma somava lucro flutuante inventado no
    // resultado do dia. Agora: relatório fresco sem a posição ⇒ estado
    // DESCONHECIDO, fora de qualquer soma. A reconciliação
    // (b3-real-reconcile.server) resolve o registro em b3_live_orders.
    const brokerTrustworthy = broker.reported && !broker.stale;

    // O NÚMERO DA TELA É O DO METATRADER (15/09/2026).
    // O MT5 já manda `resultado` (profit da posição) e `preco_atual` em
    // b3_mt5_account_state.posicoes. Recalcular por cotação criava um segundo
    // número, divergente do terminal, com o qual não se decide fechar.
    // Regra: resultado da corretora é o principal; o cálculo por cotação fica
    // como RESERVA e é marcado como estimado. Operações ENCERRADAS não mudam.
    const brokerUsed = new Set<number>();
    const matchBroker = (p: { root: string; side: "buy" | "sell"; magic_number: number }) => {
      const cand = broker.positions
        .map((b, i) => ({ b, i }))
        .filter(({ b, i }) => !brokerUsed.has(i) && b.root === p.root);
      const pick =
        cand.filter(({ b }) => b.magic_number === p.magic_number && (b.side === null || b.side === p.side)) ;
      const chosen = pick.length
        ? pick
        : cand.filter(({ b }) => b.side === null || b.side === p.side);
      for (const c of chosen) brokerUsed.add(c.i);
      return chosen.map((c) => c.b);
    };

    const positions = ledger.positions.map((p) => {
      // Conta B3 é netting: o magic da posição líquida pode não bater com o do
      // livro. Presença por raiz + lado já é confirmação suficiente.
      const matched = matchBroker(p);
      const naCorretora = matched.length > 0;
      const confirmada = !brokerTrustworthy || naCorretora;
      const quote = quoteByRoot[p.root] ?? { price: null, tick_ts: null, age_s: null };
      const dir = p.side === "buy" ? 1 : -1;

      // 1) corretora: soma do profit reportado das posições correspondentes
      const reported = matched.filter((b) => b.profit_brl != null);
      const brokerBrl = reported.length ? reported.reduce((s, b) => s + Number(b.profit_brl), 0) : null;
      const precoAtual = matched.find((b) => b.price_current != null)?.price_current ?? null;

      // 2) reserva: marcação a mercado pela cotação
      const live = precoAtual ?? quote.price;
      const estPts = confirmada && quote.price != null && p.entry_price != null
        ? (quote.price - p.entry_price) * dir : null;
      const estBrl = estPts != null ? estPts * p.point_value_brl * p.quantity : null;

      const fonte: "corretora" | "estimado" = brokerBrl != null ? "corretora" : "estimado";
      const brl = brokerBrl != null ? brokerBrl : estBrl;
      const pts = brokerBrl != null
        ? (precoAtual != null && p.entry_price != null ? (precoAtual - p.entry_price) * dir : estPts)
        : estPts;

      return {
        ...p,
        live_price: live, quote_tick_ts: quote.tick_ts, quote_age_s: quote.age_s,
        unrealized_pts: pts, unrealized_brl: brl,
        // fonte do resultado em aberto: "corretora" (número do MetaTrader) ou
        // "estimado" (cálculo por cotação, reserva)
        resultado_fonte: fonte,
        broker_profit_brl: brokerBrl,
        broker_price_current: precoAtual,
        confirmada_corretora: confirmada,
        estado: confirmada ? "aberta" : "estado_desconhecido",
      };
    });
    const posFantasma = positions.filter((p) => !p.confirmada_corretora);


    // ── 4. Ordens reais de hoje (o que a corretora executou) ──
    // Apresentação: liga cada comando à(s) operação(ões) que ele originou no
    // MESMO livro FIFO (buildRealLedger). Nenhum pareamento novo aqui.
    const closeAgg = new Map<string, { entry: number | null; exit: number | null; pts: number | null; brl: number | null; qty: number; missing: boolean }>();
    const openAgg = new Map<string, { entry: number | null; qty: number; closed_brl: number | null; missing: boolean }>();
    for (const t of ledger.trades) {
      if (t.close_command_id) {
        const cur = closeAgg.get(t.close_command_id) ?? { entry: null, exit: null, pts: null, brl: null, qty: 0, missing: false };
        const q = t.quantity || 0;
        cur.entry = t.entry_price == null ? cur.entry : ((cur.entry ?? 0) * cur.qty + t.entry_price * q) / (cur.qty + q);
        cur.exit = t.exit_price ?? cur.exit;
        cur.pts = t.result_pts == null ? cur.pts : ((cur.pts ?? 0) * cur.qty + t.result_pts * q) / (cur.qty + q);
        cur.brl = t.result_brl == null ? cur.brl : (cur.brl ?? 0) + t.result_brl;
        cur.qty += q;
        if (t.result_brl == null) cur.missing = true;
        closeAgg.set(t.close_command_id, cur);
      }
      if (t.open_command_id) {
        const cur = openAgg.get(t.open_command_id) ?? { entry: null, qty: 0, closed_brl: null, missing: false };
        cur.entry = t.entry_price ?? cur.entry;
        cur.qty += t.quantity || 0;
        if (t.result_brl == null) cur.missing = true;
        else cur.closed_brl = (cur.closed_brl ?? 0) + t.result_brl;
        openAgg.set(t.open_command_id, cur);
      }
    }
    // posições ainda abertas: marca a mercado a linha de abertura
    const openLive = new Map<string, { entry: number | null; pts: number | null; brl: number | null }>();
    for (const p of positions) {
      for (const cid of (p.open_command_ids ?? [])) {
        openLive.set(cid, { entry: p.entry_price, pts: p.unrealized_pts, brl: p.unrealized_brl });
      }
    }

    const dayOrders = commands
      .filter((c) => inWindow(c.created_at))
      .map((c) => ({
        id: c.id, action: c.action, side: c.side, symbol: c.symbol, root: rootSymbol(String(c.symbol)),
        quantity: Number(c.quantity ?? 0), mode: c.mode, variant: c.variant ?? "indicador",
        magic_number: Number(c.magic_number ?? 0), status: c.status,
        filled_price: c.filled_price == null || Number(c.filled_price) <= 0 ? null : Number(c.filled_price),
        broker_ticket: c.broker_ticket ?? null,
        at: c.filled_at ?? c.created_at,
        error_message: c.error_message ?? null,
        tick_size: profileFor(rootSymbol(String(c.symbol))).tick_size,
        // Resultado da operação encerrada por ESTE comando de fechamento
        trade_entry_price: c.action === "close" ? (closeAgg.get(c.id)?.entry ?? null) : (openAgg.get(c.id)?.entry ?? openLive.get(c.id)?.entry ?? (c.filled_price ? Number(c.filled_price) : null)),
        trade_exit_price: c.action === "close" ? (closeAgg.get(c.id)?.exit ?? null) : null,
        trade_result_pts: c.action === "close"
          ? (closeAgg.get(c.id)?.missing ? null : closeAgg.get(c.id)?.pts ?? null)
          : (openLive.get(c.id)?.pts ?? null),
        trade_result_brl: c.action === "close"
          ? (closeAgg.get(c.id)?.missing ? null : closeAgg.get(c.id)?.brl ?? null)
          : (openLive.get(c.id)?.brl ?? null),
        trade_open: c.action === "open" ? openLive.has(c.id) : false,
      }))
      .reverse();

    // ── 4b. Visão por OPERAÇÃO (uma linha por operação completa) ──
    const dayTrades = [
      ...ledger.trades
        .filter((t) => inWindow(t.exit_time))
        .map((t) => ({
          id: `${t.close_command_id ?? t.magic_number}-${t.entry_time ?? ""}`,
          root: t.root, symbol: t.symbol, mode: t.mode, variant: t.variant,
          magic_number: t.magic_number, side: t.side, quantity: t.quantity,
          entry_time: t.entry_time, exit_time: t.exit_time,
          entry_price: t.entry_price, exit_price: t.exit_price,
          result_pts: t.result_pts, result_brl: t.result_brl,
          broker_ticket: t.broker_ticket,
          tick_size: t.tick_size ?? profileFor(t.root).tick_size,
          open: false,
        })),
      // Posição aberta só existe no PRESENTE: em modo histórico ela não entra.
      ...(period.includes_today ? positions : []).map((p) => ({
        id: `open-${p.root}-${p.magic_number}`,
        root: p.root, symbol: p.symbol, mode: p.mode, variant: p.variant,
        magic_number: p.magic_number, side: p.side, quantity: p.quantity,
        entry_time: p.entry_time, exit_time: null as string | null,
        entry_price: p.entry_price, exit_price: p.live_price,
        result_pts: p.unrealized_pts, result_brl: p.unrealized_brl,
        broker_ticket: p.broker_ticket,
        tick_size: p.tick_size,
        open: true,
      })),
    ].sort((a, b) => new Date(b.entry_time ?? 0).getTime() - new Date(a.entry_time ?? 0).getTime());

    const filledToday = dayOrders.filter((o) => o.status === "filled").length;
    const rejectedToday = dayOrders.filter((o) => o.status === "rejected" || o.status === "error").length;

    // ── 5. Resultado real do dia e saldo ──
    const tradesToday = ledger.trades.filter((t) => inWindow(t.exit_time));
    const realizedBrl = tradesToday.reduce((a, t) => a + (t.result_brl ?? 0), 0);
    const tradesSemPreco = tradesToday.filter((t) => t.result_brl == null).length;
    const unrealizedBrl = period.includes_today
      ? positions.reduce((a, p) => a + (p.unrealized_brl ?? 0), 0)
      : 0;
    const capital = Number((tset as any)?.capital_disponivel_brl ?? 0) || null;
    const pct = (v: number) => (capital && capital > 0 ? v / capital : null);
    const lastWin = [...tradesToday].reverse().find((t) => (t.result_brl ?? 0) > 0) ?? null;
    const lastTrade = tradesToday[tradesToday.length - 1] ?? null;

    const today = {
      realized_brl: realizedBrl,
      unrealized_brl: unrealizedBrl,
      total_brl: realizedBrl + unrealizedBrl,
      realized_pct: pct(realizedBrl),
      unrealized_pct: pct(unrealizedBrl),
      total_pct: pct(realizedBrl + unrealizedBrl),
      capital_brl: capital,
      // Saldo de verdade vem do relatório do executor. O estimado (capital
      // cadastrado + resultado) fica só como referência quando não há relatório.
      saldo_conta_brl: broker.balance_brl,
      capital_liquido_brl: broker.equity_brl,
      margem_livre_brl: broker.free_margin_brl,
      saldo_estimado_brl: capital == null ? null : capital + realizedBrl + unrealizedBrl,
      closed_count: tradesToday.length,
      wins: tradesToday.filter((t) => (t.result_brl ?? 0) > 0).length,
      losses: tradesToday.filter((t) => (t.result_brl ?? 0) < 0).length,
      sem_preco_count: tradesSemPreco,
      // Posições que o livro tem como abertas e a corretora não confirma. Não
      // entram em unrealized_brl nem em total_brl.
      estado_desconhecido_count: posFantasma.length,

      filled_orders: filledToday,
      rejected_orders: rejectedToday,
      environment: ((tset as any)?.environment ?? "simulation") as string,
      last_win: lastWin,
      last_trade: lastTrade,
    };

    // ── 6. Robôs: teto do executor x ligado no banco ──
    // A lista branca ROBOS_REAIS vive na máquina do executor. A tela só
    // consegue OBSERVAR o veredito dele (comando aceito x recusado) — jamais
    // autorizar. Por isso: evidência, não permissão.
    const evidence: Record<number, { filled: number; whitelist_reject: number; last_at: string | null; last_error: string | null }> = {};
    for (const c of commands) {
      const magic = Number(c.magic_number ?? 0);
      const e = evidence[magic] ?? { filled: 0, whitelist_reject: 0, last_at: null, last_error: null };
      if (c.status === "filled") e.filled += 1;
      if (/autorizado na lista branca|whitelist|nao autorizado/i.test(String(c.error_message ?? ""))) {
        e.whitelist_reject += 1;
        e.last_error = c.error_message ?? null;
      }
      e.last_at = c.filled_at ?? c.created_at;
      evidence[magic] = e;
    }

    const robots = (auths ?? []).map((a: any) => {
      const root = rootSymbol(String(a.symbol));
      const openPos = positions.find((p) => p.root === root && p.mode === a.mode && p.variant === (a.variant ?? "indicador"));
      const magic = openPos?.magic_number
        ?? commands.find((c) => rootSymbol(String(c.symbol)) === root && c.mode === a.mode && (c.variant ?? "indicador") === (a.variant ?? "indicador"))?.magic_number
        ?? null;
      const ev = magic != null ? evidence[Number(magic)] : undefined;
      const executorStatus: "confirmado" | "recusado" | "sem_evidencia" =
        ev && ev.filled > 0 ? "confirmado" : ev && ev.whitelist_reject > 0 ? "recusado" : "sem_evidencia";
      const trades = ledger.trades.filter(
        (t) => t.root === root && t.mode === a.mode && t.variant === (a.variant ?? "indicador") && inWindow(t.exit_time),
      );
      return {
        symbol: root, variant: a.variant ?? "indicador", mode: a.mode,
        enabled: a.enabled === true, max_qty: Number(a.max_qty ?? 1),
        max_daily_loss_brl: a.max_daily_loss_brl == null ? null : Number(a.max_daily_loss_brl),
        magic_number: magic == null ? null : Number(magic),
        executor_status: executorStatus,
        executor_last_error: ev?.last_error ?? null,
        has_open_position: !!openPos,
        realized_brl: trades.reduce((s, t) => s + (t.result_brl ?? 0), 0),
        trades_count: trades.length,
      };
    })
      // Ordem: quem está ligado primeiro; o resto só interessa como referência.
      .sort((x, y) => Number(y.enabled) - Number(x.enabled) || x.symbol.localeCompare(y.symbol) || x.mode.localeCompare(y.mode));

    // ── 7. Avisos da última hora ──
    const alerts: any[] = [];
    const hourAgo = nowMs - 60 * MINUTE;
    if (!realEnabled) {
      // Real desligado DENTRO do pregão é perda de pregão, não aviso: em 15/09
      // passou quase uma hora sem entrada real e sem ninguém perceber, porque
      // este aviso era 'warning' no meio dos outros. Fora do pregão, real
      // desligado é estado normal e segue como aviso.
      alerts.push({
        kind: "real_parado",
        severity: pregaoOpen ? "critical" : "warning",
        title: pregaoOpen ? "REAL DESLIGADO COM O PREGÃO ABERTO" : "Real parado pela tela",
        detail: pregaoOpen
          ? `Nenhuma entrada real será executada${realState.stopped_at ? ` — desligado desde ${new Date(realState.stopped_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : ""}.${realState.stopped_reason ? ` Motivo: ${realState.stopped_reason}.` : ""} Use "Liberar entradas reais" (senha mestra).`
          : `Novas entradas reais bloqueadas${realState.stopped_reason ? `: ${realState.stopped_reason}` : "."} A simulação segue coletando normalmente.`,
        at: realState.stopped_at,
      });
    }

    for (const c of desc) {
      const at = new Date(c.created_at).getTime();
      if (at < hourAgo) continue;
      if (c.status === "rejected" || c.status === "error") {
        if (/DRY_RUN/i.test(String(c.error_message ?? ""))) continue;
        alerts.push({
          kind: "ordem_real_recusada", severity: "critical",
          title: `Ordem real ${c.action === "open" ? "de entrada" : "de fechamento"} recusada`,
          detail: `${String(c.side ?? "").toUpperCase()} ${c.quantity}x ${c.symbol} — ${c.error_message ?? "sem detalhe do executor"}`,
          at: c.created_at,
        });
      }
      if (c.status === "expired") {
        alerts.push({
          kind: "comando_expirado", severity: "warning",
          title: "Comando real expirou sem execução",
          detail: `${c.action} ${c.symbol} — o executor não reivindicou o comando dentro da validade.`,
          at: c.created_at,
        });
      }
      if (c.status === "filled" && (c.filled_price == null || Number(c.filled_price) <= 0)) {
        alerts.push({
          kind: "preco_executado_ausente", severity: "warning",
          title: "Execução confirmada sem preço",
          detail: `${c.action} ${c.symbol} ticket ${c.broker_ticket ?? "—"} — o executor não gravou filled_price; o resultado desta operação fica de fora da conta.`,
          at: c.filled_at ?? c.created_at,
        });
      }
    }

    const { data: logs } = await supabase.from("system_logs")
      .select("event_type, severity, message, created_at, source")
      .gte("created_at", new Date(hourAgo).toISOString())
      .in("severity", ["critical", "error", "warning"])
      .order("created_at", { ascending: false }).limit(30);
    for (const l of (logs ?? []) as any[]) {
      if (!/auditoria|execution|mt5|real|magic/i.test(`${l.event_type} ${l.source ?? ""}`)) continue;
      alerts.push({
        kind: l.event_type, severity: l.severity === "warning" ? "warning" : "critical",
        title: String(l.event_type).replace(/_/g, " "),
        detail: l.message ?? "", at: l.created_at,
      });
    }

    for (const [root, q] of Object.entries(quoteByRoot)) {
      if (!pregaoOpen) continue;
      if (q.age_s == null) {
        alerts.push({
          kind: "sem_cotacao", severity: "warning",
          title: `Sem cotação de ${root}`,
          detail: "Nenhum tick recebido do MT5 para este ativo.", at: null,
        });
      } else if (q.age_s > 30) {
        alerts.push({
          kind: "cotacao_parada", severity: q.age_s > 120 ? "critical" : "warning",
          title: `Cotação de ${root} parada há ${q.age_s}s`,
          detail: "Preço atual e resultado em aberto podem estar defasados.",
          at: q.tick_ts,
        });
      }
    }

    if (!broker.reported) {
      alerts.push({
        kind: "sem_relatorio_executor", severity: "warning",
        title: "Executor nunca reportou o estado da conta",
        detail: "A posição mostrada vem do cálculo por comandos, que pode divergir da corretora. Atualize o executor para enviar o relatório.",
        at: null,
      });
    } else if (broker.stale) {
      alerts.push({
        kind: "relatorio_executor_velho", severity: "critical",
        title: `Executor pode estar parado — último relatório há ${broker.report_age_s ?? "?"}s`,
        detail: `O relatório da corretora tem mais de ${STALE_REPORT_S}s. Posição e saldo exibidos podem não ser os atuais.`,
        at: broker.reported_at,
      });
    }
    const divSeverity = broker.divergencia_critica ? "critical" : "warning";
    for (const dv of broker.divergences) {
      alerts.push({
        kind: "divergencia_posicao", severity: divSeverity,
        title: `Divergência em ${dv.root}: corretora ${dv.broker_net} x comandos ${dv.ledger_net}`,
        detail: "Algum comando expirou ou executou fora do previsto. A corretora é a verdade; o cálculo por comandos é segunda opinião.",
        at: broker.reported_at,
      });
    }
    for (const dv of broker.magic_divergences ?? []) {
      alerts.push({
        kind: "divergencia_posicao_magic", severity: divSeverity,
        title: `Divergência no magic ${dv.magic_number} (${dv.root}): corretora ${dv.broker_net} x comandos ${dv.ledger_net}`,
        detail: "Posição que a corretora tem e o sistema não conhece é posição SEM STOP. Confira na corretora agora.",
        at: broker.reported_at,
      });
    }
    if (posFantasma.length) {
      alerts.push({
        kind: "posicao_estado_desconhecido", severity: "warning",
        title: `${posFantasma.length} posição(ões) em ESTADO DESCONHECIDO`,
        detail: `${posFantasma.map((p) => `${p.root} ${p.side === "buy" ? "compra" : "venda"} magic ${p.magic_number}`).join(", ")} — o livro por comandos ainda tem essa posição aberta, mas a corretora não a reporta. Ficam FORA do resultado em aberto: mostrar um número aqui seria lucro inventado.`,
        at: broker.reported_at,
      });
    }


    alerts.sort((a, b) => new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime());

    // ── 8. Freio de pico da CONTA ──
    // O piso é PERCENTUAL do stop global: recalcula antes de ler, para que
    // ligar/desligar um robô não deixe o valor em R$ velho e errado em silêncio.
    const { readAccountPeak } = await import("@/lib/b3-real-account-peak.server");
    const { syncPeakFloorFromGlobalStop } = await import("@/lib/b3-real-stop.server");
    const floorSync = await syncPeakFloorFromGlobalStop(supabase, userId);
    const accountPeak = {
      ...(await readAccountPeak(supabase, userId, today.total_brl, now)),
      peak_min_pct_of_global: floorSync.pct,
      global_stop_brl: floorSync.global_stop_brl,
    };
    if (accountPeak.armed) {
      alerts.unshift({
        kind: "freio_pico_conta_armado", severity: "critical",
        title: "Freio de pico da CONTA armado",
        detail:
          `Pico R$ ${accountPeak.peak_brl.toFixed(2)} · devolvido R$ ${accountPeak.given_back_brl.toFixed(2)}` +
          ` (${((accountPeak.given_back_pct ?? 0) * 100).toFixed(1)}%). Novas aberturas reais bloqueadas até o fim do pregão.` +
          " Fechamento e simulação seguem normais.",
        at: accountPeak.armed_at,
      });
    }

    // ── 8b. Disjuntor diário da CONTA real (meta de ganho / teto de perda) ──
    // Leitura pura: a trava só é armada pelo portão de abertura real.
    const { readDailyCircuit } = await import("@/lib/b3-real-daily-circuit.server");
    const dailyCircuit = await readDailyCircuit(supabase, userId, now);
    if (dailyCircuit.armed) {
      alerts.unshift({
        kind: "disjuntor_diario_armado", severity: "critical",
        title: dailyCircuit.armed_kind === "meta_ganho"
          ? "Disjuntor diário: META DE GANHO atingida — dia travado"
          : "Disjuntor diário: TETO DE PERDA atingido — novas entradas reais bloqueadas",
        detail:
          `Base R$ ${dailyCircuit.base_brl.toFixed(2)} · realizado R$ ${dailyCircuit.realized_brl.toFixed(2)} · ` +
          `meta R$ ${dailyCircuit.gain_target_brl.toFixed(2)} · teto −R$ ${dailyCircuit.loss_cap_brl.toFixed(2)}. ` +
          "Nenhum robô real abre até o próximo pregão. Fechamento e simulação seguem normais.",
        at: dailyCircuit.armed_at,
      });
    } else if (dailyCircuit.enabled && dailyCircuit.gain_waiting_flat) {
      alerts.unshift({
        kind: "disjuntor_diario_esperando_conta_limpa", severity: "warning",
        title: "Disjuntor ARMADO na meta — dispara na primeira conta limpa",
        detail:
          `Meta encostada${dailyCircuit.gain_latched_at ? ` às ${dailyCircuit.gain_latched_at}` : ""}` +
          `${dailyCircuit.gain_latched_result_brl != null ? ` com R$ ${Number(dailyCircuit.gain_latched_result_brl).toFixed(2)}` : ""}; ` +
          `realizado agora R$ ${dailyCircuit.realized_brl.toFixed(2)} (meta R$ ${dailyCircuit.gain_target_brl.toFixed(2)}), ` +
          `ainda há ${dailyCircuit.open_positions} posição(ões) real(is) aberta(s)` +
          `${dailyCircuit.broker_stale ? " (ou o relatório da corretora está velho)" : ""}. ` +
          "A trava não desarma hoje, mesmo se o resultado recuar.",

        at: now.toISOString(),
      });
    }

    // ── 9. Resultado de cada pregão do recorte (só quando há mais de um dia) ──
    const byDayMap = new Map<string, { date: string; realized_brl: number; trades: number; wins: number; losses: number; sem_preco: number }>();
    for (const t of tradesToday) {
      const day = brtDate(new Date(t.exit_time ?? now));
      const row = byDayMap.get(day) ?? { date: day, realized_brl: 0, trades: 0, wins: 0, losses: 0, sem_preco: 0 };
      row.trades += 1;
      if (t.result_brl == null) row.sem_preco += 1;
      else {
        row.realized_brl += Number(t.result_brl);
        if (Number(t.result_brl) > 0) row.wins += 1;
        else if (Number(t.result_brl) < 0) row.losses += 1;
      }
      byDayMap.set(day, row);
    }
    const byDay = Array.from(byDayMap.values()).sort((a, b) => (a.date < b.date ? 1 : -1));

    return {
      server_time: now.toISOString(),
      session_date: sessionDate,
      period: {
        preset: period.preset,
        start: period.start,
        end: period.end,
        days: period.days,
        single_day: period.single_day,
        includes_today: period.includes_today,
        label: period.label,
        // Modo histórico: a tela esconde blocos vivos e as ações.
        historical: !period.includes_today,
      },
      // Livro incompleto NUNCA pode aparecer como número completo.
      rows_limit: rowLimit,
      rows_truncated: (cmds ?? []).length >= rowLimit,
      by_day: byDay,
      no_movement: dayOrders.length === 0 && tradesToday.length === 0,
      real_state: realState,
      executor,
      broker,
      positions,
      day_orders: dayOrders,
      day_trades: dayTrades,
      trades_today: tradesToday.slice().reverse(),
      today,
      robots,
      account_peak: accountPeak,
      daily_circuit: dailyCircuit,

      enabled_count: robots.filter((r) => r.enabled).length,
      // Crítico primeiro: aviso que custa pregão não pode ficar no meio da lista.
      alerts: alerts
        .slice()
        .sort((a, b) => (a.severity === "critical" ? 0 : 1) - (b.severity === "critical" ? 0 : 1))
        .slice(0, 12),

    };

  });

// ───────────────────── PAYLOAD LEVE (polling de segundos) ─────────────────────
// SEPARAÇÃO LEVE x PESADO (17/09/2026). O payload único do Cockpit Real
// arrastava, a cada 15s, histórico do dia, robôs, diagnóstico e séries — dado
// que quase nunca muda — e a instância já acendeu alerta de IO.
//
// Este endpoint responde SÓ o que muda de segundo em segundo:
//   executor vivo/parado · posição real aberta e resultado não realizado ·
//   disjuntor e freios · liberações manuais ativas.
//
// Custo: nenhuma tabela grande. Não toca b3_simulation_agent_votes,
// b3_entry_decision_log nem b3_simulation_block_events. Os comandos são lidos
// numa janela curta (últimos 20 min) só para saber se o executor está vivo e se
// alguma ordem foi recusada ou algum stop ficou pendurado.
//
// Não escreve nada além do que já era escrito antes: o encerramento de liberação
// expirada por fim de pregão (registro obrigatório desde 16/09).
const LIVE_WINDOW_MS = 20 * MINUTE;
// Stop/fechamento enfileirado que passa disso sem execução é stop NÃO EXECUTADO.
const STOP_PENDENTE_S = 90;

export const getB3RealCockpitLive = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const now = new Date();
    const nowMs = now.getTime();
    const sessionDate = saoPauloDate(now);
    const pregaoOpen = isPregaoOpen(now);
    const sinceIso = new Date(nowMs - LIVE_WINDOW_MS).toISOString();

    const [{ data: cmds }, { data: stateRow }, { data: brokerRow }, { data: grupos }] = await Promise.all([
      supabase.from("b3_mt5_commands")
        .select("id, action, side, symbol, quantity, mode, variant, status, error_message, created_at, filled_at, magic_number")
        .eq("user_id", userId).eq("env", "real")
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: true }).limit(300),
      supabase.from("b3_real_execution_state")
        .select("real_enabled, stopped_at, stopped_reason, resumed_at, updated_at")
        .eq("user_id", userId).maybeSingle(),
      supabase.from("b3_mt5_account_state")
        .select("reportado_em, saldo, capital_liquido, margem_livre, negociacao_permitida, posicoes, account_login, server_name, modo_conta")
        .eq("user_id", userId).maybeSingle(),
      // Estado JÁ MATERIALIZADO do freio de grupo do dia — sem recalcular nada.
      (supabase as any).from("b3_grupo_estado_dia")
        .select("symbol, variant, nivel_atual, multiplicador, resultado_brl, robos_travados")
        .eq("user_id", userId).eq("trade_date", sessionDate).limit(60),
    ]);

    const commands = ((cmds ?? []) as unknown as RealCommandRow[]);
    const profileFor = await loadAssetProfiles(supabase);

    // ── 1. Real ligado/desligado ──
    const realEnabled = stateRow ? (stateRow as any).real_enabled !== false : true;
    const realState = {
      real_enabled: realEnabled,
      stopped_at: (stateRow as any)?.stopped_at ?? null,
      stopped_reason: (stateRow as any)?.stopped_reason ?? null,
      resumed_at: (stateRow as any)?.resumed_at ?? null,
    };

    // ── 2. Executor vivo/parado ──
    // A verdade do "vivo" é o relatório da conta (a cada ~2s); os comandos da
    // janela curta só dizem o que ele fez por último.
    const desc = [...commands].reverse();
    const lastAny = desc[0] ?? null;
    const lastFilled = desc.find((c) => c.status === "filled") ?? null;
    const lastDryRun = desc.find((c) => /DRY_RUN/i.test(String(c.error_message ?? ""))) ?? null;
    const executorRef = lastFilled ?? lastDryRun ?? lastAny;
    const executorState: "real_ativo" | "modo_teste" | "sem_sinal" | "sem_comando" =
      lastFilled ? "real_ativo"
        : lastDryRun ? "modo_teste"
          : lastAny ? "sem_sinal"
            : pregaoOpen ? "sem_sinal" : "sem_comando";
    const executor = {
      state: executorState,
      pregao_open: pregaoOpen,
      last_command_at: executorRef?.created_at ?? null,
      last_command_age_s: executorRef?.created_at
        ? Math.round((nowMs - new Date(executorRef.created_at).getTime()) / 1000)
        : null,
      last_command: executorRef
        ? {
            action: executorRef.action, side: executorRef.side, symbol: executorRef.symbol,
            quantity: Number(executorRef.quantity ?? 0), status: executorRef.status,
            mode: executorRef.mode, variant: executorRef.variant,
            error_message: executorRef.error_message ?? null,
          }
        : null,
    };

    // ── 3. Corretora: posição aberta e resultado não realizado ──
    // Sem livro FIFO: aqui a verdade é o relatório do MT5, e só ele.
    const broker = buildBrokerState(brokerRow as any, [], profileFor, nowMs);
    const brokerFresh = broker.reported && !broker.stale;
    const openProfitBrl = broker.reported ? broker.open_profit_brl : null;

    // ── 4. Disjuntor diário e freio de pico da conta ──
    const { readDailyCircuit } = await import("@/lib/b3-real-daily-circuit.server");
    const dailyCircuit = await readDailyCircuit(supabase, userId, now);
    const totalBrl = Number(dailyCircuit.realized_brl ?? 0) + Number(openProfitBrl ?? 0);
    const { readAccountPeak } = await import("@/lib/b3-real-account-peak.server");
    const accountPeak = await readAccountPeak(supabase, userId, totalBrl, now);

    // ── 5. Freio de grupo (estado do dia, já materializado) ──
    const grupoEstados = ((grupos ?? []) as any[]).map((g) => ({
      symbol: rootSymbol(String(g.symbol)),
      variant: String(g.variant ?? "indicador"),
      nivel: Number(g.nivel_atual ?? 0) || 0,
      multiplicador: g.multiplicador == null ? null : Number(g.multiplicador),
      resultado_brl: g.resultado_brl == null ? null : Number(g.resultado_brl),
      robos_travados: Array.isArray(g.robos_travados) ? g.robos_travados.length : 0,
    }));

    // ── 6. Liberações manuais ativas (e as que acabaram de expirar) ──
    const {
      listLiberacoesAbertas, separarLiberacoes, encerrarLiberacoes, chaveLiberacao,
      FREIO_LIBERAVEL_LABEL, MOTIVO_FIM_LABEL,
    } = await import("@/lib/b3-liberacao-freio.server");
    const abertas = await listLiberacoesAbertas(supabase, userId);
    const { ativas, expiradas } = separarLiberacoes(abertas, now);
    if (expiradas.length) await encerrarLiberacoes(supabase, userId, expiradas, "fim_do_pregao");
    const liberacoesEncerradas = expiradas.map((l) => ({
      key: chaveLiberacao(l),
      label: `${FREIO_LIBERAVEL_LABEL[l.freio]} em ${l.symbol}/${l.variant}/${l.mode ?? "grupo inteiro"}`,
      motivo: MOTIVO_FIM_LABEL.fim_do_pregao,
    }));

    // ── 7. Avisos que valem som/notificação ──
    const alerts: any[] = [];
    if (!realEnabled) {
      alerts.push({
        kind: "real_parado",
        severity: pregaoOpen ? "critical" : "warning",
        title: pregaoOpen ? "REAL DESLIGADO COM O PREGÃO ABERTO" : "Real parado pela tela",
        detail: pregaoOpen
          ? `Nenhuma entrada real será executada.${realState.stopped_reason ? ` Motivo: ${realState.stopped_reason}.` : ""}`
          : "Novas entradas reais bloqueadas. A simulação segue coletando normalmente.",
        at: realState.stopped_at,
      });
    }
    if (!broker.reported) {
      alerts.push({
        kind: "sem_relatorio_executor", severity: "warning",
        title: "Executor nunca reportou o estado da conta",
        detail: "Sem relatório da corretora não há confirmação de posição.", at: null,
      });
    } else if (broker.stale) {
      alerts.push({
        kind: "relatorio_executor_velho", severity: "critical",
        title: `Executor pode estar parado — último relatório há ${broker.report_age_s ?? "?"}s`,
        detail: `O relatório da corretora tem mais de ${STALE_REPORT_S}s. Posição e saldo podem não ser os atuais.`,
        at: broker.reported_at,
      });
    }
    for (const c of desc) {
      if (c.status === "rejected" || c.status === "error") {
        if (/DRY_RUN/i.test(String(c.error_message ?? ""))) continue;
        alerts.push({
          kind: "ordem_real_recusada", severity: "critical",
          title: `Ordem real ${c.action === "open" ? "de entrada" : "de fechamento"} recusada`,
          detail: `${String(c.side ?? "").toUpperCase()} ${c.quantity}x ${c.symbol} — ${c.error_message ?? "sem detalhe do executor"}`,
          at: c.created_at,
        });
      }
      // Stop pendente NÃO EXECUTADO: fechamento enfileirado que o executor não
      // levou adiante. É o pior tipo de silêncio — posição sem saída.
      const ageS = Math.round((nowMs - new Date(c.created_at).getTime()) / 1000);
      if (c.action === "close" && (c.status === "pending" || c.status === "claimed") && ageS > STOP_PENDENTE_S) {
        alerts.push({
          kind: "stop_pendente_nao_executado", severity: "critical",
          title: `Fechamento pendente há ${ageS}s sem execução`,
          detail: `${String(c.side ?? "").toUpperCase()} ${c.quantity}x ${c.symbol} — comando ${c.status}. A posição pode estar sem saída.`,
          at: c.created_at,
        });
      }
    }
    if (dailyCircuit.armed) {
      alerts.push({
        kind: "disjuntor_diario_armado", severity: "critical",
        title: dailyCircuit.armed_kind === "meta_ganho"
          ? "Disjuntor diário: META DE GANHO atingida — dia travado"
          : "Disjuntor diário: TETO DE PERDA atingido — novas entradas reais bloqueadas",
        detail: `Realizado R$ ${Number(dailyCircuit.realized_brl ?? 0).toFixed(2)}. Nenhum robô real abre até o próximo pregão.`,
        at: dailyCircuit.armed_at,
      });
    }
    if (accountPeak.armed) {
      alerts.push({
        kind: "freio_pico_conta_armado", severity: "critical",
        title: "Freio de pico da CONTA armado",
        detail: "Novas aberturas reais bloqueadas até o fim do pregão. Fechamento e simulação seguem normais.",
        at: accountPeak.armed_at,
      });
    }

    // ── 8. Alarmes gravados em system_logs que a tela não mostrava (06/10) ──
    // Só com pregão aberto. `at` é a assinatura da CONDIÇÃO (não o horário do
    // log): o mesmo alerta não repete enquanto a condição não mudar.
    if (pregaoOpen) {
      const desde = new Date(nowMs - 20 * 60_000).toISOString();
      const [{ data: semPreco }, { data: orfas }, { data: cart }] = await Promise.all([
        (supabase as any).from("system_logs").select("message").ilike("message", "ATIVO SEM PRECO%").gte("created_at", desde).limit(50),
        (supabase as any).from("system_logs").select("message, technical_data").eq("event_type", "autorizacao_real_orfa").gte("created_at", desde).limit(20),
        (supabase as any).from("system_logs").select("message, technical_data").eq("event_type", "carteira_insuficiente").gte("created_at", desde)
          .order("created_at", { ascending: false }).limit(20),
      ]);
      const ativosSemPreco = Array.from(new Set<string>((semPreco ?? []).map((r: any) => String(r.message).replace(/^ATIVO SEM PRECO:\s*/, "").split(" ")[0]))).sort();
      if (ativosSemPreco.length) alerts.push({
        kind: "cotacao_parada", severity: "critical", title: "Ativo sem preço durante o pregão",
        detail: `${ativosSemPreco.join(", ")} sem cotação. Robôs desses ativos não têm preço para operar.`,
        at: `${sessionDate}:${ativosSemPreco.join(",")}`,
      });
      if ((orfas ?? []).length) alerts.push({
        kind: "autorizacao_real_orfa", severity: "critical", title: "Robô autorizado no real sem execução viva",
        detail: String(orfas![0].message ?? ""), at: `${sessionDate}:${(orfas ?? []).length}`,
      });
      const ativosCart = Array.from(new Set<string>((cart ?? []).map((r: any) => String(r.technical_data?.symbol ?? "?")))).sort();
      if (ativosCart.length) alerts.push({
        kind: "carteira_insuficiente", severity: "critical", title: "Capital da carteira não cobre a margem — abertura real bloqueada",
        detail: String(cart![0].message ?? ""), at: `${sessionDate}:${ativosCart.join(",")}`,
      });
      // Dedupe de execuções (07/10): cancelamento ou duplicata travada por
      // autorização real. Janela de 12 h: o evento acontece uma vez por dia.
      const { data: dd } = await (supabase as any).from("system_logs").select("event_type, message, technical_data")
        .in("event_type", ["dedupe_run_cancelada", "dedupe_run_bloqueado"])
        .gte("created_at", new Date(nowMs - 12 * 3600_000).toISOString())
        .order("created_at", { ascending: false }).limit(20);
      const ids = Array.from(new Set<string>((dd ?? []).map((r: any) => String(r.technical_data?.cancelada_id ?? r.technical_data?.chave ?? "?")))).sort();
      if (ids.length) alerts.push({
        kind: "dedupe_run_cancelada", severity: "critical",
        title: "Dedupe de execuções agiu — confira as execuções",
        detail: String(dd![0].message ?? ""), at: `${sessionDate}:${ids.join(",")}`,
      });
    }

    return {
      live: true as const,
      server_time: now.toISOString(),
      session_date: sessionDate,
      pregao_open: pregaoOpen,
      real_state: realState,
      executor,
      broker,
      broker_fresh: brokerFresh,
      open_profit_brl: openProfitBrl,
      realized_brl: Number(dailyCircuit.realized_brl ?? 0),
      total_brl: totalBrl,
      daily_circuit: dailyCircuit,
      account_peak: accountPeak,
      grupo_estados: grupoEstados,
      liberacoes: ativas,
      liberacoes_encerradas: liberacoesEncerradas,
      alerts: alerts
        .slice()
        .sort((a, b) => (a.severity === "critical" ? 0 : 1) - (b.severity === "critical" ? 0 : 1))
        .slice(0, 12),
    };
  });


// ─────────── ajuste do freio de pico da CONTA (só a configuração) ───────────
// Não toca em NENHUM parâmetro de robô: nem stop, nem alvo, nem trailing, nem
// o freio de pico POR ROBÔ. Só a devolução (35%) e o piso da camada da conta.
// O piso é digitado como PERCENTUAL DO STOP GLOBAL; os R$ são derivados e
// gravados em peak_min_brl para não quebrar o portão que já funciona.
export const setRealAccountPeakConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      peak_giveback_pct: z.number().min(0.05).max(0.95),
      /** fração do stop global (0,5 = 50%) */
      peak_min_pct_of_global: z.number().min(0).max(3),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const now = new Date().toISOString();
    const { error } = await (supabase as any)
      .from("b3_real_execution_state")
      .upsert({
        user_id: userId,
        peak_giveback_pct: data.peak_giveback_pct,
        updated_at: now,
      }, { onConflict: "user_id" });
    if (error) throw error;

    // Grava percentual e R$ juntos, a partir do stop global do momento.
    const { syncPeakFloorFromGlobalStop } = await import("@/lib/b3-real-stop.server");
    const sync = await syncPeakFloorFromGlobalStop(supabase, userId, { pctOverride: data.peak_min_pct_of_global });

    try {
      await (supabase as any).from("system_logs").insert({
        event_type: "config_freio_pico_conta_real",
        source: "cockpit_real",
        severity: "warning",
        message:
          `Freio de pico da conta real configurado: devolução máxima ${(data.peak_giveback_pct * 100).toFixed(0)}% do pico, ` +
          `piso ${(sync.pct * 100).toFixed(0)}% do stop global (R$ ${sync.peak_min_brl.toFixed(2)} com stop global de R$ ${sync.global_stop_brl.toFixed(2)}).`,
        technical_data: { ...data, ...sync } as any,
      });
    } catch { /* best-effort */ }

    return { ok: true as const, peak_giveback_pct: data.peak_giveback_pct, ...sync };
  });

// ─── configuração do DISJUNTOR DIÁRIO da conta real (liga/desliga + %) ───
// Só a conta real. Não toca em parâmetro de robô, comitê, classificador nem no
// comportamento do simulado. Entregue DESLIGADO por padrão.
export const setRealDailyCircuitConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      enabled: z.boolean(),
      /** meta de ganho como fração da base de margem (0,40 = 40%) */
      gain_target_pct: z.number().min(0.01).max(5),
      /** teto de perda como fração da base de margem (0,25 = 25%) */
      loss_cap_pct: z.number().min(0.01).max(5),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const now = new Date().toISOString();
    const { error } = await (supabase as any)
      .from("b3_real_execution_state")
      .upsert({
        user_id: userId,
        daily_circuit_enabled: data.enabled,
        daily_gain_target_pct: data.gain_target_pct,
        daily_loss_cap_pct: data.loss_cap_pct,
        updated_at: now,
      }, { onConflict: "user_id" });
    if (error) throw error;

    const { readDailyCircuit } = await import("@/lib/b3-real-daily-circuit.server");
    const status = await readDailyCircuit(supabase, userId);

    try {
      await (supabase as any).from("system_logs").insert({
        event_type: "config_disjuntor_diario_real",
        source: "cockpit_real",
        severity: "warning",
        message:
          `Disjuntor diário da conta real ${data.enabled ? "LIGADO" : "DESLIGADO"}: meta ` +
          `${(data.gain_target_pct * 100).toFixed(0)}% e teto ${(data.loss_cap_pct * 100).toFixed(0)}% da base ` +
          `(base agora R$ ${status.base_brl.toFixed(2)} com ${status.robots_count} robô(s) real(is)).`,
        technical_data: { ...data, base_brl: status.base_brl, robos: status.robots } as any,
      });
    } catch { /* best-effort */ }

    return { ok: true as const, ...status };
  });




// ─────────── botão: PARAR O REAL (sem senha, de propósito) ───────────
// Parada de emergência não pode ter atrito. Bloqueia novas entradas reais
// (o executor deixa de receber comandos 'open' na consulta que já faz) e
// desliga as autorizações. NÃO pausa a simulação. A posição aberta continua
// sendo gerida: stop, alvo e zeragem seguem valendo.
export const stopRealNewEntries = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ motivo: z.string().max(300).optional() }).parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const now = new Date().toISOString();

    const { error: stErr } = await (supabase as any)
      .from("b3_real_execution_state")
      .upsert({
        user_id: userId, real_enabled: false, stopped_at: now,
        stopped_reason: data.motivo ?? "parado pelo Cockpit Real",
        stopped_by: userId, updated_at: now,
      }, { onConflict: "user_id" });
    if (stErr) throw stErr;

    const { data: rows, error } = await (supabase as any)
      .from("b3_prd_authorizations")
      .update({ enabled: false, revoked_at: now, updated_at: now })
      .eq("user_id", userId).eq("enabled", true)
      .select("symbol, variant, mode");
    if (error) throw error;

    const disabled = (rows ?? []) as any[];
    try {
      await (supabase as any).from("system_logs").insert({
        event_type: "parada_novas_entradas_reais",
        source: "cockpit_real",
        severity: "warning",
        message: `Real PARADO pelo painel (${disabled.length} autorizações desligadas). Simulação não afetada.`,
        technical_data: { motivo: data.motivo ?? null, autorizacoes: disabled } as any,
      });
    } catch { /* log é best-effort; o bloqueio já aconteceu */ }

    return { ok: true as const, disabled: disabled.length, rows: disabled, stopped_at: now };
  });

// ─────────── botão: RELIGAR O REAL (exige senha mestra) ───────────
// Só libera o estado. NÃO religa autorização nenhuma: cada robô volta a ser
// ligado um por um em /prd-autorizacoes, e o teto continua sendo a lista
// branca ROBOS_REAIS gravada na máquina do executor.
export const resumeRealExecution = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ password: z.string().min(1) }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMasterPassword(data.password);

    const now = new Date().toISOString();
    const { error } = await (supabase as any)
      .from("b3_real_execution_state")
      .upsert({
        user_id: userId, real_enabled: true, resumed_at: now,
        stopped_at: null, stopped_reason: null, updated_at: now,
      }, { onConflict: "user_id" });
    if (error) throw error;

    try {
      await (supabase as any).from("system_logs").insert({
        event_type: "religamento_real",
        source: "cockpit_real",
        severity: "warning",
        message: "Real RELIGADO pelo painel com senha mestra. Nenhuma autorização de robô foi ligada automaticamente.",
      });
    } catch { /* best-effort */ }

    return { ok: true as const, resumed_at: now };
  });

// ─────────── posições reais abertas, com a corretora mandando ───────────
// Mesma leitura usada pelos dois botões de zeragem (pânico e sem travar).
// Saída de emergência: o cálculo por comandos NÃO pode ser a única fonte.
// Justamente quando o MT5 se comporta mal (comando expirado, execução parcial)
// o livro por comandos zera e a corretora segue posicionada — e é aí que zerar
// é necessário. Por isso b3_mt5_account_state.posicoes entra como fonte
// principal, e o livro por comandos só cobre o que ela não reportou.
type ToClose = {
  symbol: string; side: string; quantity: number; magic_number: number;
  mode: string; variant: string; fonte: "corretora" | "comandos"; profit_brl: number | null;
};

async function collectOpenRealPositions(supabase: any, userId: string, nowMs: number): Promise<ToClose[]> {
  const { data: cmds, error: cmdErr } = await supabase.from("b3_mt5_commands")
    .select("id, action, side, symbol, quantity, mode, variant, status, error_message, created_at, filled_at, filled_price, broker_ticket, magic_number, simulation_run_id, broker_position_ticket")
    .eq("user_id", userId).eq("env", "real")
    .gte("created_at", new Date(nowMs - 5 * 24 * 60 * MINUTE).toISOString())
    .order("created_at", { ascending: true }).limit(2000);
  if (cmdErr) throw cmdErr;

  const profileFor = await loadAssetProfiles(supabase);
  const ledger = buildRealLedger((cmds ?? []) as unknown as RealCommandRow[], profileFor);

  const { data: brokerRow } = await supabase.from("b3_mt5_account_state")
    .select("posicoes, reportado_em").eq("user_id", userId).maybeSingle();

  const fromLedger: ToClose[] = ledger.positions.map((p) => ({
    symbol: rootSymbol(String(p.symbol)), side: String(p.side),
    quantity: Number(p.quantity), magic_number: Number(p.magic_number ?? 0),
    mode: String(p.mode), variant: String(p.variant), fonte: "comandos",
    profit_brl: (p as any).unrealized_brl == null ? null : Number((p as any).unrealized_brl),
  }));
  const fromBroker: ToClose[] = (((brokerRow as any)?.posicoes ?? []) as any[])
    .map((p) => {
      const qty = Math.abs(Number(p?.volume ?? p?.quantidade ?? p?.quantity ?? 0));
      const rawSide = String(p?.side ?? p?.tipo ?? p?.type ?? "").toLowerCase();
      const side = /sell|venda|short/.test(rawSide) ? "sell" : "buy";
      const magic = Number(p?.magic ?? p?.magic_number ?? 0);
      const led = ledger.positions.find((x) => Number(x.magic_number ?? 0) === magic);
      const lucro = p?.profit ?? p?.lucro ?? p?.profit_brl ?? null;
      return {
        symbol: rootSymbol(String(p?.symbol ?? "")), side, quantity: qty, magic_number: magic,
        mode: String(led?.mode ?? "manual"), variant: String(led?.variant ?? "manual"),
        fonte: "corretora" as const,
        profit_brl: lucro == null ? null : Number(lucro),
      };
    })
    .filter((p) => p.symbol && p.quantity > 0);

  const positions: ToClose[] = [...fromBroker];
  for (const p of fromLedger) {
    if (!positions.some((x) => x.magic_number === p.magic_number && x.symbol === p.symbol)) positions.push(p);
  }
  return positions;
}

function buildCloseCommands(userId: string, positions: ToClose[], stamp: number, prefix: string) {
  return positions.map((p) => {
    // Mesma regra do motor e do fechamento manual: RAIZ, nunca o contrato.
    const symbol = rootSymbol(String(p.symbol));
    return {
      user_id: userId,
      env: "real",
      simulation_run_id: null,
      mode: p.mode,
      variant: p.variant,
      action: "close",
      // Fechar é a ponta contrária da posição aberta.
      side: p.side === "buy" ? "sell" : "buy",
      symbol,
      quantity: p.quantity,
      magic_number: p.magic_number,
      idempotency_key: `${prefix}:${symbol}:${p.magic_number}:${stamp}`,
      requested_by: "user_close_all",
      // Validade folgada: pelo celular vale dar tempo do executor reivindicar.
      expires_at: new Date(stamp + 120_000).toISOString(),
    };
  });
}

// ─────────── botão: ZERAR POSIÇÕES (sem travar o real) ───────────
// Nasceu de prejuízo em 15/09: a única zeragem do painel era a de PÂNICO, que
// também desliga o real e exige senha mestra para voltar — e por medo de travar
// o pregão o lucro em aberto não foi realizado. Zerar posição REDUZ risco, então
// aqui não há senha, não há desligamento e nenhuma autorização é revogada:
// b3_real_execution_state.real_enabled continua true e a próxima entrada do
// simulado espelha normalmente. Só um clique de confirmação na tela.
export const closeAllRealPositionsKeepRunning = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ confirm: z.literal(true) }).parse(input))
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const nowMs = Date.now();

    const positions = await collectOpenRealPositions(supabase, userId, nowMs);
    if (!positions.length) {
      return { ok: false as const, queued: 0, reason: "sem posição real aberta para zerar (nem na corretora, nem no cálculo por comandos)" };
    }

    const commands = buildCloseCommands(userId, positions, nowMs, "close_all_keep");
    const { error: insErr } = await (supabase as any).from("b3_mt5_commands").insert(commands);
    if (insErr) throw insErr;

    // Precisa ficar distinguível da zeragem de pânico no histórico: são decisões
    // diferentes. Aqui o real segue ligado.
    try {
      await (supabase as any).from("system_logs").insert({
        event_type: "zeragem_sem_travar",
        source: "cockpit_real",
        severity: "warning",
        message: `Zeragem SEM travar o real: ${commands.length} comando(s) 'close' enfileirado(s). real_enabled segue true e nenhuma autorização foi revogada.`,
        technical_data: {
          comandos: commands.map((c) => ({ symbol: c.symbol, side: c.side, quantity: c.quantity, magic_number: c.magic_number })),
          posicoes: positions.map((p) => ({
            symbol: p.symbol, side: p.side, quantity: p.quantity,
            magic_number: p.magic_number, fonte: p.fonte, resultado_aberto_brl: p.profit_brl,
          })),
          real_enabled: true,
        } as any,
      });
    } catch { /* log é best-effort; os comandos já estão na fila */ }

    return {
      ok: true as const,
      queued: commands.length,
      detalhe: commands.map((c) => `${String(c.side).toUpperCase()} ${c.quantity}x ${c.symbol}`),
    };
  });

// ─────────── botão: PÂNICO — ZERAR E TRAVAR O REAL ───────────
// Comportamento inalterado: fecha tudo, desliga o real e revoga as autorizações;
// religar exige senha mestra.
export const closeRealPositionNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ confirm: z.literal(true) }).parse(input))
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const nowMs = Date.now();

    const positions = await collectOpenRealPositions(supabase, userId, nowMs);

    if (!positions.length) {
      return { ok: false as const, queued: 0, disabled: 0, reason: "sem posição real aberta para zerar (nem na corretora, nem no cálculo por comandos)" };
    }

    const stamp = nowMs;
    const commands = buildCloseCommands(userId, positions, stamp, "panic_close");

    const { error: insErr } = await (supabase as any).from("b3_mt5_commands").insert(commands);
    if (insErr) throw insErr;

    const now = new Date().toISOString();
    await (supabase as any)
      .from("b3_real_execution_state")
      .upsert({
        user_id: userId, real_enabled: false, stopped_at: now,
        stopped_reason: "zeragem solicitada no Cockpit Real", stopped_by: userId, updated_at: now,
      }, { onConflict: "user_id" });

    const { data: rows } = await (supabase as any)
      .from("b3_prd_authorizations")
      .update({ enabled: false, revoked_at: now, updated_at: now })
      .eq("user_id", userId).eq("enabled", true)
      .select("symbol, variant, mode");

    // Pânico derruba TODA liberação manual de freio (16/09/2026): sem real
    // ligado não há o que liberar, e liberação esquecida deixaria o próximo
    // pregão exposto sem ninguém perceber.
    let liberacoesDerrubadas = 0;
    try {
      const { encerrarTodasLiberacoes } = await import("./b3-liberacao-freio.server");
      liberacoesDerrubadas = await encerrarTodasLiberacoes(supabase, userId, "disjuntor_armado");
    } catch { /* best-effort: a zeragem já aconteceu */ }

    try {
      await (supabase as any).from("system_logs").insert({
        event_type: "zeragem_real_pelo_painel",
        source: "cockpit_real",
        severity: "critical",
        message: `Zeragem real solicitada pelo painel: ${commands.length} comando(s) 'close' enfileirado(s).`,
        technical_data: {
          comandos: commands.map((c) => ({ symbol: c.symbol, side: c.side, quantity: c.quantity, magic_number: c.magic_number })),
          fontes: positions.map((p) => ({ magic_number: p.magic_number, fonte: p.fonte })),
          autorizacoes_desligadas: rows ?? [],
          liberacoes_derrubadas: liberacoesDerrubadas,
        } as any,
      });
    } catch { /* best-effort */ }


    return {
      ok: true as const,
      queued: commands.length,
      disabled: (rows ?? []).length,
      detalhe: commands.map((c) => `${String(c.side).toUpperCase()} ${c.quantity}x ${c.symbol}`),
    };
  });


// ─────────── botão: FECHAR ESTA POSIÇÃO (dentro do card) ───────────
// Fecha UMA posição específica reportada pela corretora. Quem executa continua
// sendo o executor: aqui só entra um comando 'close' na fila, com
// requested_by='user_manual_close'. Não desliga autorizações e não pausa nada:
// é um fechamento pontual, não uma parada de emergência.
export const closeRealPositionByBroker = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      symbol: z.string().min(1).max(20),
      side: z.enum(["buy", "sell"]),
      quantity: z.number().positive().max(1000),
      magic_number: z.number().int().nullable().optional(),
      confirm: z.literal(true),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const stamp = Date.now();
    const magic = data.magic_number ?? 0;
    // Símbolo é RAIZ; contrato ('WINV26') é detalhe de execução. O motor
    // enfileira com a raiz e a lista branca do executor é indexada por ela —
    // mandar o contrato daqui era o que fazia o fechamento manual ser recusado
    // com "nao autorizado na lista branca do executor".
    const symbol = rootSymbol(String(data.symbol));

    const command = {
      user_id: userId,
      env: "real",
      simulation_run_id: null,
      mode: "manual",
      variant: "manual",
      action: "close",
      // Fechar é a ponta contrária do que está aberto.
      side: data.side === "buy" ? "sell" : "buy",
      symbol,
      quantity: data.quantity,
      magic_number: magic,
      idempotency_key: `manual_close:${symbol}:${magic}:${stamp}`,
      requested_by: "user_manual_close",
      expires_at: new Date(stamp + 120_000).toISOString(),
    };


    const { data: inserted, error } = await (supabase as any)
      .from("b3_mt5_commands")
      .insert(command)
      .select("id, status, created_at, expires_at")
      .single();
    if (error) throw error;

    try {
      await (supabase as any).from("system_logs").insert({
        event_type: "fechamento_manual_real",
        source: "cockpit_real",
        severity: "warning",
        message: `Fechamento manual solicitado pelo painel: ${command.side.toUpperCase()} ${data.quantity}x ${data.symbol} (magic ${magic}).`,
        technical_data: { command_id: inserted?.id ?? null, magic_number: magic } as any,
      });
    } catch { /* best-effort */ }

    return {
      ok: true as const,
      command_id: (inserted as any)?.id ?? null,
      status: (inserted as any)?.status ?? "pending",
      expires_at: (inserted as any)?.expires_at ?? command.expires_at,
      detalhe: `${command.side.toUpperCase()} ${data.quantity}x ${data.symbol}`,
    };
  });

// Acompanhamento do comando manual: a tela precisa mostrar o veredito quando o
// executor voltar — inclusive recusa.
export const getRealCommandStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ command_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase.from("b3_mt5_commands")
      .select("id, action, side, symbol, quantity, status, error_message, filled_price, broker_ticket, filled_at, created_at, expires_at")
      .eq("user_id", userId).eq("id", data.command_id).maybeSingle();
    if (error) throw error;
    return row ?? null;
  });
