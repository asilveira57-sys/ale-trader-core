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
