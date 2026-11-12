import type { ThreeReading } from "@/lib/b3-three-readings";
const names: Record<string, string> = { range: "faixa", indicador: "indicador", price_action: "price action", price_action_sc: "price action SC", mean_reversion: "reversão à média", rompimento: "rompimento", pullback: "repique", vwap: "VWAP" };
export const variantName = (variant?: string | null) => names[variant ?? ""] ?? variant ?? "sem registro";
export function circuitLevel(row?: Pick<ThreeReading, "nivel" | "disjuntor_nivel" | "symbol" | "variant">) {
  const level = row?.disjuntor_nivel ?? row?.nivel;
  return level === "total" ? "total" : level === "ativo" ? `ativo ${row?.symbol ?? "sem registro"}` : `modalidade ${variantName(row?.variant)}`;
}
/** Rótulo do disjuntor (só apresentação). Desde 12/11/2026 existe um disjuntor por ATIVO: o total é a
 * soma dos ativos, e modalidade e robô mostram a sua parte no disjuntor do ativo (migration 0032). */
export function circuitLabel(row?: Pick<ThreeReading, "nivel" | "disjuntor_nivel" | "symbol" | "variant" | "disjuntor_atribuicao" | "disparos">) {
  if (!row) return "disjuntor: sem registro";
  const level = row.nivel === "robo" ? "robo" : row.disjuntor_nivel ?? row.nivel;
  if (level === "total") return `disjuntor: ${row.disjuntor_atribuicao ?? row.disparos?.[0]?.disparou ?? "soma dos disjuntores por ativo"}`;
  if (level === "modalidade") return `disjuntor: parcela da modalidade ${variantName(row.variant)} no disjuntor do ativo ${row.symbol ?? ""}`.trim();
  if (level === "robo") return `disjuntor: parcela do robô no disjuntor do ativo ${row.symbol ?? ""}`.trim();
  return `disjuntor calculado no nível: ${circuitLevel(row)}`;
}
const money = (n: number | null | undefined) => n == null ? "sem registro" : Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export function DisjuntorEvidence({ row, showValues = true }: { row?: ThreeReading; showValues?: boolean }) {
  if (!row) return null;
  const level = row.disjuntor_nivel ?? row.nivel;
  return <div className="space-y-2 text-xs text-foreground">
    <p>{circuitLabel(row)}</p>
    {row.disparos?.map(d => <div key={d.dia} className="border-t border-border py-2">
      {d.por_ativo?.length
        ? <p>{d.dia} · {d.disparou ?? row.disjuntor_atribuicao ?? "soma por ativo"}</p>
        : <p>{d.dia} · {d.motivo} · hora BRT: {d.hora?.slice(0, 5) ?? "sem registro"}</p>}
      {d.motivo === "não disparou" && <p>não armou — resultado idêntico ao com freio</p>}
      {d.por_ativo?.length ? <ul className="space-y-1" data-disjuntor-por-ativo>
        {d.por_ativo.filter(a => a.resultado_com_disjuntor_brl != null).map(a => <li key={a.symbol} className="grid grid-cols-[3.5rem_1fr_auto] gap-2">
          <span className="font-semibold">{a.symbol}</span>
          <span>{a.disparou === "não disparou" ? "não disparou" : `disparou: ${a.disparou}${a.hora_disparo_brt ? ` às ${a.hora_disparo_brt.slice(0, 5)}` : ""}`}</span>
          <span className="text-right font-mono">{money(a.resultado_com_disjuntor_brl)}</span>
        </li>)}
        {d.por_ativo.some(a => a.resultado_com_disjuntor_brl == null) && <li className="text-muted-foreground">sem ordens no dia: {d.por_ativo.filter(a => a.resultado_com_disjuntor_brl == null).map(a => a.symbol).join(", ")}</li>}
      </ul> : null}
      <p>Ordens evitadas: {d.ordens_evitadas ?? "sem registro"} · ordens no dia: {d.ordens_no_dia ?? "sem registro"}</p>
      {showValues && <div className="grid grid-cols-2 gap-2 font-mono"><span>Com freio, sem disjuntor<br />{money(d.resultado_sem_disjuntor_brl)}</span><span>Com freio + disjuntor<br />{money(d.resultado_com_disjuntor_brl)}</span></div>}
      <p>Efeito do disjuntor sobre o com freio: {money(d.diferenca_brl)}</p>
    </div>)}
  </div>;
}
