// Helpers do Cockpit Real. Só leitura/cálculo — nada aqui decide entrada.
import type { SupabaseClient } from "@supabase/supabase-js";
import { rootSymbol } from "@/lib/b3-format";

export { rootSymbol };

export interface RealCommandRow {
  id: string;
  action: string;
  side: string | null;
  symbol: string;
  quantity: number | null;
  mode: string;
  variant: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
  filled_at: string | null;
  filled_price: number | null;
  broker_ticket: string | null;
  magic_number: number | null;
}

export interface AssetProfile {
  root: string;
  quote_symbol: string;
  // Contratos conhecidos da raiz (WINQ26, WINV26...). As cotações chegam
  // gravadas no contrato, não na raiz — a busca de preço vivo usa esta lista.
  quote_symbols: string[];
  tick_size: number;
  point_value_brl: number;
}

export type ProfileLookup = (root: string) => AssetProfile;

const DEFAULT_PROFILE = (root: string): AssetProfile => ({
  root, quote_symbol: root, quote_symbols: [root],
  tick_size: root === "WIN" ? 5 : 0.01,
  point_value_brl: root === "WIN" ? 0.2 : root === "WDO" ? 10 : 1,
});

// b3_asset_profiles guarda o contrato (WINQ26) em `symbol` e a raiz em
// `quote_symbol`; a busca precisa aceitar as duas formas.
export async function loadAssetProfiles(supabase: SupabaseClient): Promise<ProfileLookup> {
  const { data } = await supabase
    .from("b3_asset_profiles")
    .select("symbol, quote_symbol, tick_size, tick_value_brl");
  const rows = (data ?? []) as any[];
  return (root: string) => {
    const r = String(root ?? "").toUpperCase();
    const matches = rows.filter(
      (x) => rootSymbol(String(x.quote_symbol ?? x.symbol)) === r || rootSymbol(String(x.symbol)) === r,
    );
    const hit = matches[0];
    if (!hit) return DEFAULT_PROFILE(r);
    const tick = Number(hit.tick_size);
    const contracts = Array.from(new Set(matches.map((x) => String(x.symbol)).concat(r)));
    return {
      root: r,
      quote_symbol: String(hit.quote_symbol ?? hit.symbol),
      quote_symbols: contracts,
      tick_size: Number.isFinite(tick) && tick > 0 ? tick : DEFAULT_PROFILE(r).tick_size,
      // Convenção do motor: tick_value_brl é o valor de 1 PONTO em reais.
      point_value_brl: Number(hit.tick_value_brl ?? DEFAULT_PROFILE(r).point_value_brl),
    };
  };
}


export const saoPauloDate = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

export function isPregaoOpen(now: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = get("weekday");
  if (["Sat", "Sun"].includes(weekday)) return false;
  const mins = Number(get("hour")) * 60 + Number(get("minute"));
  return mins >= 9 * 60 && mins <= 17 * 60 + 30;
}

export interface RealPosition {
  root: string; symbol: string; mode: string; variant: string; magic_number: number;
  side: "buy" | "sell"; quantity: number; entry_price: number | null; entry_time: string | null;
  point_value_brl: number; tick_size: number; broker_ticket: string | null;
}

export interface RealTrade {
  root: string; symbol: string; mode: string; variant: string; magic_number: number;
  side: "buy" | "sell"; quantity: number;
  entry_price: number | null; exit_price: number | null;
  entry_time: string | null; exit_time: string | null;
  result_pts: number | null; result_brl: number | null;
  broker_ticket: string | null;
}

interface Lot {
  qty: number; price: number | null; time: string | null; ticket: string | null;
}

