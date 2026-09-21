// Formatação compartilhada entre o Cockpit e o painel por ativo.
// Somente apresentação — nada aqui participa do motor de simulação.

// Casas decimais derivadas do tick do ativo: tick 5 (WIN) = inteiro,
// tick 0,5 (WDO) = 1 casa, tick 0,01 (ações) = 2 casas.
export const decimalsForTick = (tick: number) => {
  const t = Number(tick);
  if (!Number.isFinite(t) || t <= 0) return 0;
  if (t >= 1) return 0;
  const s = t.toString();
  if (s.includes("e-")) return Math.min(4, Number(s.split("e-")[1]));
  return Math.min(4, (s.split(".")[1] ?? "").length);
};

// Lista única de ativos conhecidos pelas telas. Expandir aqui, não nas rotas.
export const B3_ASSETS = [
  "WIN", "WDO", "PETR4", "VALE3",
  "ITUB4", "BBDC4", "BBAS3",
  "BIT", "ETR", "SOL",
] as const;
export type B3Asset = (typeof B3_ASSETS)[number];

export const B3_ASSET_LABEL: Record<string, string> = {
  WIN: "Mini índice",
  WDO: "Mini dólar",
  PETR4: "Petrobras PN",
  VALE3: "Vale ON",
  ITUB4: "Itaú PN",
  BBDC4: "Bradesco PN",
  BBAS3: "Banco do Brasil ON",
  BIT: "Bitcoin futuro",
  ETR: "Ethereum futuro",
  SOL: "Solana futuro",
};

export const assetLabel = (symbol: string) =>
  B3_ASSET_LABEL[String(symbol ?? "").toUpperCase()] ?? String(symbol ?? "").toUpperCase();

// Contratos futuros (WINV26, WDOU26) rolam de vencimento; agrupa pela raiz do
// ativo pra que a virada de contrato não quebre o agrupamento da tela.
export const rootSymbol = (symbol: string) => {
  const s = String(symbol ?? "").toUpperCase();
  const m = s.match(/^([A-Z]{3})[A-Z]\d{2}$/);
  return m ? m[1] : s;
};

export const BRL = (v: number | null | undefined) =>
  Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const SIGNED_BRL = (v: number | null | undefined) =>
  `${Number(v ?? 0) > 0 ? "+" : ""}${BRL(v)}`;

export const PX = (v: number | null | undefined, tick: number) =>
  v == null
    ? "—"
    : Number(v).toLocaleString("pt-BR", {
        minimumFractionDigits: decimalsForTick(tick),
        maximumFractionDigits: decimalsForTick(tick),
      });

// Hora de entrada (BRT) e tempo em posição: "desde 14:40 (35 min)".
// Só apresentação — o tempo é medido contra o relógio local do navegador.
export const openSinceText = (entryTime: string | null | undefined, now: Date = new Date()) => {
  if (!entryTime) return "";
  const t = new Date(entryTime).getTime();
  if (!Number.isFinite(t)) return "";
  const hhmm = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit",
  }).format(new Date(t));
  const mins = Math.max(0, Math.round((now.getTime() - t) / 60000));
  const dur = mins >= 60
    ? `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, "0")}`
    : `${mins} min`;
  return `desde ${hhmm} (${dur})`;
};

