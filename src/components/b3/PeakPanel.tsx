import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copiarTexto } from "@/lib/b3-copiar";

// Display-only view of b3_pico_realizado_dia rows (no recalculation of results).
// "Por contrato" divides by the slice's contract ceiling so values stay comparable across sizing changes.
export type PeakRow = { trade_date: string; raiz: string; variant: string; pico_realizado_brl: number | null; fechamento_brl: number | null; devolveu_brl: number | null; hora_do_pico_brt: string | null; ordens: number | null };
const BRL = (v: number | null | undefined) => v == null || !Number.isFinite(Number(v)) ? "sem registro" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
export const perContract = (v: number | null | undefined, n: number | null) => v == null || !n ? null : Math.trunc(Number(v) / n);
const day = (d: string) => { const [, m, dd] = String(d).slice(0, 10).split("-"); return `${dd}/${m}`; };

export function peakLines(rows: PeakRow[], contracts: number | null) {
  return [...rows].sort((a, b) => b.trade_date.localeCompare(a.trade_date)).map((r) => {
    const pc = (v: number | null) => contracts ? ` · por contrato ${BRL(perContract(v, contracts))}` : " · por contrato sem registro";
    return `${day(r.trade_date)} — pico ${BRL(r.pico_realizado_brl)} às ${r.hora_do_pico_brt?.slice(0, 5) ?? "sem registro"}${pc(r.pico_realizado_brl)} | fechou ${BRL(r.fechamento_brl)}${pc(r.fechamento_brl)} | devolveu ${BRL(r.devolveu_brl)}${pc(r.devolveu_brl)} | ordens ${r.ordens ?? "sem registro"}`;
  });
}

export function PeakPanel({ title, rows, contracts, pending, error, note }: { title: string; rows: PeakRow[]; contracts: number | null; pending?: boolean; error?: boolean; note?: boolean }) {
  const sorted = [...rows].sort((a, b) => b.trade_date.localeCompare(a.trade_date));
  const divisor = contracts ? `÷ ${contracts} contratos (teto por robô do recorte)` : "teto de contratos sem registro";
  const text = `${title} — pico realizado (sem freio)\nPor contrato: ${divisor}\n${sorted.length ? peakLines(sorted, contracts).join("\n") : "sem registro"}`;
  const cell = (v: number | null) => <><span className="font-mono">{BRL(v)}</span><span className="block font-mono text-[11px] opacity-80">por contrato {contracts ? BRL(perContract(v, contracts)) : "sem registro"}</span></>;
  return (
    <section className="border-t border-border px-3 py-2 text-xs" data-peak-panel>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-bold">{title} — pico realizado <span className="font-normal opacity-80">(sem freio · por contrato {divisor})</span></h4>
        <Button variant="outline" className="min-h-11" onClick={() => copiarTexto(text)}><Copy className="mr-1 h-3 w-3" />Copiar pico</Button>
      </div>
      {pending ? <p>Carregando pico…</p> : error ? <p role="alert">Pico indisponível — sem registro.</p> : !sorted.length ? <p>sem registro</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-right">
            <thead><tr className="opacity-80"><th className="text-left">dia</th><th>pico realizado</th><th>hora</th><th>fechamento</th><th>devolveu do pico</th><th>ordens</th></tr></thead>
            <tbody>{sorted.map((r) => (
              <tr key={r.trade_date} className="border-t border-border/40 align-top">
                <td className="text-left">{day(r.trade_date)}</td><td>{cell(r.pico_realizado_brl)}</td>
                <td className="font-mono">{r.hora_do_pico_brt?.slice(0, 5) ?? "sem registro"}</td>
                <td>{cell(r.fechamento_brl)}</td><td>{cell(r.devolveu_brl)}</td><td className="font-mono">{r.ordens ?? "sem registro"}</td>
              </tr>))}</tbody>
          </table>
        </div>)}
      {note && <p className="mt-1 opacity-80">Nota: o pico de uma modalidade pode ser maior que o pico do ativo inteiro. Não é erro — o pico do ativo é o pico da soma das modalidades, e os picos individuais acontecem em horas diferentes.</p>}
    </section>
  );
}
