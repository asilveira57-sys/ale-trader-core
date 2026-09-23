// ── CONFIRMAÇÃO DE ENTRADA, EM SOMBRA (23/09/2026) ───────────────────────────
//
// Medição, não regra. O robô continua entrando exatamente como entra hoje. O que
// se acrescenta é o REGISTRO do que teria acontecido se a entrada só valesse
// depois de o preço andar a favor.
//
// O limiar é PERCENTUAL DO STOP do próprio robô — 100 pontos no WIN não
// significa nada parecido no dólar ou no BIT. A janela é em segundos.
//
// Nada aqui bloqueia, reduz, fecha ou atrasa qualquer entrada ou saída, nem no
// simulado nem no real. Nenhum motor lê `confirmou` para decidir.
// `stop_recalculado` e `alvo_recalculado` são onde o stop e o alvo FICARIAM se a
// entrada fosse no preço de confirmação: registro, nunca aplicado — o stop e o
// alvo contratados na abertura seguem valendo intactos.

import { roundToTick } from "./b3-tick";

/** Pré-preenchimento da configuração. Nasce DESLIGADA, robô a robô. */
export const CONFIRMACAO_PADRAO = { pct_stop: 50, janela_s: 180 } as const;

export type ConfirmacaoConfig = {
  confirmacao_ativa?: boolean | null;
  confirmacao_pct_stop?: number | null;
  confirmacao_janela_s?: number | null;
};

/** Limiar em pontos para este robô nesta entrada (0 = sem stop congelado). */
export function confirmacaoExigidaPts(stopPts: number, pctStop: number | null | undefined): number {
  const stop = Number(stopPts);
  const pct = Number(pctStop);
  if (!Number.isFinite(stop) || stop <= 0) return 0;
  const p = Number.isFinite(pct) && pct > 0 ? pct : CONFIRMACAO_PADRAO.pct_stop;
  return Math.round((stop * p) / 100);
}

/** Campos gravados na ABERTURA da ordem. `confirmou` nasce nulo (indefinido). */
export function confirmacaoNaAbertura(cfg: ConfirmacaoConfig, stopPtsFrozen: number) {
  const janelaRaw = Number(cfg?.confirmacao_janela_s);
  const janela = Number.isFinite(janelaRaw) && janelaRaw > 0
    ? Math.round(janelaRaw) : CONFIRMACAO_PADRAO.janela_s;
  const exigida = confirmacaoExigidaPts(stopPtsFrozen, cfg?.confirmacao_pct_stop);
  return {
    confirmacao_exigida_pts: exigida > 0 ? exigida : null,
    confirmacao_janela_s: janela,
    confirmou: null as boolean | null,
    confirmou_em: null as string | null,
    preco_confirmacao: null as number | null,
    stop_recalculado: null as number | null,
    alvo_recalculado: null as number | null,
  };
}

export type ConfirmacaoOrdem = {
  side: string;
  entry_price: number | string;
  entry_time?: string | null;
  created_at?: string | null;
  stop_pts?: number | string | null;
  gain_pts?: number | string | null;
  confirmacao_exigida_pts?: number | string | null;
  confirmacao_janela_s?: number | string | null;
  confirmou?: boolean | null;
};

/**
 * Patch de confirmação para uma posição ABERTA, a partir do preço marcado a
 * mercado. Devolve `null` quando nada mudou — escrita só quando há mudança real
 * (custo de banco é escrita).
 *
 * - andou o exigido a favor dentro da janela → confirmou
 * - janela vencida sem andar o exigido      → não confirmou (fecha a medição)
 */
export function avaliarConfirmacao(
  order: ConfirmacaoOrdem,
  markPrice: number,
  tickSize: number,
  agoraMs: number = Date.now(),
): Record<string, any> | null {
  if (order.confirmou === true || order.confirmou === false) return null;
  const exigida = Number(order.confirmacao_exigida_pts ?? 0);
  if (!Number.isFinite(exigida) || exigida <= 0) return null;
  const entry = Number(order.entry_price);
  const preco = Number(markPrice);
  if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(preco) || preco <= 0) return null;

  const abertaEm = order.entry_time ?? order.created_at ?? null;
  const abertaMs = abertaEm ? new Date(abertaEm).getTime() : NaN;
  if (!Number.isFinite(abertaMs)) return null;

  const dir = order.side === "buy" ? 1 : -1;
  const move = (preco - entry) * dir;

  if (move >= exigida) {
    const tick = Number(tickSize) > 0 ? Number(tickSize) : 1;
    const stopPts = Number(order.stop_pts ?? 0);
    const gainPts = Number(order.gain_pts ?? 0);
    return {
      confirmou: true,
      confirmou_em: new Date(agoraMs).toISOString(),
      preco_confirmacao: roundToTick(preco, tick),
      // Registro: onde stop e alvo ficariam com a entrada no preço confirmado.
      stop_recalculado: stopPts > 0 ? roundToTick(preco - dir * stopPts, tick) : null,
      alvo_recalculado: gainPts > 0 ? roundToTick(preco + dir * gainPts, tick) : null,
    };
  }

  const janela = Number(order.confirmacao_janela_s ?? CONFIRMACAO_PADRAO.janela_s);
  const decorridoS = (agoraMs - abertaMs) / 1000;
  if (Number.isFinite(janela) && janela > 0 && decorridoS > janela) {
    return { confirmou: false };
  }
  return null;
}

/** Rótulo curto da regra para a tela: "50% do stop em 3 min". */
export function confirmacaoRegraTexto(pctStop: number | null | undefined, janelaS: number | null | undefined): string {
  const pct = Number(pctStop);
  const jan = Number(janelaS);
  const p = Number.isFinite(pct) && pct > 0 ? pct : CONFIRMACAO_PADRAO.pct_stop;
  const s = Number.isFinite(jan) && jan > 0 ? jan : CONFIRMACAO_PADRAO.janela_s;
  const minutos = s / 60;
  const janelaTxt = Number.isInteger(minutos)
    ? `${minutos} min`
    : s < 60 ? `${Math.round(s)} s` : `${minutos.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} min`;
  return `${p.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}% do stop em ${janelaTxt}`;
}
