import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { listCalibracao, aplicarCalibracao, desfazerCalibracao } from "@/lib/b3-calibracao.functions";
import { CalibracaoConfirm, MULT, type CalibLinha } from "@/components/b3/CalibracaoConfirm";
import { BRL } from "@/lib/b3-format";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/_authenticated/b3-calibracao")({
  head: () => ({
    meta: [
      { title: "Calibração do Stop Diário — AleTrader AI" },
      { name: "description", content: "Sugestões semanais de multiplicador do stop diário por robô, com aplicar e desfazer no simulado." },
      { property: "og:title", content: "Calibração do Stop Diário — AleTrader AI" },
      { property: "og:description", content: "Sugestões semanais do multiplicador do stop diário, aplicadas só com clique." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CalibracaoPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Erro: {String((error as any)?.message ?? error)}</div>,
});

function CalibracaoPage() {
  const qc = useQueryClient();
  const list = useServerFn(listCalibracao);
  const aplicar = useServerFn(aplicarCalibracao);
  const desfazer = useServerFn(desfazerCalibracao);
  const q = useQuery({ queryKey: ["b3-calibracao"], queryFn: () => list() });
  const [soConfiaveis, setSoConfiaveis] = useState(true);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [confirmar, setConfirmar] = useState<CalibLinha[] | null>(null);

  const linhas = (q.data?.linhas ?? []) as CalibLinha[];
  const vis = useMemo(() => linhas.filter((l) => !soConfiaveis || l.confiavel), [linhas, soConfiaveis]);
  const podeAplicar = (l: CalibLinha) => l.confiavel && l.tem_config && !l.aplicado;

  const apM = useMutation({
    mutationFn: (ids: string[]) => aplicar({ data: { ids } }),
    onSuccess: (r) => { toast.success(`${r.aplicados} aplicado(s)`); setSel(new Set()); setConfirmar(null); qc.invalidateQueries({ queryKey: ["b3-calibracao"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const dfM = useMutation({
    mutationFn: (id: string) => desfazer({ data: { id } }),
    onSuccess: () => { toast.success("Desfeito"); qc.invalidateQueries({ queryKey: ["b3-calibracao"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const selecionadas = linhas.filter((l) => sel.has(l.id) && podeAplicar(l));

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-2xl font-bold">Calibração do stop diário</h1>
        <p className="text-sm text-muted-foreground">
          Semana de {q.data?.semana ? new Date(q.data.semana + "T12:00:00").toLocaleDateString("pt-BR") : "—"} · aplica só no simulado · nada é aplicado sozinho.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm"><Switch checked={soConfiaveis} onCheckedChange={setSoConfiaveis} /> Só confiáveis</label>
        <Button disabled={!selecionadas.length} onClick={() => setConfirmar(selecionadas)}>
          Aplicar selecionadas ({selecionadas.length})
        </Button>
      </div>
      {q.isLoading ? <p>Carregando…</p> : (
        <div className="overflow-x-auto rounded border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="p-2"></th><th className="p-2">Ativo</th><th className="p-2">Modalidade</th><th className="p-2">Modo</th>
                <th className="p-2">Atual</th><th className="p-2">Sugerido</th><th className="p-2">Ganho estimado</th>
                <th className="p-2">Pregões</th><th className="p-2">Confiável</th><th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {vis.map((l) => (
                <tr key={l.id} className="border-t border-border align-top">
                  <td className="p-2">{podeAplicar(l) && (
                    <Checkbox checked={sel.has(l.id)} onCheckedChange={(v) => setSel((s) => { const n = new Set(s); v ? n.add(l.id) : n.delete(l.id); return n; })} />
                  )}</td>
                  <td className="p-2 font-semibold">{l.symbol.slice(0, 3)}</td>
                  <td className="p-2">{l.variant.replace(/_/g, " ")}</td>
                  <td className="p-2">{l.apelido ?? "—"} <span className="text-muted-foreground">({l.mode.replace(/_/g, " ")})</span></td>
                  <td className="p-2 font-mono">{MULT(l.mult_vigente ?? l.mult_atual)}</td>
                  <td className="p-2 font-mono font-bold">{MULT(l.mult_sugerido)}</td>
                  <td className={`p-2 font-mono ${Number(l.ganho_estimado) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{BRL(l.ganho_estimado)}</td>
                  <td className="p-2">{l.pregoes}</td>
                  <td className="p-2">{l.confiavel ? "Sim" : <span>Não <span className="block text-xs text-amber-300">{l.motivo}</span></span>}</td>
                  <td className="p-2">
                    {l.aplicado ? (
                      <div className="flex flex-col gap-1">
                        <span className="text-xs text-emerald-400">Aplicado {l.aplicado_em ? new Date(l.aplicado_em).toLocaleString("pt-BR") : ""}</span>
                        <Button size="sm" variant="outline" disabled={dfM.isPending} onClick={() => dfM.mutate(l.id)}>Desfazer</Button>
                      </div>
                    ) : podeAplicar(l) ? (
                      <Button size="sm" onClick={() => setConfirmar([l])}>Aplicar</Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <CalibracaoConfirm linhas={confirmar ?? []} open={!!confirmar} onOpenChange={(o) => !o && setConfirmar(null)}
        pending={apM.isPending} onConfirm={() => confirmar && apM.mutate(confirmar.map((l) => l.id))} />
    </div>
  );
}
