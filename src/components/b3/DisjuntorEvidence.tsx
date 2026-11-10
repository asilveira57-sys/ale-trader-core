import type { ThreeReading } from "@/lib/b3-three-readings";
const names: Record<string, string> = { range: "faixa", indicador: "indicador", price_action: "price action", price_action_sc: "price action SC", mean_reversion: "reversão à média", rompimento: "rompimento", pullback: "repique", vwap: "VWAP" };
export function circuitLevel(row?: Pick<ThreeReading, "nivel" | "disjuntor_nivel" | "symbol" | "variant">) {
  const level = row?.disjuntor_nivel ?? row?.nivel;
  return level === "total" ? "total" : level === "ativo" ? `ativo ${row?.symbol ?? "sem registro"}` : `modalidade ${names[row?.variant ?? ""] ?? row?.variant ?? "sem registro"}`;
}
const money = (n: number | null | undefined) => n == null ? "sem registro" : Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export function DisjuntorEvidence({ row }: { row?: ThreeReading }) {
  if (!row) return null;
  return <div className="space-y-2 text-xs text-foreground">
    <p>disjuntor calculado no nível: {circuitLevel(row)}</p>
    {row.disjuntor_atribuicao && <p>{row.disjuntor_atribuicao}</p>}
    {row.disparos?.map(d => <div key={d.dia} className="border-t border-border py-2">
      <p>{d.dia} · {d.motivo} · hora BRT: {d.hora?.slice(0, 5) ?? "sem registro"}</p>
      {d.motivo === "não disparou" && <p>não armou — resultado idêntico ao com freio</p>}
      <p>Ordens evitadas: {d.ordens_evitadas ?? "sem registro"} · ordens no dia: {d.ordens_no_dia ?? "sem registro"}</p>
      <div className="grid grid-cols-2 gap-2 font-mono"><span>Sem disjuntor<br />{money(d.resultado_sem_disjuntor_brl)}</span><span>Com disjuntor<br />{money(d.resultado_com_disjuntor_brl)}</span></div>
      <p>Diferença: {money(d.diferenca_brl)}</p>
    </div>)}
  </div>;
}