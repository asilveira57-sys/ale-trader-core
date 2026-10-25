import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { readDisjuntorScenarios } from "@/lib/b3-disjuntor-read.functions";
import { disjuntorBadgeText } from "@/lib/b3-disjuntor-view";
import { copiarTexto } from "@/lib/b3-copiar";
import { useVisibleRefetchInterval } from "@/hooks/use-visible-refetch-interval";

export function DisjuntorHypothesis({ day }: { day: string }) {
  const read = useServerFn(readDisjuntorScenarios);
  const interval = useVisibleRefetchInterval(45000);
  const q = useQuery({ queryKey: ["win-disjuntor-hipotese", day], queryFn: () => read({ data: { start: day, end: day, losses: [25], capital: null, variants: null } }), refetchInterval: interval });
  const text = q.isPending ? "Consultando disjuntor…" : q.isError ? "Disjuntor: leitura indisponível" : q.data?.rows.length === 0 ? "Disjuntor: sem ordens no dia" : disjuntorBadgeText(q.data?.rows[0]);
  return <div className="flex flex-wrap items-center gap-2 border-t border-current/20 px-3 py-2 text-xs">
    <span className="font-semibold">{text}</span><span className="text-muted-foreground">Somente exibição · WIN · 25%</span>
    <Button variant="ghost" className="min-h-11 min-w-11 ml-auto" aria-label="Copiar cenário do disjuntor" onClick={() => copiarTexto(`WIN — ${day}\n${text}\nSomente exibição, curva realizada por saída.\n${q.data?.rows[0]?.frase ?? "sem registro"}`)}><Copy className="size-4" /></Button>
  </div>;
}