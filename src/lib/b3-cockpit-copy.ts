// Geração do texto de "copiar" do Cockpit. Somente apresentação:
// nada aqui participa do motor de simulação, nem lê/escreve no banco.

import { decimalsForTick, rootSymbol, PX } from "./b3-format";

const BRL = (v: number | null | undefined) =>
  Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const SIGNED_BRL = (v: number | null | undefined) =>
  `${Number(v ?? 0) > 0 ? "+" : ""}${BRL(v)}`;

const VARIANT_LABEL: Record<string, string> = {
  indicador: "indicador",
  price_action: "price action",
  mean_reversion: "reversão à média",
  range: "faixa",
};
const variantLabel = (v: string) => VARIANT_LABEL[v] ?? String(v ?? "");
const modeLabel = (m: string) => String(m ?? "").replace("_", " ");

// Em ações (tick 0,01) o movimento é lido em centavos; em futuros, em pontos.
const movementText = (pts: number, tick: number) => {
  const sign = pts > 0 ? "+" : "";
  if (Number(tick) <= 0.01) {
    const cents = Math.round(pts * 100);
    return `${cents > 0 ? "+" : ""}${cents} centavos`;
  }
  const d = decimalsForTick(tick);
  return `${sign}${Number(pts).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d })} pts`;
};

const stamp = () => {
  const now = new Date();
  const date = now.toLocaleDateString("pt-BR");
  const time = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `${date} ${time}`;
};

const isRiskBlocked = (c: any) =>
  c.current_status === "blocked_stop" || !!c.protection_block_reason;

function robotBlock(c: any): string {
  const tick = Number(c.tick_size ?? 5);
  const lines: string[] = [];
  lines.push(`${rootSymbol(c.symbol)} · ${variantLabel(c.variant ?? "indicador")} · ${modeLabel(c.mode)}`);

  if (isRiskBlocked(c)) {
    const motivo = c.current_status === "blocked_stop"
      ? "stop diário atingido"
      : (c.protection_block_reason ?? "trava de risco");
    lines.push(`  BLOQUEADO: ${motivo}`);
  } else if (c.open) {
    const side = c.open.side === "buy" ? "COMPRA" : "VENDA";
    const pts = Number(c.unrealized_pts ?? 0);
    const mov = c.unrealized_pts == null ? "—" : `${movementText(pts, tick)}, ${SIGNED_BRL(c.unrealized_brl)}`;
    lines.push(
      `  posição: ${side} ${c.open.quantity}x @ ${PX(c.open.entry_price, tick)} → ${PX(c.live_price, tick)} (${mov})`,
    );
    const stop = c.open.stop_price ?? c.open.stop_loss ?? null;
    const alvo = c.open.take_profit ?? c.open.target_price ?? null;
    if (stop != null || alvo != null) {
      const partes: string[] = [];
      if (stop != null) partes.push(`stop ${PX(Number(stop), tick)}`);
      if (alvo != null) partes.push(`alvo ${PX(Number(alvo), tick)}`);
      lines.push(`  ${partes.join(" · ")}`);
    }
  } else if (c.enabled === false) {
    lines.push("  desligado por configuração");
  } else {
    lines.push(`  ${c.blocked_reason ?? "sem posição — aguardando sinal"}`);
  }

  // Stop pendente não executado: informação mais crítica que pode aparecer.
  if (c.pending_stop) {
    const min = Math.max(1, Math.round(Number(c.pending_stop.elapsed_s ?? 0) / 60));
    const beyond = Math.round(Number(c.pending_stop.beyond_pts ?? 0));
    lines.push(`  ⚠ STOP PENDENTE há ${min} min · ${beyond} pts além do nível`);
  }

  const res: string[] = [`realizado hoje ${BRL(c.realized_today)}`];
  if (c.open && c.unrealized_brl != null) res.push(`em aberto ${BRL(c.unrealized_brl)}`);
  res.push(`total ${BRL(c.total_today)}`);
  res.push(`acumulado ${BRL(c.pnl_accumulated)}`);
  lines.push(`  ${res.join(" · ")}`);

  return lines.join("\n");
}

function scoreboardLine(sb: any): string | null {
  if (!sb) return null;
  return `Placar: saldo do dia ${SIGNED_BRL(sb.saldo_dia_brl)} · exposição ${BRL(sb.exposicao_atual_brl)} · ${sb.robots_posicionados ?? 0} de ${sb.robots_total ?? 0} posicionados`;
}

export function buildCockpitCopyText(
  cards: any[],
  opts: { scope: string; scoreboard?: any; includeScoreboard?: boolean },
): string {
  const head = `AleTrader B3 — ${stamp()} — ${opts.scope}`;
  const parts = [head];
  if (opts.includeScoreboard) {
    const sl = scoreboardLine(opts.scoreboard);
    if (sl) parts.push(sl);
  }
  const body = cards.map(robotBlock).join("\n\n");
  return `${parts.join("\n")}\n\n${body}`.trimEnd();
}

export { variantLabel as copyVariantLabel };