// Livro FIFO por (raiz do ativo + magic): comandos 'filled' entram em ordem
// cronológica. Quem soma é a AÇÃO, não o campo `side`: 'open' abre no lado do
// comando e 'close' abate a posição existente qualquer que seja o `side`
// gravado — o executor manda fechamento com o mesmo `side` da posição, e usar
// o `side` aqui inventaria posição em dobro.
// Quando o executor não gravou filled_price, a operação fica sem resultado
// (null) em vez de virar zero — zero mentiria na soma do dia.
export function buildRealLedger(commands: RealCommandRow[], profileFor: ProfileLookup) {
  const groups = new Map<string, RealCommandRow[]>();
  for (const c of commands) {
    if (c.status !== "filled") continue;
    if (c.side !== "buy" && c.side !== "sell") continue;
    const key = `${rootSymbol(String(c.symbol))}|${Number(c.magic_number ?? 0)}`;
    const list = groups.get(key) ?? [];
    list.push(c);
    groups.set(key, list);
  }

  const positions: RealPosition[] = [];
  const trades: RealTrade[] = [];

  for (const [key, list] of groups) {
    const root = key.split("|")[0] ?? "";
    const profile = profileFor(root);
    list.sort((a, b) => new Date(a.filled_at ?? a.created_at).getTime() - new Date(b.filled_at ?? b.created_at).getTime());

    let longs: Lot[] = [];
    let shorts: Lot[] = [];
    let last = list[list.length - 1]!;

    for (const c of list) {
      const price = c.filled_price == null || Number(c.filled_price) <= 0 ? null : Number(c.filled_price);
      const time = c.filled_at ?? c.created_at;
      let qty = Math.abs(Number(c.quantity ?? 0));
      if (!qty) continue;
      const isClose = String(c.action) === "close";
      // Fechamento abate a ponta que está aberta; abertura abate a contrária
      // (virada de mão) e abre o resto.
      const closingLongs = isClose ? longs.length > 0 : c.side === "sell";
      const target = closingLongs ? longs : shorts;

      while (qty > 0 && target.length) {
        const lot = target[0]!;
        const used = Math.min(qty, lot.qty);
        const entry = lot.price;
        const dir = closingLongs ? 1 : -1; // long: lucro quando o preço sobe
        const pts = entry != null && price != null ? (price - entry) * dir : null;
        trades.push({
          root, symbol: c.symbol, mode: c.mode, variant: c.variant ?? "indicador",
          magic_number: Number(c.magic_number ?? 0),
          side: closingLongs ? "buy" : "sell", quantity: used,
          entry_price: entry, exit_price: price,
          entry_time: lot.time, exit_time: time,
          result_pts: pts, result_brl: pts == null ? null : pts * profile.point_value_brl * used,
          broker_ticket: c.broker_ticket ?? lot.ticket ?? null,
        });
        lot.qty -= used;
        qty -= used;
        if (lot.qty <= 0) target.shift();
      }

      // Sobra só abre posição quando o comando é de ABERTURA. Fechamento
      // sobrando significa desencontro com a corretora — não inventa posição.
      if (qty > 0 && !isClose) {
        const lot: Lot = { qty, price, time, ticket: c.broker_ticket ?? null };
        if (c.side === "buy") longs.push(lot); else shorts.push(lot);
      }
      last = c;
    }


    const openSide: "buy" | "sell" | null = longs.length ? "buy" : shorts.length ? "sell" : null;
    if (openSide) {
      const lots = openSide === "buy" ? longs : shorts;
      const qty = lots.reduce((s, l) => s + l.qty, 0);
      const priced = lots.filter((l) => l.price != null);
      const avg = priced.length
        ? priced.reduce((s, l) => s + (l.price as number) * l.qty, 0) / priced.reduce((s, l) => s + l.qty, 0)
        : null;
      positions.push({
        root, symbol: last.symbol, mode: last.mode, variant: last.variant ?? "indicador",
        magic_number: Number(last.magic_number ?? 0),
        side: openSide, quantity: qty, entry_price: avg,
        entry_time: lots[0]?.time ?? null,
        point_value_brl: profile.point_value_brl, tick_size: profile.tick_size,
        broker_ticket: lots[0]?.ticket ?? null,
      });
    }
  }

  trades.sort((a, b) => new Date(a.exit_time ?? 0).getTime() - new Date(b.exit_time ?? 0).getTime());
  return { positions, trades };
}

