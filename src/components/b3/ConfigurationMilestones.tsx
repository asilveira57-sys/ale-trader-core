import { createContext, useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Flag, Copy } from "lucide-react";
import { readMarcos } from "@/lib/b3-marcos.functions";
import { marcosNoRecorte, marcoCopy, type Marco } from "@/lib/b3-marcos";
import { copiarTexto } from "@/lib/b3-copiar";
import { Button } from "@/components/ui/button";
export const MilestoneContext = createContext<Marco[]>([]);
export function useMilestones() {
  const read = useServerFn(readMarcos);
  return useQuery({ queryKey: ["b3-marcos"], queryFn: () => read(), staleTime: Infinity, refetchOnWindowFocus: false });
}
export function MilestoneMark({ date, end = date, symbol, variant }: { date: string; end?: string; symbol?: string; variant?: string }) {
  const rows = marcosNoRecorte(useContext(MilestoneContext), date, end, symbol, variant);
  if (!rows.length) return null;
  return <span tabIndex={0} className="inline-flex min-h-11 min-w-11 items-center justify-center text-warning" title={rows.map(r => `${r.data}: ${r.titulo}`).join("\n")} aria-label={rows.map(r => r.titulo).join("; ")}><Flag className="size-4" /></span>;
}
export function MilestoneWarning({ start, end }: { start: string; end: string }) {
  const rows = marcosNoRecorte(useContext(MilestoneContext), start, end).filter(r => r.escopo === "global");
  if (!rows.length || start === end) return null;
  return <section className="border-y-2 border-warning bg-warning/10 p-3 text-foreground" role="alert">
    <p className="font-bold">Este período atravessa {rows.length} mudança(s) de configuração. Somar os dias pode comparar sistemas diferentes.</p>
    <ul className="mt-2 list-disc pl-5 text-sm">{rows.map(r => <li key={r.id}>{r.data} · {r.titulo} — {r.descricao}</li>)}</ul>
    <Button variant="outline" className="mt-2 min-h-11" onClick={() => copiarTexto(rows.map(marcoCopy).join("\n\n"))}><Copy className="size-4" />Copiar marcos do período</Button>
  </section>;
}