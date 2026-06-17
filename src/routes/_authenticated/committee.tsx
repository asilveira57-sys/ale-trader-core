import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCommitteeDashboard, runCommitteeAll } from "@/lib/atrader.functions";
import { generateDebate } from "@/lib/experts.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, TrendingUp, TrendingDown, Minus, Clock, ShieldAlert, MessagesSquare } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/committee")({
  head: () => ({ meta: [{ title: "Comitê — AleTrader AI" }] }),
  component: CommitteePage,
});

const DECISION_LABEL: Record<string, string> = {
  buy_approved: "Compra aprovada",
  sell_approved: "Venda aprovada",
  hold: "Manter",
  wait: "Aguardar",
  blocked: "Bloqueada",
};

function decisionBadge(d: string) {
  switch (d) {
    case "buy_approved":
      return <Badge className="bg-success text-success-foreground">{DECISION_LABEL[d]}</Badge>;
    case "sell_approved":
      return <Badge className="bg-destructive text-destructive-foreground">{DECISION_LABEL[d]}</Badge>;
    case "blocked":
      return <Badge variant="destructive">{DECISION_LABEL[d]}</Badge>;
    case "hold":
      return <Badge variant="secondary">{DECISION_LABEL[d]}</Badge>;
    default:
      return <Badge variant="outline">{DECISION_LABEL[d] ?? d}</Badge>;
  }
}

function classBadge(score: number) {
  if (score >= 91) return <Badge className="bg-success text-success-foreground">Crítica</Badge>;
  if (score >= 76) return <Badge className="bg-success/80 text-success-foreground">Forte</Badge>;
  if (score >= 61) return <Badge variant="secondary">Alerta moderado</Badge>;
  if (score >= 41) return <Badge variant="outline">Observar</Badge>;
  return <Badge variant="outline" className="opacity-60">Ignorar</Badge>;
}

