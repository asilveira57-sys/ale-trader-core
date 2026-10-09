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
  // 'engine_auto' | 'user_manual_close' | ... — distingue fechamento do sistema
  // do fechamento na mão pelo usuário. Opcional: consultas antigas não pedem.
  requested_by?: string | null;
  // Ticket da POSIÇÃO na corretora, informado pelo executor no ack: na abertura
  // é a posição criada; no fechamento, a(s) posição(ões) encerrada(s) (lista
  // separada por vírgula). Linhas antigas não têm — caem no FIFO.
  broker_position_ticket?: string | null;
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
  // ids dos comandos de abertura ainda vivos nesta posição (apresentação)
  open_command_ids?: string[];
}

export interface RealTrade {
  root: string; symbol: string; mode: string; variant: string; magic_number: number;
  side: "buy" | "sell"; quantity: number;
  entry_price: number | null; exit_price: number | null;
  entry_time: string | null; exit_time: string | null;
  result_pts: number | null; result_brl: number | null;
  broker_ticket: string | null;
  // quem pediu o FECHAMENTO desta operação (engine_auto / user_manual_close)
  closed_by?: string | null;
  // Rastro de apresentação: id do comando de abertura e do de fechamento que
  // originaram esta operação. Só metadado — não muda o pareamento.
  open_command_id?: string | null;
  close_command_id?: string | null;
  point_value_brl?: number;
  tick_size?: number;
}

interface Lot {
  qty: number; price: number | null; time: string | null; ticket: string | null;
  command_id?: string | null;
  // ticket da POSIÇÃO na corretora que este lote representa (quando informado)
  pos_ticket?: string | null;
}

// Modo da conta na corretora. Vem do executor em b3_mt5_account_state.modo_conta.
export type AccountMode = "HEDGE" | "NETTING" | "EXCHANGE";

// Sem informação, assume HEDGE: é o estado real da conta desde 31/08/2026 e o
// erro seguro é o que MOSTRA posição demais. Assumir netting ESCONDE posição
// aberta — foi exatamente o que deixou o magic 2507 4h40 sem gestão em 14/09.
export function normalizeAccountMode(v: unknown): AccountMode {
  const s = String(v ?? "").trim().toUpperCase();
  if (s === "NETTING") return "NETTING";
  if (s === "EXCHANGE") return "EXCHANGE";
  return "HEDGE";
}