// Rótulo curto de escala: 3600 -> "3,6k"
export const shortBRL = (v: number) => {
  const abs = Math.abs(v);
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  if (abs >= 1000) {
    const k = abs / 1000;
    return `${sign}${k.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k`;
  }
  return `${sign}${abs.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
};

// ── Medição do freio (livre × sombra) ─────────────────────────────────────
// Uma única fonte de texto para a tela e para o texto copiado: se o card muda,
// a cópia muda junto. A terceira linha NUNCA mostra número com sinal — a
// palavra ("pouparia", "custaria") carrega a direção.
export interface SombraDia {
  resultado_livre_brl: number;
  resultado_sombra_brl: number;
  ops_livre: number;
  ops_sombra: number;
  diferenca_brl: number;
  por_freio?: Record<string, SombraFreio>;
}

export const sombraLinhas = (s: SombraDia) => {
  const dif = Number(s.diferenca_brl ?? 0);
  const veredito =
    Math.round(dif * 100) === 0
      ? "Freio não agiu hoje"
      : dif > 0
        ? `Freio pouparia ${BRL(Math.abs(dif))}`
        : `Freio custaria ${BRL(Math.abs(dif))}`;
  return {
    operou: `${s.ops_livre} entradas · ${SIGNED_BRL(s.resultado_livre_brl)}`,
    comFreio: `${s.ops_sombra} entradas · ${SIGNED_BRL(s.resultado_sombra_brl)}`,
    veredito,
    // Cor só do veredito: verde quando o freio pouparia, vermelho quando custaria.
    tom: Math.round(dif * 100) === 0 ? "neutro" : dif > 0 ? "bom" : "ruim",
  } as const;
};

// ── Atribuição por freio (15/09/2026) ─────────────────────────────────────
// Com quatro freios em sombra, saber que "o freio teria barrado" não basta:
// é preciso saber QUAL, senão não dá para julgar um contra o outro.
export const FREIO_LABEL: Record<string, string> = {
  pico: "Freio de pico",
  pos_meta: "Pós-meta",
  stop_diario: "Stop diário",
  drawdown: "Drawdown máximo",
  grupo: "Freio de grupo",
  protecao_resultado: "Proteção de resultado",
};
// Ordem fixa na tela e na cópia: do mais frequente ao menos.
export const FREIO_ORDEM = ["pico", "pos_meta", "stop_diario", "drawdown", "protecao_resultado", "grupo"] as const;

export interface SombraFreio {
  resultado_sombra_brl: number;
  ops_sombra: number;
  ops_barradas: number;
  diferenca_brl: number;
}

export interface EfeitoFreioDia {
  freio: string;
  rotulo: string;
  no_acionamento_brl: number;
  fim_do_dia_brl: number;
  ops_barradas: number;
  ops_total: number;
  diferenca_brl: number;
  tom: "bom" | "ruim" | "neutro";
}

/** Valores crus da medição diária, sem inferência de estratégia. */
export const efeitosFreiosDia = (s: SombraDia | null | undefined): EfeitoFreioDia[] => {
  if (!s) return [];
  const p = s.por_freio ?? {};
  const chaves = [
    ...FREIO_ORDEM.filter((f) => p[f]),
    ...Object.keys(p).filter((f) => !(FREIO_ORDEM as readonly string[]).includes(f)),
  ];
  return chaves.flatMap((freio) => {
    const f = p[freio];
    if (!f || Number(f.ops_barradas ?? 0) <= 0) return [];
    const antes = Number(f.resultado_sombra_brl ?? 0);
    const fim = Number(s.resultado_livre_brl ?? 0);
    const diferenca = antes - fim;
    return [{
      freio,
      rotulo: FREIO_LABEL[freio] ?? freio,
      no_acionamento_brl: antes,
      fim_do_dia_brl: fim,
      ops_barradas: Number(f.ops_barradas ?? 0),
      ops_total: Number(s.ops_livre ?? 0),
      diferenca_brl: diferenca,
      tom: Math.round(diferenca * 100) === 0 ? "neutro" : diferenca > 0 ? "bom" : "ruim",
    } satisfies EfeitoFreioDia];
  });
};

/** Soma recortes de robôs/modalidades sem consultar nem gravar nada. */
export const somarSombrasDia = (sombras: Array<SombraDia | null | undefined>): SombraDia | null => {
  const validas = sombras.filter((s): s is SombraDia => Boolean(s));
  if (!validas.length) return null;
  const por_freio: Record<string, SombraFreio> = {};
  const freios = new Set(validas.flatMap((s) => Object.keys(s.por_freio ?? {})));
  for (const freio of freios) {
    const a: SombraFreio = { resultado_sombra_brl: 0, ops_sombra: 0, ops_barradas: 0, diferenca_brl: 0 };
    for (const s of validas) {
      const f = s.por_freio?.[freio];
      // Se o freio não acionou neste recorte, todas as entradas dele continuam
      // no cenário isolado daquele freio ao consolidar modalidade/ativo.
      a.resultado_sombra_brl += Number(f?.resultado_sombra_brl ?? s.resultado_livre_brl ?? 0);
      a.ops_sombra += Number(f?.ops_sombra ?? s.ops_livre ?? 0);
      a.ops_barradas += Number(f?.ops_barradas ?? 0);
    }
    por_freio[freio] = a;
  }
  const resultado_livre_brl = validas.reduce((n, s) => n + Number(s.resultado_livre_brl ?? 0), 0);
  for (const f of Object.values(por_freio)) f.diferenca_brl = f.resultado_sombra_brl - resultado_livre_brl;
  const resultado_sombra_brl = validas.reduce((n, s) => n + Number(s.resultado_sombra_brl ?? 0), 0);
  return {
    resultado_livre_brl,
    resultado_sombra_brl,
    ops_livre: validas.reduce((n, s) => n + Number(s.ops_livre ?? 0), 0),
    ops_sombra: validas.reduce((n, s) => n + Number(s.ops_sombra ?? 0), 0),
    diferenca_brl: resultado_sombra_brl - resultado_livre_brl,
    por_freio,
  };
};

export const efeitoVeredito = (diferenca: number) => {
  const d = Number(diferenca ?? 0);
  if (Math.round(d * 100) === 0) return "sem diferença no dia";
  return d > 0 ? `teria poupado ${BRL(Math.abs(d))}` : `teria custado ${BRL(Math.abs(d))}`;
};

/** Linha de um freio: "pouparia R$ X", "custaria R$ Y" ou "não agiu hoje". */
export const sombraFreioLinha = (freio: string, s: SombraFreio) => {
  const dif = Number(s.diferenca_brl ?? 0);
  const zero = Math.round(dif * 100) === 0;
  return {
    freio,
    rotulo: FREIO_LABEL[freio] ?? freio,
    agiu: Number(s.ops_barradas ?? 0) > 0,
    texto: zero
      ? "não agiu hoje"
      : dif > 0
        ? `pouparia ${BRL(Math.abs(dif))}`
        : `custaria ${BRL(Math.abs(dif))}`,
    tom: zero ? "neutro" : dif > 0 ? "bom" : "ruim",
  } as const;
};

/** Só os freios que efetivamente barraram alguma entrada hoje, em ordem fixa. */
export const sombraFreiosQueAgiram = (porFreio: Record<string, SombraFreio> | null | undefined) => {
  const p = porFreio ?? {};
  const chaves = [
    ...FREIO_ORDEM.filter((f) => p[f]),
    ...Object.keys(p).filter((f) => !(FREIO_ORDEM as readonly string[]).includes(f)),
  ];
  return chaves
    .map((f) => sombraFreioLinha(f, p[f] as SombraFreio))
    .filter((l) => l.agiu);
};

// ── Freios ACIONADOS agora, com horário (16/09/2026) ─────────────────────────
// Nenhum freio bloqueia entrada no simulado: o robô roda APESAR do freio. A
// tela precisa dizer quais estão acionados e desde quando — se três agem ao
// mesmo tempo, os três aparecem.
const hhmmBrt = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
};

export interface FreioAcionado { freio: string; desde: string | null }

/** "stop diário desde 10:11 · freio de pico desde 10:26 · grupo nível 4 desde 10:15" */
export const freiosAcionadosTexto = (
  freios: FreioAcionado[] | null | undefined,
  grupo?: { nivel?: number; travado?: boolean; desde?: string | null } | null,
) => {
  const partes = (freios ?? [])
    .filter((f) => f && f.freio)
    .sort((a, b) =>
      (FREIO_ORDEM as readonly string[]).indexOf(a.freio) - (FREIO_ORDEM as readonly string[]).indexOf(b.freio))
    .map((f) => `${FREIO_LABEL[f.freio] ?? f.freio} desde ${hhmmBrt(f.desde)}`);
  if (grupo?.travado && Number(grupo.nivel ?? 0) >= 2) {
    partes.push(`grupo nível ${Number(grupo.nivel)} desde ${hhmmBrt(grupo.desde ?? null)}`);
  }
  return partes.join(" · ");
};


