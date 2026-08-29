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
  tick_size: number;
  point_value_brl: number;
}

export type ProfileLookup = (root: string) => AssetProfile;

const DEFAULT_PROFILE = (root: string): AssetProfile => ({
  root, quote_symbol: root, tick_size: root === "WIN" ? 5 : 0.01,
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
    const hit = rows.find((x) => rootSymbol(String(x.quote_symbol ?? x.symbol)) === r)
      ?? rows.find((x) => rootSymbol(String(x.symbol)) === r);
    if (!hit) return DEFAULT_PROFILE(r);
    const tick = Number(hit.tick_size);
    return {
      root: r,
      quote_symbol: String(hit.quote_symbol ?? hit.symbol),
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
// cronológica, compra soma e venda subtrai. O que sobra é posição aberta.
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
      const isBuy = c.side === "buy";
      const opposite = isBuy ? shorts : longs;

      // Primeiro abate a ponta contrária (fechamento), depois abre o resto.
      while (qty > 0 && opposite.length) {
        const lot = opposite[0]!;
        const used = Math.min(qty, lot.qty);
        const entry = lot.price;
        const dir = isBuy ? -1 : 1; // abatendo short: lucro quando preço cai
        const pts = entry != null && price != null ? (price - entry) * dir : null;
        trades.push({
          root, symbol: c.symbol, mode: c.mode, variant: c.variant ?? "indicador",
          magic_number: Number(c.magic_number ?? 0),
          side: isBuy ? "sell" : "buy", quantity: used,
          entry_price: entry, exit_price: price,
          entry_time: lot.time, exit_time: time,
          result_pts: pts, result_brl: pts == null ? null : pts * profile.point_value_brl * used,
          broker_ticket: c.broker_ticket ?? lot.ticket ?? null,
        });
        lot.qty -= used;
        qty -= used;
        if (lot.qty <= 0) opposite.shift();
      }

      if (qty > 0) {
        const lot: Lot = { qty, price, time, ticket: c.broker_ticket ?? null };
        if (isBuy) longs.push(lot); else shorts.push(lot);
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
