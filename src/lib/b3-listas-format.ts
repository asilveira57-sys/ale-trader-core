// Apresentação das listas em tabela (CSV, rótulos, impressão).
// Só formatação — nada aqui participa do motor.

export const LISTA_VARIANT_LABEL: Record<string, string> = {
  indicador: "Indicador",
  price_action: "Price action",
  mean_reversion: "Reversão à média",
  range: "Faixa",
  rompimento: "Rompimento",
  pullback: "Repique",
  vwap: "VWAP",
};

export const LISTA_MODE_LABEL: Record<string, string> = {
  conservador: "Conservador",
  cauteloso: "Cauteloso",
  moderado: "Moderado",
  equilibrado: "Equilibrado",
  semi_agressivo: "Semi agressivo",
  arrojado: "Arrojado",
  agressivo: "Agressivo",
};

export const vLabel = (v?: string | null) => (v ? (LISTA_VARIANT_LABEL[v] ?? v) : "—");
export const mLabel = (m?: string | null) => (m ? (LISTA_MODE_LABEL[m] ?? String(m).replace("_", " ")) : "—");

const csvCell = (v: unknown) => {
  if (v == null) return "";
  const s = typeof v === "number" ? String(v).replace(".", ",") : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// Ponto e vírgula: é o separador que o Excel em português abre sem perguntar.
export function downloadCsv(filename: string, header: string[], rows: unknown[][]) {
  const body = [header, ...rows].map((r) => r.map(csvCell).join(";")).join("\r\n");
  const blob = new Blob(["\uFEFF" + body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// PDF pela impressão do navegador: mantém a tabela inteira e sai igual ao que
// está na tela, sem duplicar o layout numa segunda implementação.
export const printPage = () => window.print();

export const dm = (d?: string | null) => (d ? d.slice(8, 10) + "/" + d.slice(5, 7) : "—");

export const hm = (iso?: string | null) =>
  iso
    ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(new Date(iso))
    : "—";

export const todayBrt = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

export const daysAgoBrt = (n: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(Date.now() - n * 86_400_000));