function CommitteePage() {
  const qc = useQueryClient();
  const fetchDash = useServerFn(getCommitteeDashboard);
  const runAll = useServerFn(runCommitteeAll);

  const { data, isLoading } = useQuery({
    queryKey: ["committee"],
    queryFn: () => fetchDash({}),
    refetchInterval: 20000,
  });

  const mRun = useMutation({
    mutationFn: () => runAll({}),
    onSuccess: (r: any) => {
      toast.success(`Comitê executado em ${r.ok}/${r.total} ativos`);
      qc.invalidateQueries({ queryKey: ["committee"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const debateFn = useServerFn(generateDebate);
  const mDebate = useMutation({
    mutationFn: (id: string) => debateFn({ data: { decision_id: id } }),
    onSuccess: (r: any) => toast.success("Debate: " + (r.summary ?? "gerado")),
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading || !data) return <div className="p-8 text-muted-foreground">Carregando comitê…</div>;

  const totalDec = data.decisions.length;
  const approved = data.decisions.filter((d: any) => d.final_decision === "buy_approved" || d.final_decision === "sell_approved").length;
  const blocked = data.decisions.filter((d: any) => d.final_decision === "blocked").length;

  return (
    <div className="p-8 space-y-8 max-w-7xl">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Comitê de decisão</h1>
          <p className="text-sm text-muted-foreground">
            Cada execução roda 10 agentes votantes e gera uma decisão consolidada — <span className="text-foreground font-medium">somente simulação</span>.
          </p>
        </div>
        <Button onClick={() => mRun.mutate()} disabled={mRun.isPending}>
          <RefreshCw className={`size-4 mr-2 ${mRun.isPending ? "animate-spin" : ""}`} />
          Executar comitê em todos
        </Button>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="panel p-5">
          <p className="text-xs uppercase text-muted-foreground tracking-wider">Decisões 200 últimas</p>
          <p className="text-2xl font-semibold mt-2">{totalDec}</p>
        </div>
        <div className="panel p-5">
          <p className="text-xs uppercase text-muted-foreground tracking-wider">Aprovadas (simuladas)</p>
          <p className="text-2xl font-semibold mt-2 text-success">{approved}</p>
        </div>
        <div className="panel p-5">
          <p className="text-xs uppercase text-muted-foreground tracking-wider">Bloqueadas pelo risco</p>
          <p className="text-2xl font-semibold mt-2 text-destructive">{blocked}</p>
        </div>
        <div className="panel p-5">
          <p className="text-xs uppercase text-muted-foreground tracking-wider">Carteira simulada</p>
          <p className="text-2xl font-semibold mt-2 font-mono">
            ${Number(data.wallet?.current_balance ?? 0).toFixed(2)}
          </p>
        </div>
      </section>

      <section className="panel p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold">Ranking — melhores oportunidades simuladas</h2>
          <span className="text-xs text-muted-foreground">Última decisão por ativo</span>
        </div>
        <div className="divide-y divide-border">
          {data.ranking.length === 0 && (
            <p className="text-sm text-muted-foreground py-6">Nenhuma decisão ainda. Clique em "Executar comitê em todos".</p>
          )}
          {data.ranking.map((d: any) => (
            <div key={d.id} className="flex items-center justify-between py-3 gap-3">
              <div className="flex items-center gap-3">
                {d.final_decision === "buy_approved" ? <TrendingUp className="size-4 text-success" /> :
                 d.final_decision === "sell_approved" ? <TrendingDown className="size-4 text-destructive" /> :
                 d.final_decision === "blocked" ? <ShieldAlert className="size-4 text-destructive" /> :
                 <Minus className="size-4 text-muted-foreground" />}
                <div>
                  <p className="font-medium">{d.pair} <span className="text-xs text-muted-foreground">· {d.timeframe}</span></p>
                  <p className="text-xs text-muted-foreground line-clamp-1">{d.consolidated_justification}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="text-right">
                  <p className="font-mono text-sm">{Number(d.score).toFixed(0)}</p>
                  <p className="text-[10px] text-muted-foreground">score</p>
                </div>
                {classBadge(Number(d.score))}
                {decisionBadge(d.final_decision)}
                <Button size="sm" variant="ghost" onClick={() => mDebate.mutate(d.id)} disabled={mDebate.isPending} title="Gerar debate dos agentes">
                  <MessagesSquare className="size-4" />
                </Button>
                <Link to="/analysis/$assetId" params={{ assetId: d.asset_id }} className="text-xs text-primary hover:underline">
                  Detalhes →
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel p-5">
        <h2 className="text-sm font-semibold mb-4">Histórico de decisões</h2>
        <div className="text-xs">
          <table className="w-full">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border">
                <th className="text-left py-2">Hora</th>
                <th className="text-left">Ativo</th>
                <th className="text-left">Decisão</th>
                <th className="text-right">Score</th>
                <th className="text-right">Conf.</th>
                <th className="text-right">B/S/H/W</th>
                <th className="text-left pl-3">Vetos</th>
              </tr>
            </thead>
            <tbody>
              {data.decisions.slice(0, 50).map((d: any) => (
                <tr key={d.id} className="border-b border-border/40">
                  <td className="py-2 font-mono text-muted-foreground flex items-center gap-1"><Clock className="size-3" />{new Date(d.created_at).toLocaleTimeString()}</td>
                  <td>{d.pair}</td>
                  <td>{decisionBadge(d.final_decision)}</td>
                  <td className="text-right font-mono">{Number(d.score).toFixed(0)}</td>
                  <td className="text-right font-mono">{Number(d.avg_confidence).toFixed(0)}</td>
                  <td className="text-right font-mono text-muted-foreground">{d.votes_buy}/{d.votes_sell}/{d.votes_hold}/{d.votes_wait}</td>
                  <td className="pl-3">
                    {!d.risk_approved && <Badge variant="destructive" className="mr-1">Risco</Badge>}
                    {d.euphoria_vetoed && <Badge variant="secondary">Euforia</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
