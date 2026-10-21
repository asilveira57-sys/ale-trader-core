// Read-only asset dashboard, same financial presentation as legacy implementation.
// The only source replacement is available-day navigation from stored orders.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadAssetProfile } from "./b3-simulation.functions";
import { MODE_KEYS as MODES } from "./b3-listas-format";
const TICK = 5;
const POINT_VALUE_BRL = 0.2;
const WIN_FALLBACK_ASSET_PROFILE = { tick_value_brl: POINT_VALUE_BRL };
const currentB3SessionDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
export const getB3AssetDashboardOrders = createServerFn({ method: "POST" })
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
    const navigation: string[] = [];
    let navigationTruncated = false;
    const navigationIds = assetRuns.map((r: any) => r.id);
    if (navigationIds.length) for (let from = 0; from < 60_000; from += 1000) {
      const { data: page, error } = await (supabase as any).from("b3_simulation_orders")
        .select("entry_time").eq("user_id", userId).in("simulation_run_id", navigationIds)
        .gte("entry_time", `${addDays(today, -400)}T03:00:00.000Z`)
        .order("entry_time").order("id").range(from, from + 999);
      if (error) throw new Error("Não foi possível ler os dias com ordens");
      for (const row of page ?? []) if (row.entry_time) navigation.push(brtDay(row.entry_time));
      if (!page || page.length < 1000) break;
      if (from + 1000 === 60_000) navigationTruncated = true;
    }
    const diasDisponiveis = [...new Set(navigation)].sort();

    const base = {
      session_date: sessionDate,
      periodo: { de, ate },
      multi_day: multiDay,
      dias_disponiveis: diasDisponiveis,
      navigation_truncated: navigationTruncated,
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
      return perMode.get(k) ?? { ops: 0, wins: 0, ganhos: 0, perdas: 0, resultado: 0, aberto: 0, open: false };
    };

    let realizado = 0, aberto = 0, ganhos = 0, perdas = 0, opsTotal = 0, opsLucro = 0;
    const events: { t: number; dm: number; dq: number }[] = [];
    const closedTimeline: { t: number; net: number }[] = [];
    type DayAgg = { resultado: number; ops: number; wins: number };
    const perDay = new Map<string, DayAgg>();
    const ensureDay = (d: string) => {
      if (!perDay.has(d)) perDay.set(d, { resultado: 0, ops: 0, wins: 0 });
      return perDay.get(d) ?? { resultado: 0, ops: 0, wins: 0 };
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
      groupMap.get(variant)?.push({
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
      const list = groupMap.get(variant) ?? [];
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


