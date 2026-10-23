// Apresentação genérica da geometria gravada (entrada_geometria). Percorre
// TODAS as chaves do JSONB; nenhuma é escondida por falta de tradução.
export const GEO_PT: Record<string, string> = {
  position_in_range: "posição na faixa",
  range_size_pts: "tamanho da faixa (pts)",
  range_top: "topo da faixa",
  range_bottom: "fundo da faixa",
  trend_strength: "força da tendência",
  trend_direction: "direção da tendência",
  risk_reward: "risco-retorno",
  edge_pct: "borda (%)",
  perna_pts: "perna (pts)",
  perna_eficiencia: "eficiência da perna",
  recuo_fracao: "fração do recuo",
  manteve_origem_da_perna: "manteve a origem da perna",
  chosen_side: "lado escolhido",
  side_source: "origem do lado",
  lookback_candles: "velas olhadas",
  m1_candles: "velas de 1 min disponíveis",
  soft_failed: "critérios que não passaram",
};

const PRICE_KEY = /(_pts$|^range_top$|^range_bottom$|price|preco|_top$|_bottom$)/i;

export const geoLabel = (k: string) => (GEO_PT[k] ? `${GEO_PT[k]} (${k})` : k);

export function geoValue(k: string, v: unknown): string {
  if (v === null || v === undefined) return "sem registro";
  if (typeof v === "boolean") return v ? "sim" : "não";
  if (typeof v === "number") {
    const d = PRICE_KEY.test(k) ? 0 : 3;
    return v.toLocaleString("pt-BR", { maximumFractionDigits: d });
  }
  if (Array.isArray(v)) {
    if (!v.length) return "nenhum";
    if (k === "soft_failed") return v.map((x) => `não passou: ${String(x)}`).join("; ");
    return v.map((x) => (typeof x === "object" && x ? JSON.stringify(x) : String(x))).join("; ");
  }
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export interface GeoLinha { chave: string; rotulo: string; valor: string; destaque?: boolean }

/** Linhas de exibição, uma por chave; quórum soft agrupado numa linha só. */
export function geoLinhas(geo: Record<string, unknown> | null | undefined): GeoLinha[] | null {
  if (!geo || typeof geo !== "object") return null;
  const out: GeoLinha[] = [];
  const has = (k: string) => Object.prototype.hasOwnProperty.call(geo, k);
  const quorum = has("soft_hits") || has("soft_min_hits") || has("soft_total");
  if (quorum) {
    const h = geo.soft_hits, m = geo.soft_min_hits, t = geo.soft_total;
    const f = (x: unknown) => (x == null ? "sem registro" : String(x));
    out.push({
      chave: "soft_hits / soft_min_hits / soft_total",
      rotulo: "quórum (soft_hits / soft_min_hits / soft_total)",
      valor: `quórum ${f(h)} de ${f(t)}, mínimo ${f(m)}${h != null && m != null && h === m ? " — passou no limite exato" : ""}`,
      destaque: h != null && m != null && h === m,
    });
  }
  for (const [k, v] of Object.entries(geo)) {
    if (quorum && (k === "soft_hits" || k === "soft_min_hits" || k === "soft_total")) continue;
    out.push({ chave: k, rotulo: geoLabel(k), valor: geoValue(k, v) });
  }
  return out;
}
