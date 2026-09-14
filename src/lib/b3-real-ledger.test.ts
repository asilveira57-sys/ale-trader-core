// Livro real em conta HEDGE: abertura nunca abate; fechamento pareia por ticket.
// Cenário 4 dos critérios: magic 2507 em 14/09/2026.
import { describe, expect, it } from "vitest";
import { buildRealLedger, type RealCommandRow } from "@/lib/b3-real-cockpit.server";

const profileFor = () => ({
  root: "WIN", quote_symbol: "WIN", quote_symbols: ["WIN"],
  tick_size: 5, point_value_brl: 0.2,
});

const cmd = (o: Partial<RealCommandRow>): RealCommandRow => ({
  id: o.id ?? "c", action: o.action ?? "open", side: o.side ?? "buy",
  symbol: "WINV26", quantity: o.quantity ?? 1, mode: "arrojado", variant: "price_action",
  status: "filled", error_message: null,
  created_at: o.created_at ?? "2026-09-14T15:35:20.000Z",
  filled_at: o.filled_at ?? o.created_at ?? "2026-09-14T15:35:20.000Z",
  filled_price: o.filled_price ?? 140000, broker_ticket: null, magic_number: 2507,
  broker_position_ticket: o.broker_position_ticket ?? null,
});

describe("buildRealLedger", () => {
  it("HEDGE: dois open em lados opostos viram duas posições", () => {
    const { positions, trades } = buildRealLedger([
      cmd({ id: "a", action: "open", side: "buy", created_at: "2026-09-14T15:35:20.000Z" }),
      cmd({ id: "b", action: "open", side: "sell", created_at: "2026-09-14T16:38:36.000Z" }),
    ], profileFor);
    expect(positions).toHaveLength(2);
    expect(trades).toHaveLength(0);
  });

  it("NETTING preserva a inversão antiga", () => {
    const { positions, trades } = buildRealLedger([
      cmd({ id: "a", action: "open", side: "buy" }),
      cmd({ id: "b", action: "open", side: "sell", created_at: "2026-09-14T16:38:36.000Z" }),
    ], profileFor, "NETTING");
    expect(positions).toHaveLength(0);
    expect(trades).toHaveLength(1);
  });

  it("sequência do magic 2507 deixa UMA posição aberta", () => {
    const { positions, trades } = buildRealLedger([
      cmd({ id: "a", action: "open", side: "buy", created_at: "2026-09-14T15:35:20.000Z", broker_position_ticket: "111" }),
      cmd({ id: "b", action: "open", side: "sell", created_at: "2026-09-14T16:38:36.000Z", broker_position_ticket: "222" }),
      cmd({ id: "c", action: "close", side: "buy", quantity: 1, created_at: "2026-09-14T16:42:59.000Z", broker_position_ticket: "111" }),
    ], profileFor);
    expect(trades).toHaveLength(1);
    expect(positions).toHaveLength(1);
    expect(positions[0]!.side).toBe("sell");
    expect(positions[0]!.quantity).toBe(1);
  });

  it("close com ticket abate exatamente aquele lote", () => {
    const { trades } = buildRealLedger([
      cmd({ id: "a", action: "open", side: "buy", filled_price: 140000, broker_position_ticket: "111" }),
      cmd({ id: "b", action: "open", side: "buy", filled_price: 141000, created_at: "2026-09-14T15:40:00.000Z", broker_position_ticket: "222" }),
      cmd({ id: "c", action: "close", side: "buy", filled_price: 141500, created_at: "2026-09-14T16:00:00.000Z", broker_position_ticket: "222" }),
    ], profileFor);
    expect(trades).toHaveLength(1);
    expect(trades[0]!.entry_price).toBe(141000);
    expect(trades[0]!.result_pts).toBe(500);
  });

  it("comando antigo sem ticket continua no FIFO", () => {
    const { positions, trades } = buildRealLedger([
      cmd({ id: "a", action: "open", side: "buy", filled_price: 140000 }),
      cmd({ id: "b", action: "close", side: "buy", filled_price: 140500, created_at: "2026-09-14T16:00:00.000Z" }),
    ], profileFor);
    expect(positions).toHaveLength(0);
    expect(trades).toHaveLength(1);
    expect(trades[0]!.result_pts).toBe(500);
  });
});