// ─────────── Estado reportado pelo executor (verdade da corretora) ───────────
// O executor é o único que fala com o MT5. O que ele reporta é a posição real;
// o livro por comandos (buildRealLedger) fica como SEGUNDA OPINIÃO, útil para
// mostrar divergência quando um comando expirou ou executou fora do previsto.
export interface BrokerPositionRow {
  symbol?: string | null; side?: string | null; volume?: number | null;
  price_open?: number | null; price_current?: number | null; profit?: number | null;
  magic_number?: number | null; ticket?: string | null; opened_at?: string | null;
}

export interface BrokerPosition {
  root: string; symbol: string;
  side: "buy" | "sell" | null;
  quantity: number;
  entry_price: number | null;
  price_current: number | null;
  profit_brl: number | null;
  magic_number: number | null;
  ticket: string | null;
  opened_at: string | null;
  tick_size: number;
  point_value_brl: number;
}

export const STALE_REPORT_S = 60;

export function buildBrokerState(
  row: any | null | undefined,
  ledgerPositions: { root: string; side: "buy" | "sell"; quantity: number; magic_number: number }[],
  profileFor: ProfileLookup,
  nowMs: number,
) {
  const reportedAt: string | null = row?.reported_at ?? null;
  const ageS = reportedAt ? Math.round((nowMs - new Date(reportedAt).getTime()) / 1000) : null;

  const positions: BrokerPosition[] = ((row?.positions ?? []) as BrokerPositionRow[])
    .filter((p) => Math.abs(Number(p?.volume ?? 0)) > 0)
    .map((p) => {
      const symbol = String(p.symbol ?? "").toUpperCase();
      const root = rootSymbol(symbol);
      const profile = profileFor(root);
      return {
        root, symbol,
        side: p.side === "buy" || p.side === "sell" ? p.side : null,
        quantity: Math.abs(Number(p.volume ?? 0)),
        entry_price: p.price_open == null ? null : Number(p.price_open),
        price_current: p.price_current == null ? null : Number(p.price_current),
        profit_brl: p.profit == null ? null : Number(p.profit),
        magic_number: p.magic_number == null ? null : Number(p.magic_number),
        ticket: p.ticket ?? null,
        opened_at: p.opened_at ?? null,
        tick_size: profile.tick_size,
        point_value_brl: profile.point_value_brl,
      };
    });

  // Divergência: comparação por raiz do ativo (a conta da B3 é netting, então o
  // magic do livro pode não bater com o magic da posição líquida).
  const net = (items: { root: string; side: "buy" | "sell" | null; quantity: number }[]) => {
    const m = new Map<string, number>();
    for (const i of items) {
      const dir = i.side === "sell" ? -1 : 1;
      m.set(i.root, (m.get(i.root) ?? 0) + dir * i.quantity);
    }
    return m;
  };
  const brokerNet = net(positions);
  const ledgerNet = net(ledgerPositions);
  const roots = Array.from(new Set([...brokerNet.keys(), ...ledgerNet.keys()]));
  const divergences = roots
    .map((root) => ({
      root,
      broker_net: brokerNet.get(root) ?? 0,
      ledger_net: ledgerNet.get(root) ?? 0,
    }))
    .filter((d) => d.broker_net !== d.ledger_net);

  return {
    reported: !!row,
    reported_at: reportedAt,
    report_age_s: ageS,
    stale: ageS == null ? true : ageS > STALE_REPORT_S,
    balance_brl: row?.balance == null ? null : Number(row.balance),
    equity_brl: row?.equity == null ? null : Number(row.equity),
    free_margin_brl: row?.free_margin == null ? null : Number(row.free_margin),
    account_login: row?.account_login ?? null,
    server_name: row?.server_name ?? null,
    positions,
    open_profit_brl: positions.length
      ? positions.reduce((s, p) => s + (p.profit_brl ?? 0), 0)
      : 0,
    divergences,
    has_divergence: divergences.length > 0,
  };
}
