import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { readDisjuntorScenarios } from "@/lib/b3-disjuntor-read.functions";
import { disjuntorBadgeText } from "@/lib/b3-disjuntor-view";
import { BRL } from "@/lib/b3-format";
import { copiarTexto } from "@/lib/b3-copiar";
import { variantName } from "./DisjuntorEvidence";
import { useVisibleRefetchInterval } from "@/hooks/use-visible-refetch-interval";

export function DisjuntorHypothesis({ day, variant, live = false }: { day: string; variant?: string; live?: boolean }) {
  const read = useServerFn(readDisjuntorScenarios);
  const interval = useVisibleRefetchInterval(45000);
  const q = useQuery({ queryKey: ["win-disjuntor-hipotese", day], queryFn: () => read({ data: { start: day, end: day, losses: [25], capital: null, variants: null } }), refetchInterval: live ? interval : false, staleTime: live ? 40000 : Infinity, refetchOnWindowFocus: false, refetchOnReconnect: false });
  const row = q.data?.rows.find(r => variant ? r.nivel === "modalidade" && r.variant === variant : r.nivel === "ativo");
  const text = q.isPending ? "Consultando disjuntor…" : q.isError ? "Disjuntor: leitura indisponível" : disjuntorBadgeText(row);
  return <div className="flex flex-wrap items-center gap-2 border-t border-current/20 px-3 py-2 text-xs">
    <span className="font-semibold">{text}</span><span className="text-muted-foreground">disjuntor calculado no nível: {variant ? `modalidade ${variantName(variant)}` : "ativo WIN"} · disjuntor do próprio nível</span>
    {row && <span>Sem disjuntor {BRL(row.resultado_sem_disjuntor_brl)} · com disjuntor {BRL(row.resultado_com_disjuntor_brl)} · diferença {BRL(row.diferenca_brl)} · {row.ordens_evitadas ?? "sem registro"} evitadas / {row.ordens_no_dia ?? "sem registro"} ordens</span>}
    <Button variant="ghost" className="min-h-11 min-w-11 ml-auto" aria-label="Copiar cenário do disjuntor" onClick={() => copiarTexto(`WIN — ${day} — ${variant ?? "ativo WIN"}\n${text}\nSomente exibição, curva realizada por saída.\n` + [row].map(r => r ? Object.entries(r).map(([k,v]) => `${k}: ${v ?? "sem registro"}`).join("\n") : "sem registro").join("\n\n"))}><Copy className="size-4" /></Button>
  </div>;
}