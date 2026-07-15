import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { getB3EntryAuditReport } from "@/lib/b3-simulation.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/b3-auditoria")({
  head: () => ({ meta: [{ title: "Auditoria de Entradas B3 — Diagnóstico" }, { name: "description", content: "Funil de decisão, motivos agrupados e comparador dos 5 robôs B3 (somente leitura)." }] }),
  component: Page,
});

const MODE_LABEL: Record<string, string> = {
  conservador: "Conservador", moderado: "Moderado", equilibrado: "Equilibrado",
  semi_agressivo: "Semi-agressivo", agressivo: "Agressivo",
};
const CAT_COLOR: Record<string, string> = {
  tecnico: "bg-red-500/15 text-red-400 border-red-500/30",
  operacional: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  estrategico: "bg-sky-500/15 text-sky-400 border-sky-500/30",
};

function fmt(v: any, dec = 2) {
  if (v == null || Number.isNaN(v)) return "—";
  if (typeof v === "number") return v.toLocaleString("pt-BR", { maximumFractionDigits: dec });
  return String(v);
}
function fmtTime(v: string | null | undefined) {
  return v ? new Date(v).toLocaleString("pt-BR") : "—";
}

function Page() {
  const fetchFn = useServerFn(getB3EntryAuditReport);
  const [hours, setHours] = useState(24);
  const [modeFilter, setModeFilter] = useState<string>("all");
  const [catFilter, setCatFilter] = useState<string>("all");

  const q = useQuery({
    queryKey: ["b3-entry-audit", hours],
    queryFn: () => fetchFn({ data: { hours } }),
    refetchInterval: 15000,
  });
  const data = q.data as any;

  if (!data) return <div className="p-6 text-sm text-muted-foreground">Carregando auditoria…</div>;
  if (!data.run) return <div className="p-6 text-sm text-muted-foreground">Nenhuma simulação encontrada no período. Inicie uma simulação B3 primeiro.</div>;

  const modes = data.modes ?? [];
  const reasons = (data.reasons ?? [])
    .filter((r: any) => modeFilter === "all" || r.mode === modeFilter)
    .filter((r: any) => catFilter === "all" || r.category === catFilter);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Auditoria de Entradas — B3 Day Trade</h1>
          <p className="text-xs text-muted-foreground">
            Snapshots analisados: {data.totals?.snapshots_scanned ?? 0} · Período: últimas {data.period?.hours}h · Última leitura: {fmtTime(data.period?.until)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(hours)} onValueChange={(v) => setHours(Number(v))}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="6">Últimas 6h</SelectItem>
              <SelectItem value="12">Últimas 12h</SelectItem>
              <SelectItem value="24">Últimas 24h</SelectItem>
              <SelectItem value="72">Últimos 3 dias</SelectItem>
              <SelectItem value="168">Últimos 7 dias</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={() => q.refetch()}>Atualizar</Button>
        </div>
      </div>

      {Array.isArray(data.config_mismatches) && data.config_mismatches.length > 0 && (
        <Card className="border-amber-500/40">
          <CardHeader className="pb-2"><CardTitle className="text-base text-amber-400">Divergências tela × motor detectadas</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground border-b border-border/40"><tr className="text-left"><th className="py-1 pr-2">Robô</th><th className="py-1 pr-2">Campo</th><th className="py-1 pr-2">Tela</th><th className="py-1 pr-2">Motor</th></tr></thead>
                <tbody>
                  {data.config_mismatches.map((m: any, i: number) => (
                    <tr key={i} className="border-b border-border/20"><td className="py-1 pr-2">{MODE_LABEL[m.mode] ?? m.mode}</td><td className="py-1 pr-2 font-mono">{m.field}</td><td className="py-1 pr-2">{fmt(m.screen)}</td><td className="py-1 pr-2 text-amber-400">{fmt(m.motor)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="funnel">
        <TabsList>
          <TabsTrigger value="funnel">Funil por robô</TabsTrigger>
          <TabsTrigger value="reasons">Motivos agrupados</TabsTrigger>
          <TabsTrigger value="compare">Comparador</TabsTrigger>
        </TabsList>

        <TabsContent value="funnel" className="space-y-3 mt-3">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {modes.map((m: any) => (
              <Card key={m.mode}>
                <CardHeader className="pb-2 flex-row items-center justify-between">
                  <CardTitle className="text-base">{MODE_LABEL[m.mode]}</CardTitle>
                  <Badge variant={m.entradas_executadas > 0 ? "default" : "outline"}>{m.entradas_executadas} ordens</Badge>
                </CardHeader>
                <CardContent className="space-y-1 text-xs">
                  <FunnelRow label="Ciclos avaliados" v={m.ciclos} />
                  <FunnelRow label="Ticks válidos" v={m.ticks_validos} />
                  <FunnelRow label="Sinais brutos" v={m.sinais_brutos} />
                  <FunnelRow label="Passaram nos filtros" v={m.filtrados_ok} />
                  <FunnelRow label="Enviados ao comitê" v={m.enviados_comite} />
                  <FunnelRow label="Aprovados pelo comitê" v={m.aprovados_comite} accent="pos" />
                  <FunnelRow label="Rejeitados pelo comitê" v={m.rejeitados_comite} accent="neg" />
                  <FunnelRow label="Entradas executadas" v={m.entradas_executadas} accent="pos" />
                  <div className="border-t border-border/40 my-2" />
                  <FunnelRow label="Bloqueios técnicos" v={m.bloqueios_tecnicos} accent="neg" />
                  <FunnelRow label="Bloqueios operacionais" v={m.bloqueios_operacionais} accent="neg" />
                  <FunnelRow label="Rejeições estratégicas" v={m.rejeicoes_estrategicas} accent="neg" />
                  <div className="border-t border-border/40 my-2" />
                  <FunnelRow label="Resultado líquido (R$)" v={m.resultado_liquido_brl} accent={m.resultado_liquido_brl >= 0 ? "pos" : "neg"} />
                  <div className="pt-2 grid grid-cols-2 gap-1 text-[10px] text-muted-foreground">
                    <span>Geração sinal: {m.taxa_geracao_sinal}%</span>
                    <span>Aprov. filtros: {m.taxa_aprov_filtros}%</span>
                    <span>Aprov. comitê: {m.taxa_aprov_comite}%</span>
                    <span>Execução: {m.taxa_execucao}%</span>
                    <span className="col-span-2">Conversão final (ordens/sinais): <b>{m.conversao_final}%</b></span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="reasons" className="space-y-3 mt-3">
          <Card>
            <CardHeader className="pb-2 flex-row items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-base">Principais motivos de poucas entradas</CardTitle>
              <div className="flex gap-2">
                <Select value={modeFilter} onValueChange={setModeFilter}>
                  <SelectTrigger className="w-[160px]"><SelectValue placeholder="Robô" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os robôs</SelectItem>
                    {Object.entries(MODE_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={catFilter} onValueChange={setCatFilter}>
                  <SelectTrigger className="w-[180px]"><SelectValue placeholder="Categoria" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas categorias</SelectItem>
                    <SelectItem value="tecnico">Técnico</SelectItem>
                    <SelectItem value="operacional">Operacional</SelectItem>
                    <SelectItem value="estrategico">Estratégico</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {reasons.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhum bloqueio no período/filtros selecionados.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-muted-foreground border-b border-border/40">
                      <tr className="text-left">
                        <th className="py-1 pr-2">#</th>
                        <th className="py-1 pr-2">Robô</th>
                        <th className="py-1 pr-2">Categoria</th>
                        <th className="py-1 pr-2">Motivo (etapa)</th>
                        <th className="py-1 pr-2 text-right">Ocorrências</th>
                        <th className="py-1 pr-2 text-right">Repetições</th>
                        <th className="py-1 pr-2 text-right">% ciclos</th>
                        <th className="py-1 pr-2 text-right">Observado</th>
                        <th className="py-1 pr-2 text-right">Limite</th>
                        <th className="py-1 pr-2 text-right">Distância</th>
                        <th className="py-1 pr-2">Última</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reasons.map((r: any, i: number) => (
                        <tr key={i} className="border-b border-border/20 align-top">
                          <td className="py-1 pr-2 text-muted-foreground">{i + 1}</td>
                          <td className="py-1 pr-2">{MODE_LABEL[r.mode] ?? r.mode}</td>
                          <td className="py-1 pr-2"><Badge variant="outline" className={`text-[10px] ${CAT_COLOR[r.category] ?? ""}`}>{r.category_label}</Badge></td>
                          <td className="py-1 pr-2">
                            <div className="font-medium">{r.label}</div>
                            <div className="text-[10px] text-muted-foreground max-w-[280px] truncate" title={r.last_detail}>{r.last_detail}</div>
                          </td>
                          <td className="py-1 pr-2 text-right font-mono">{r.occurrences}</td>
                          <td className="py-1 pr-2 text-right font-mono">{r.repetitions}</td>
                          <td className="py-1 pr-2 text-right font-mono">{r.pct_of_cycles}%</td>
                          <td className="py-1 pr-2 text-right font-mono">{fmt(r.avg_observed)}</td>
                          <td className="py-1 pr-2 text-right font-mono">{fmt(r.avg_limit)}</td>
                          <td className={`py-1 pr-2 text-right font-mono ${r.avg_distance != null && r.avg_distance < 0 ? "text-red-400" : ""}`}>{fmt(r.avg_distance)}</td>
                          <td className="py-1 pr-2 text-[10px]">{fmtTime(r.last_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-[10px] text-muted-foreground mt-2">
                <b>Ocorrências</b> = incidentes independentes (nova mudança de estado). <b>Repetições</b> = quantas vezes o motor reavaliou a mesma condição sem mudança relevante. Um MT5 desconectado por 60min gera 1 ocorrência, N repetições.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="compare" className="mt-3">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Comparador entre os 5 robôs</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground border-b border-border/40">
                    <tr className="text-left">
                      <th className="py-1 pr-2">Indicador</th>
                      {modes.map((m: any) => <th key={m.mode} className="py-1 pr-2 text-right">{MODE_LABEL[m.mode]}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ["Ciclos avaliados", "ciclos"],
                      ["Ticks válidos", "ticks_validos"],
                      ["Sinais brutos", "sinais_brutos"],
                      ["Enviados ao comitê", "enviados_comite"],
                      ["Aprovados pelo comitê", "aprovados_comite"],
                      ["Rejeitados pelo comitê", "rejeitados_comite"],
                      ["Bloqueios técnicos", "bloqueios_tecnicos"],
                      ["Bloqueios operacionais", "bloqueios_operacionais"],
                      ["Rejeições estratégicas", "rejeicoes_estrategicas"],
                      ["Entradas executadas", "entradas_executadas"],
                      ["Resultado líquido (R$)", "resultado_liquido_brl"],
                      ["Taxa geração sinal (%)", "taxa_geracao_sinal"],
                      ["Taxa aprov. filtros (%)", "taxa_aprov_filtros"],
                      ["Taxa aprov. comitê (%)", "taxa_aprov_comite"],
                      ["Taxa execução (%)", "taxa_execucao"],
                      ["Conversão final (%)", "conversao_final"],
                    ].map(([label, key]) => (
                      <tr key={key} className="border-b border-border/20">
                        <td className="py-1 pr-2 text-muted-foreground">{label}</td>
                        {modes.map((m: any) => <td key={m.mode} className="py-1 pr-2 text-right font-mono">{fmt(m[key as string])}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function FunnelRow({ label, v, accent }: { label: string; v: number; accent?: "pos" | "neg" }) {
  const cls = accent === "pos" ? "text-emerald-400" : accent === "neg" ? "text-red-400" : "";
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono ${cls}`}>{fmt(v)}</span>
    </div>
  );
}
