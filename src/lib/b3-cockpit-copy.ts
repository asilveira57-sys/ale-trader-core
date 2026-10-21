// Geração do texto de "copiar" do Cockpit. Somente apresentação:
// nada aqui participa do motor de simulação, nem lê/escreve no banco.

import { decimalsForTick, freiosAcionadosTexto, openSinceText, PX, rootSymbol, somarSombrasDia } from "./b3-format";
import { modeFullLabel } from "./mode-nick-registry";
import { confirmacaoRegraTexto } from "./b3-confirmacao-entrada";
import { robotLabel, allConfirmed, SHADOW_EXPLANATION } from "./b3-cockpit-labels";

const BRL = (v: number | null | undefined) =>
  Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const SIGNED_BRL = (v: number | null | undefined) =>
  `${Number(v ?? 0) > 0 ? "+" : ""}${BRL(v)}`;

const VARIANT_LABEL: Record<string, string> = {
  indicador: "indicador",
  price_action: "price action",
  mean_reversion: "reversão à média",
  range: "faixa",
  rompimento: "rompimento",
  pullback: "repique",
  vwap: "VWAP",
};
const variantLabel = (v: string) => VARIANT_LABEL[v] ?? String(v ?? "");
const modeLabel = (m: string) => modeFullLabel(m);

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
  lines.push(`${rootSymbol(c.symbol)} · ${variantLabel(c.variant ?? "indicador")} · ${robotLabel(c.mode, c.variant)}`);

  if (isRiskBlocked(c)) {
    // No simulado o freio não bloqueia: é rótulo. A cópia diz isso.
    const motivo = c.current_status === "blocked_stop"
      ? "stop diário atingido"
      : (c.protection_block_reason ?? "trava de risco");
    lines.push(`  FREIO ACIONADO (sombra, segue entrando): ${motivo}`);
  } else if (c.open) {
    const side = c.open.side === "buy" ? "COMPRA" : "VENDA";
    const pts = Number(c.unrealized_pts ?? 0);
    const mov = c.unrealized_pts == null ? "—" : `${movementText(pts, tick)}, ${SIGNED_BRL(c.unrealized_brl)}`;
    const since = openSinceText(c.open.entry_time);
    lines.push(
      `  posição: ${side} ${c.open.quantity}x @ ${PX(c.open.entry_price, tick)}${since ? ` ${since}` : ""} → ${PX(c.live_price, tick)} (${mov})`,
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

  const res: string[] = [`realizado hoje (sem freio) ${BRL(c.realized_today)}`];
  if (c.open && c.unrealized_brl != null) res.push(`em aberto ${BRL(c.unrealized_brl)}`);
  res.push(`total ${BRL(c.total_today)}`);
  res.push(`acumulado ${BRL(c.pnl_accumulated)}`);
  lines.push(`  ${res.join(" · ")}`);
  lines.push(`  ${SHADOW_EXPLANATION}`);

  // Regra geral: a cópia tem TUDO o que o card mostra, na mesma ordem.
  if (c.reactivated_today) lines.push("  reativado hoje após stop diário — resultado do dia não é limpo");
  if (c.grupo?.texto) {
    lines.push(`  ${c.grupo.sem_limite ? "⚠ " : ""}${c.grupo.texto}${c.grupo.travado ? " · simulado entra, real recusado" : ""}`);
  }
  const freiosAgora = freiosAcionadosTexto(c.freios_acionados, c.grupo);
  if (freiosAgora) {
    lines.push(`  FREIOS ACIONADOS (sombra): ${freiosAgora}`);
    lines.push("  entradas continuam, marcadas como sombra");
  }
  const evidence = c.brake_evidence;
  lines.push("  EFEITO NO DIA");
  lines.push(`    Com freio  ${evidence ? BRL(evidence.com_freio_brl) : "sem registro"}`);
  lines.push(`    Sem freio  ${!evidence ? "sem registro" : evidence.ordens_barradas === 0 ? "não acionado" : BRL(evidence.sem_freio_brl)}`);
  lines.push(`    ${evidence?.frase ?? "sem registro"}`);
  lines.push(`    ordens barradas: ${evidence?.ordens_barradas ?? "sem registro"}`);
  // Confirmação de entrada: a cópia mostra o que o card mostra, com os lados.
  if (c.confirmacao && Number(c.confirmacao.entradas ?? 0) > 0) {
    const cf = c.confirmacao;
    const onde = cf.ativo_simulado && cf.ativo_real ? "ligada no simulado e no real"
      : cf.ativo_simulado ? "ligada no simulado"
      : cf.ativo_real ? "ligada no real" : "sombra";
    lines.push(`  CONFIRMAÇÃO DE ENTRADA (${onde}) — ${confirmacaoRegraTexto(cf.pct_stop, cf.janela_s)}`);
    lines.push(`    Com confirmação  ${BRL(cf.com_confirmacao_brl)}`);
    lines.push(`    Sem confirmação  ${allConfirmed(cf) ? "todas confirmaram — sem diferença" : BRL(cf.sem_confirmacao_brl)}`);
    lines.push(`    entradas: ${cf.entradas} no dia, ${cf.confirmadas} teriam confirmado`);
  }


  return lines.join("\n");
}

function scoreboardLine(sb: any): string | null {
  if (!sb) return null;
  return `Placar — saldo do dia\n  Com freio  ${BRL(sb.saldo_dia_com_freio_brl)}\n  Sem freio  ${BRL(sb.saldo_dia_brl)}`;
}

function summaryBlock(cards: any[]): string | null {
  const sombra = somarSombrasDia(cards.map((c) => c.grupo?.sombra));
  if (!sombra || sombra.ops_livre <= 0) return null;
  const lines = ["EFEITO NO DIA — RESUMO"];
  lines.push(`  Com freio  ${BRL(sombra.resultado_sombra_brl)}`);
  lines.push(`  Sem freio  ${BRL(sombra.resultado_livre_brl)}`);
  return lines.join("\n");
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
  if (cards.length > 1) {
    const resumo = summaryBlock(cards);
    if (resumo) parts.push(resumo);
  }
  const body = cards.map(robotBlock).join("\n\n");
  return `${parts.join("\n")}\n\n${body}`.trimEnd();
}

export { variantLabel as copyVariantLabel };
