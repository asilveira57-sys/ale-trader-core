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
  buildBrokerState, buildRealLedger, isPregaoOpen, loadAssetProfiles, rootSymbol, saoPauloDate,
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
        .select("id, action, side, symbol, quantity, mode, variant, status, error_message, created_at, filled_at, filled_price, broker_ticket, magic_number")
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
        .select("reportado_em, saldo, capital_liquido, margem_livre, negociacao_permitida, posicoes, account_login, server_name")
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
    const ledger = buildRealLedger(commands, profileFor);

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
      const { data: q } = await supabase.from("b3_mt5sim_quotes")
        .select("bid, ask, last, tick_ts")
        .eq("user_id", userId).in("symbol", p.quote_symbols)
        .order("tick_ts", { ascending: false }).limit(1);
      const row = (q ?? [])[0] as any;
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
    const positions = ledger.positions.map((p) => {
      // Conta B3 é netting: o magic da posição líquida pode não bater com o do
      // livro. Presença por raiz + lado já é confirmação suficiente.
      const naCorretora = broker.positions.some(
        (b) => b.root === p.root && (b.magic_number === p.magic_number || b.side === null || b.side === p.side),
      );
      const confirmada = !brokerTrustworthy || naCorretora;
      const quote = quoteByRoot[p.root] ?? { price: null, tick_ts: null, age_s: null };
      const dir = p.side === "buy" ? 1 : -1;
      const live = quote.price;
      const pts = confirmada && live != null && p.entry_price != null ? (live - p.entry_price) * dir : null;
      const brl = pts != null ? pts * p.point_value_brl * p.quantity : null;
      return {
        ...p,
        live_price: live, quote_tick_ts: quote.tick_ts, quote_age_s: quote.age_s,
        unrealized_pts: pts, unrealized_brl: brl,
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
      alerts.push({
        kind: "real_parado", severity: "warning",
        title: "Real parado pela tela",
        detail: `Novas entradas reais bloqueadas${realState.stopped_reason ? `: ${realState.stopped_reason}` : "."} A simulação segue coletando normalmente.`,
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
    for (const dv of broker.divergences) {
      alerts.push({
        kind: "divergencia_posicao", severity: "warning",
        title: `Divergência em ${dv.root}: corretora ${dv.broker_net} x comandos ${dv.ledger_net}`,
        detail: "Algum comando expirou ou executou fora do previsto. A corretora é a verdade; o cálculo por comandos é segunda opinião.",
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


    return {
      server_time: now.toISOString(),
      session_date: sessionDate,
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
      alerts: alerts.slice(0, 12),
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

// ─────────── botão: ZERAR POSIÇÃO REAL AGORA ───────────
export const closeRealPositionNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ confirm: z.literal(true) }).parse(input))
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const nowMs = Date.now();

    const { data: cmds, error: cmdErr } = await supabase.from("b3_mt5_commands")
      .select("id, action, side, symbol, quantity, mode, variant, status, error_message, created_at, filled_at, filled_price, broker_ticket, magic_number, simulation_run_id")
      .eq("user_id", userId).eq("env", "real")
      .gte("created_at", new Date(nowMs - 5 * 24 * 60 * MINUTE).toISOString())
      .order("created_at", { ascending: true }).limit(2000);
    if (cmdErr) throw cmdErr;

    const profileFor = await loadAssetProfiles(supabase);
    const ledger = buildRealLedger((cmds ?? []) as unknown as RealCommandRow[], profileFor);

    // Saída de emergência: o cálculo por comandos NÃO pode ser a única fonte.
    // Justamente quando o MT5 se comporta mal (comando expirado, execução
    // parcial) o livro por comandos zera e a corretora segue posicionada — e é
    // aí que este botão é necessário. Por isso a verdade da corretora
    // (b3_mt5_account_state.posicoes) entra como fonte alternativa.
    const { data: brokerRow } = await supabase.from("b3_mt5_account_state")
      .select("posicoes, reportado_em").eq("user_id", userId).maybeSingle();

    type ToClose = { symbol: string; side: string; quantity: number; magic_number: number; mode: string; variant: string; fonte: "corretora" | "comandos" };
    const fromLedger: ToClose[] = ledger.positions.map((p) => ({
      symbol: rootSymbol(String(p.symbol)), side: String(p.side),
      quantity: Number(p.quantity), magic_number: Number(p.magic_number ?? 0),
      mode: String(p.mode), variant: String(p.variant), fonte: "comandos",
    }));
    const fromBroker: ToClose[] = (((brokerRow as any)?.posicoes ?? []) as any[])
      .map((p) => {
        const qty = Math.abs(Number(p?.volume ?? p?.quantidade ?? p?.quantity ?? 0));
        const rawSide = String(p?.side ?? p?.tipo ?? p?.type ?? "").toLowerCase();
        const side = /sell|venda|short/.test(rawSide) ? "sell" : "buy";
        const magic = Number(p?.magic ?? p?.magic_number ?? 0);
        const led = ledger.positions.find((x) => Number(x.magic_number ?? 0) === magic);
        return {
          symbol: rootSymbol(String(p?.symbol ?? "")), side, quantity: qty, magic_number: magic,
          mode: String(led?.mode ?? "manual"), variant: String(led?.variant ?? "manual"),
          fonte: "corretora" as const,
        };
      })
      .filter((p) => p.symbol && p.quantity > 0);

    // Corretora manda; o livro por comandos só cobre o que ela não reportou.
    const positions: ToClose[] = [...fromBroker];
    for (const p of fromLedger) {
      if (!positions.some((x) => x.magic_number === p.magic_number && x.symbol === p.symbol)) positions.push(p);
    }

    if (!positions.length) {
      return { ok: false as const, queued: 0, disabled: 0, reason: "sem posição real aberta para zerar (nem na corretora, nem no cálculo por comandos)" };
    }


    const stamp = nowMs;
    const commands = positions.map((p) => {
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
        idempotency_key: `panic_close:${symbol}:${p.magic_number}:${stamp}`,
        requested_by: "user_close_all",
        // Validade folgada: pelo celular vale dar tempo do executor reivindicar.
        expires_at: new Date(stamp + 120_000).toISOString(),
      };
    });


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