const parseTickets = (v: unknown): string[] =>
  String(v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

// Livro por (raiz do ativo + magic): comandos 'filled' entram em ordem
// cronológica. Quem soma é a AÇÃO, não o campo `side`: 'open' abre no lado do
// comando e 'close' abate a posição existente qualquer que seja o `side`
// gravado — o executor manda fechamento com o mesmo `side` da posição, e usar
// o `side` aqui inventaria posição em dobro.
//
// HEDGE (padrão): abertura NUNCA abate lote existente — cria sempre um lote
// novo, porque na corretora ela cria uma posição independente. Só 'close'
// abate. NETTING preserva o comportamento antigo (abrir vendido reduz a compra).
//
// Pareamento: quando o comando traz broker_position_ticket, o fechamento abate
// EXATAMENTE o lote daquela posição — sem adivinhação. Linhas antigas sem o
// ticket seguem pelo FIFO.
// Quando o executor não gravou filled_price, a operação fica sem resultado
// (null) em vez de virar zero — zero mentiria na soma do dia.
export function buildRealLedger(
  commands: RealCommandRow[],
  profileFor: ProfileLookup,
  accountMode: AccountMode = "HEDGE",
  // Tickets de posição cujo registro no livro (b3_live_orders) já foi resolvido
  // (closed, fechada_pela_corretora, divergente_corretora, irreconciliavel ou
  // com exit_time). O lote de abertura correspondente NÃO conta como posição
  // aberta na segunda opinião — senão o mesmo registro velho grita todo dia.
  resolvedTickets?: Set<string>,
) {
  const netting = accountMode === "NETTING";
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

    const longs: Lot[] = [];
    const shorts: Lot[] = [];
    let last = list[list.length - 1]!;

    for (const c of list) {
      const price = c.filled_price == null || Number(c.filled_price) <= 0 ? null : Number(c.filled_price);
      const time = c.filled_at ?? c.created_at;
      let qty = Math.abs(Number(c.quantity ?? 0));
      if (!qty) continue;
      const isClose = String(c.action) === "close";
      const tickets = parseTickets(c.broker_position_ticket);

      // Registra uma operação encerrada abatendo `used` do lote informado.
      const settle = (lot: Lot, used: number, closingLongs: boolean, cmd: RealCommandRow) => {
        const entry = lot.price;
        const dir = closingLongs ? 1 : -1; // long: lucro quando o preço sobe
        const pts = entry != null && price != null ? (price - entry) * dir : null;
        trades.push({
          root, symbol: cmd.symbol, mode: cmd.mode, variant: cmd.variant ?? "indicador",
          magic_number: Number(cmd.magic_number ?? 0),
          side: closingLongs ? "buy" : "sell", quantity: used,
          entry_price: entry, exit_price: price,
          entry_time: lot.time, exit_time: time,
          result_pts: pts, result_brl: pts == null ? null : pts * profile.point_value_brl * used,
          broker_ticket: cmd.broker_ticket ?? lot.ticket ?? null,
          closed_by: cmd.requested_by ?? null,
          open_command_id: lot.command_id ?? null,
          close_command_id: cmd.id,
          point_value_brl: profile.point_value_brl,
          tick_size: profile.tick_size,
        });
        lot.qty -= used;
      };

      const drain = (target: Lot[], closingLongs: boolean) => {
        while (qty > 0 && target.length) {
          const lot = target[0]!;
          const used = Math.min(qty, lot.qty);
          settle(lot, used, closingLongs, c);
          qty -= used;
          if (lot.qty <= 0) target.shift();
        }
      };

      if (isClose) {
        // 1) pareamento exato pelo ticket da posição encerrada
        for (const tk of tickets) {
          if (qty <= 0) break;
          for (const [target, closingLongs] of [[longs, true], [shorts, false]] as [Lot[], boolean][]) {
            const idx = target.findIndex((l) => l.pos_ticket === tk);
            if (idx < 0) continue;
            const lot = target[idx]!;
            const used = Math.min(qty, lot.qty);
            settle(lot, used, closingLongs, c);
            qty -= used;
            if (lot.qty <= 0) target.splice(idx, 1);
            break;
          }
        }
        // 2) sobra (ou comando antigo sem ticket): FIFO na ponta aberta
        if (qty > 0) drain(longs.length > 0 ? longs : shorts, longs.length > 0);
        if (qty > 0) drain(shorts, false);
      } else if (netting) {
        // Conta netting: abrir no lado contrário reduz a posição existente.
        const closingLongs = c.side === "sell";
        drain(closingLongs ? longs : shorts, closingLongs);
      }

      // Sobra só abre posição quando o comando é de ABERTURA. Fechamento
      // sobrando significa desencontro com a corretora — não inventa posição.
      if (qty > 0 && !isClose) {
        const lot: Lot = {
          qty, price, time, ticket: c.broker_ticket ?? null, command_id: c.id,
          pos_ticket: tickets[0] ?? null,
        };
        if (c.side === "buy") longs.push(lot); else shorts.push(lot);
      }
      last = c;
    }

    // Em HEDGE as duas pontas podem coexistir: cada uma vira uma posição.
    for (const [allLots, openSide] of [[longs, "buy"], [shorts, "sell"]] as [Lot[], "buy" | "sell"][]) {
      const lots = resolvedTickets?.size
        ? allLots.filter((l) => !(
            (l.ticket && resolvedTickets.has(String(l.ticket))) ||
            (l.pos_ticket && resolvedTickets.has(String(l.pos_ticket)))
          ))
        : allLots;
      if (!lots.length) continue;
      const qty = lots.reduce((s, l) => s + l.qty, 0);
      if (qty <= 0) continue;
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
        open_command_ids: lots.map((l) => l.command_id).filter(Boolean) as string[],
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
  preco_abertura?: number | null; preco_atual?: number | null; resultado?: number | null;
  magic?: number | null; ticket?: string | null; aberta_em?: string | null;
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

// A = corretora tem exposição que o sistema não conhece (inclui lado trocado).
// B = sistema acha que tem mais do que a corretora — nenhuma exposição a mais.
export function sentidoDe(brokerNet: number, ledgerNet: number): "A" | "B" {
  if (brokerNet !== 0 && Math.sign(brokerNet) !== Math.sign(ledgerNet)) return "A";
  return Math.abs(brokerNet) > Math.abs(ledgerNet) ? "A" : "B";
}

export function buildBrokerState(
  row: any | null | undefined,
  ledgerPositions: { root: string; side: "buy" | "sell"; quantity: number; magic_number: number }[],
  profileFor: ProfileLookup,
  nowMs: number,
) {
  const reportedAt: string | null = row?.reportado_em ?? null;
  const ageS = reportedAt ? Math.round((nowMs - new Date(reportedAt).getTime()) / 1000) : null;

  const positions: BrokerPosition[] = ((row?.posicoes ?? []) as BrokerPositionRow[])
    .filter((p) => Math.abs(Number(p?.volume ?? 0)) > 0)
    .map((p) => {
      const symbol = String(p.symbol ?? "").toUpperCase();
      const root = rootSymbol(symbol);
      const profile = profileFor(root);
      return {
        root, symbol,
        side: p.side === "buy" || p.side === "sell" ? p.side : null,
        quantity: Math.abs(Number(p.volume ?? 0)),
        entry_price: p.preco_abertura == null ? null : Number(p.preco_abertura),
        price_current: p.preco_atual == null ? null : Number(p.preco_atual),
        profit_brl: p.resultado == null ? null : Number(p.resultado),
        magic_number: p.magic == null ? null : Number(p.magic),
        ticket: p.ticket ?? null,
        opened_at: p.aberta_em ?? null,
        tick_size: profile.tick_size,
        point_value_brl: profile.point_value_brl,
      };
    });

  // Divergência por RAIZ (líquido do ativo) e por MAGIC (robô): em hedge duas
  // pontas do mesmo ativo podem coexistir, e a divergência de 14/09 estava
  // DENTRO do ativo — só a comparação por magic a enxerga.
  const net = <T extends { side: "buy" | "sell" | null; quantity: number }>(
    items: T[], keyOf: (i: T) => string,
  ) => {
    const m = new Map<string, number>();
    for (const i of items) {
      const dir = i.side === "sell" ? -1 : 1;
      m.set(keyOf(i), (m.get(keyOf(i)) ?? 0) + dir * i.quantity);
    }
    return m;
  };
  const diff = (a: Map<string, number>, b: Map<string, number>) =>
    Array.from(new Set([...a.keys(), ...b.keys()]))
      .map((k) => ({ key: k, broker_net: a.get(k) ?? 0, ledger_net: b.get(k) ?? 0 }))
      .filter((d) => d.broker_net !== d.ledger_net);

  const divergences = diff(
    net(positions, (p) => p.root),
    net(ledgerPositions, (p) => p.root),
  ).map((d) => ({ root: d.key, broker_net: d.broker_net, ledger_net: d.ledger_net, sentido: sentidoDe(d.broker_net, d.ledger_net) }));

  const magicDivergences = diff(
    net(positions.filter((p) => p.magic_number != null), (p) => `${p.root}|${p.magic_number}`),
    net(ledgerPositions, (p) => `${p.root}|${p.magic_number}`),
  ).map((d) => {
    const [root = "", magic = "0"] = d.key.split("|");
    return { root, magic_number: Number(magic), broker_net: d.broker_net, ledger_net: d.ledger_net, sentido: sentidoDe(d.broker_net, d.ledger_net) };
  });

  const fresh = ageS != null && ageS <= STALE_REPORT_S;
  // Sentido A (corretora > sistema) = exposição real sem gestão → crítico.
  // Sentido B (sistema > corretora) = registro nosso não baixado → só aviso.
  const temA = divergences.some((d) => d.sentido === "A") || magicDivergences.some((d) => d.sentido === "A");
  const temB = divergences.some((d) => d.sentido === "B") || magicDivergences.some((d) => d.sentido === "B");

  return {
    reported: !!row,
    reported_at: reportedAt,
    report_age_s: ageS,
    stale: ageS == null ? true : ageS > STALE_REPORT_S,
    account_mode: normalizeAccountMode(row?.modo_conta),
    balance_brl: row?.saldo == null ? null : Number(row.saldo),
    equity_brl: row?.capital_liquido == null ? null : Number(row.capital_liquido),
    free_margin_brl: row?.margem_livre == null ? null : Number(row.margem_livre),
    trading_allowed: row?.negociacao_permitida ?? null,
    account_login: row?.account_login ?? null,
    server_name: row?.server_name ?? null,
    positions,
    open_profit_brl: positions.length
      ? positions.reduce((s, p) => s + (p.profit_brl ?? 0), 0)
      : 0,
    divergences,
    magic_divergences: magicDivergences,
    has_divergence: divergences.length > 0 || magicDivergences.length > 0,
    // Relatório fresco + divergência = posição possivelmente sem stop. É o pior
    // estado possível: a tela precisa gritar, não deixar nota de rodapé.
    divergencia_critica: fresh && temA,
    divergencia_escrituracao: fresh && temB,
  };
}
