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

// ── REGRA LIGADA (23/09/2026, emenda) ────────────────────────────────────────
// Desligada (padrão de todos os robôs) nada muda: só medição, acima.
// LIGADA, para AQUELE robô, vale nos dois — simulado e real: o sinal não abre na
// hora; espera o preço andar a favor o percentual configurado do stop dentro da
// janela. Confirmou → abre no preço da confirmação (o comando real sai NESSE
// instante, junto). Não confirmou → a entrada é descartada e fica registrada.
// A regra decide SE abre; nunca fecha posição aberta. Não é freio.

/** Regra ligada para este robô? (percentual e janela precisam ser úteis) */
export function confirmacaoArmada(cfg: ConfirmacaoConfig): boolean {
  if (!cfg?.confirmacao_ativa) return false;
  const pct = Number(cfg.confirmacao_pct_stop ?? CONFIRMACAO_PADRAO.pct_stop);
  const jan = Number(cfg.confirmacao_janela_s ?? CONFIRMACAO_PADRAO.janela_s);
  return Number.isFinite(pct) && pct > 0 && Number.isFinite(jan) && jan > 0;
}

/** Sinal aguardando confirmação — o que fica gravado entre tiques. */
export type ConfirmacaoPendente = {
  side: string;
  preco_sinal: number;
  exigido_pts: number;
  janela_s: number;
  criado_em: string;
  stop_pts: number | null;
  gain_pts: number | null;
  melhor_pts: number;
};

export function criarPendente(args: {
  side: string;
  precoSinal: number;
  stopPtsFrozen: number;
  gainPtsFrozen: number;
  cfg: ConfirmacaoConfig;
  agoraMs?: number;
}): ConfirmacaoPendente | null {
  const exigido = confirmacaoExigidaPts(args.stopPtsFrozen, args.cfg?.confirmacao_pct_stop);
  const preco = Number(args.precoSinal);
  if (!(exigido > 0) || !Number.isFinite(preco) || preco <= 0) return null;
  const janRaw = Number(args.cfg?.confirmacao_janela_s);
  const janela = Number.isFinite(janRaw) && janRaw > 0 ? Math.round(janRaw) : CONFIRMACAO_PADRAO.janela_s;
  return {
    side: String(args.side),
    preco_sinal: preco,
    exigido_pts: exigido,
    janela_s: janela,
    criado_em: new Date(args.agoraMs ?? Date.now()).toISOString(),
    stop_pts: args.stopPtsFrozen > 0 ? args.stopPtsFrozen : null,
    gain_pts: args.gainPtsFrozen > 0 ? args.gainPtsFrozen : null,
    melhor_pts: 0,
  };
}

export type AvaliacaoPendente = {
  estado: "aguardando" | "confirmou" | "expirou" | "invalido";
  andou_pts: number;
  melhor_pts: number;
  exigido_pts: number;
  decorrido_s: number;
};

/** Onde o sinal em espera está agora. Não escreve nada; só julga. */
export function avaliarPendente(
  pend: any,
  precoAtual: number,
  agoraMs: number = Date.now(),
): AvaliacaoPendente {
  const vazio: AvaliacaoPendente = { estado: "invalido", andou_pts: 0, melhor_pts: 0, exigido_pts: 0, decorrido_s: 0 };
  if (!pend || typeof pend !== "object") return vazio;
  const exigido = Number(pend.exigido_pts);
  const sinal = Number(pend.preco_sinal);
  const preco = Number(precoAtual);
  const criadoMs = pend.criado_em ? new Date(pend.criado_em).getTime() : NaN;
  if (!(exigido > 0) || !(sinal > 0) || !Number.isFinite(criadoMs)) return vazio;

  const dir = pend.side === "buy" ? 1 : -1;
  const andou = Number.isFinite(preco) && preco > 0 ? (preco - sinal) * dir : 0;
  const melhor = Math.max(Number(pend.melhor_pts) || 0, andou);
  const decorrido = (agoraMs - criadoMs) / 1000;
  const janela = Number(pend.janela_s) > 0 ? Number(pend.janela_s) : CONFIRMACAO_PADRAO.janela_s;

  const base = { andou_pts: andou, melhor_pts: melhor, exigido_pts: exigido, decorrido_s: decorrido };
  if (andou >= exigido) return { estado: "confirmou", ...base };
  if (decorrido > janela) return { estado: "expirou", ...base };
  return { estado: "aguardando", ...base };
}

/** Motivo curto do descarte, para o log de decisão. */
export function motivoNaoConfirmou(pend: any, av: AvaliacaoPendente, pctStop: number | null | undefined): string {
  const pct = Number(pctStop);
  const p = Number.isFinite(pct) && pct > 0 ? pct : CONFIRMACAO_PADRAO.pct_stop;
  const andou = Math.round(av.melhor_pts);
  return `Preço andou ${andou} pts a favor; exigido ${Math.round(av.exigido_pts)} pts (${Math.round(p)}% do stop) em ${Math.round(Number(pend?.janela_s) || CONFIRMACAO_PADRAO.janela_s)}s. Entrada descartada.`;
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
