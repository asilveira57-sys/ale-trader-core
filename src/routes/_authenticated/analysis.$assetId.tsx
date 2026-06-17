import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getAssetAnalysis, runCommittee } from "@/lib/atrader.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, ShieldAlert, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/analysis/$assetId")({
  head: () => ({ meta: [{ title: "Análise — AleTrader AI" }] }),
  component: AnalysisPage,
});

const VOTE_COLOR: Record<string, string> = {
  buy: "bg-success/15 text-success border-success/30",
  sell: "bg-destructive/15 text-destructive border-destructive/30",
  hold: "bg-muted text-muted-foreground border-border",
  wait: "bg-muted/60 text-muted-foreground border-border",
};

function AnalysisPage() {
  const { assetId } = useParams({ from: "/_authenticated/analysis/$assetId" });
  const qc = useQueryClient();
  const fetchAnalysis = useServerFn(getAssetAnalysis);
  const run = useServerFn(runCommittee);

  const { data, isLoading } = useQuery({
    queryKey: ["analysis", assetId],
    queryFn: () => fetchAnalysis({ data: { asset_id: assetId } }),
    refetchInterval: 20000,
  });

  const mRun = useMutation({
    mutationFn: () => run({ data: { asset_id: assetId, timeframe: "1h" } }),
    onSuccess: () => {
      toast.success("Comitê executado");
      qc.invalidateQueries({ queryKey: ["analysis", assetId] });
      qc.invalidateQueries({ queryKey: ["committee"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading || !data) return <div className="p-8 text-muted-foreground">Carregando análise…</div>;

  const d = data.decision;
  const ctx = d?.context as any;

  return (
    <div className="p-8 space-y-6 max-w-7xl">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{data.asset.pair}</h1>
          <p className="text-sm text-muted-foreground">{data.asset.name}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-xs uppercase text-muted-foreground">Preço atual (mock)</p>
            <p className="text-2xl font-mono font-semibold">${Number(data.price).toFixed(2)}</p>
          </div>
          <Button onClick={() => mRun.mutate()} disabled={mRun.isPending}>
            <RefreshCw className={`size-4 mr-2 ${mRun.isPending ? "animate-spin" : ""}`} />
            Reanalisar
          </Button>
        </div>
      </header>

      {d ? (
        <section className="panel p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase text-muted-foreground">Decisão consolidada</p>
              <p className="text-xl font-semibold mt-1">{d.final_decision.replace("_", " ")}</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-2xl">{d.consolidated_justification}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-center">
              <div>
                <p className="text-3xl font-mono font-semibold">{Number(d.score).toFixed(0)}</p>
                <p className="text-xs text-muted-foreground">score</p>
              </div>
              <div>
                <p className="text-3xl font-mono font-semibold">{Number(d.avg_confidence).toFixed(0)}</p>
                <p className="text-xs text-muted-foreground">confiança</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-4 flex-wrap">
            <Badge variant="outline">B {d.votes_buy}</Badge>
            <Badge variant="outline">S {d.votes_sell}</Badge>
            <Badge variant="outline">H {d.votes_hold}</Badge>
            <Badge variant="outline">W {d.votes_wait}</Badge>
            {!d.risk_approved && <Badge variant="destructive"><ShieldAlert className="size-3 mr-1" />Risco vetou</Badge>}
            {d.euphoria_vetoed && <Badge variant="secondary"><AlertTriangle className="size-3 mr-1" />Euforia vetou</Badge>}
            <Badge variant="outline">{d.classification}</Badge>
          </div>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">Sem decisão ainda — clique em Reanalisar.</p>
      )}

      {ctx && (
        <section className="panel p-5">
          <h2 className="text-sm font-semibold mb-4">Indicadores</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
            {[
              ["RSI", ctx.rsi?.toFixed(1)],
              ["MACD", ctx.macd?.toFixed(3)],
              ["SMA curta", ctx.sma_short?.toFixed(2)],
              ["SMA longa", ctx.sma_long?.toFixed(2)],
              ["BB sup", ctx.bb_upper?.toFixed(2)],
              ["BB inf", ctx.bb_lower?.toFixed(2)],
              ["Suporte", ctx.support?.toFixed(2)],
              ["Resistência", ctx.resistance?.toFixed(2)],
              ["Volume 24h", (ctx.volume_24h ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 })],
              ["Vol. média", (ctx.avg_volume ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 })],
            ].map(([k, v]) => (
              <div key={k as string} className="border border-border rounded-md p-3">
                <p className="text-xs text-muted-foreground">{k}</p>
                <p className="font-mono mt-1">{v}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-sm font-semibold mb-3">Votos dos agentes</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {data.votes.map((v: any) => (
            <div key={v.id} className={`border rounded-lg p-4 ${VOTE_COLOR[v.vote] ?? ""}`}>
              <div className="flex items-center justify-between">
                <p className="font-medium">{v.agents?.name ?? "Agente"}</p>
                <Badge variant="outline" className="uppercase">{v.vote}</Badge>
              </div>
              <p className="text-xs mt-1 opacity-80">Confiança {Number(v.confidence).toFixed(0)} · risco {Number(v.perceived_risk).toFixed(0)}</p>
              <p className="text-sm mt-2">{v.justification}</p>
              {v.has_veto && (
                <p className="text-xs mt-2 font-medium flex items-center gap-1">
                  <ShieldAlert className="size-3" /> Veto: {v.veto_reason}
                </p>
              )}
            </div>
          ))}
          {!data.votes.length && <p className="text-sm text-muted-foreground">Sem votos ainda.</p>}
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="panel p-5">
          <h2 className="text-sm font-semibold mb-3">Ordens simuladas relacionadas</h2>
          <ul className="text-sm divide-y divide-border">
            {data.orders.map((o: any) => (
              <li key={o.id} className="py-2 flex items-center justify-between">
                <span>{o.side.toUpperCase()} · ${Number(o.entry_price).toFixed(2)} · qty {Number(o.quantity).toFixed(4)}</span>
                <Badge variant={o.status === "open" ? "default" : "secondary"}>{o.status}</Badge>
              </li>
            ))}
            {!data.orders.length && <p className="text-muted-foreground">Nenhuma.</p>}
          </ul>
        </div>
        <div className="panel p-5">
          <h2 className="text-sm font-semibold mb-3">Alertas</h2>
          <ul className="text-sm divide-y divide-border">
            {data.alerts.map((a: any) => (
              <li key={a.id} className="py-2">
                <p className="font-medium">{a.type}</p>
                <p className="text-xs text-muted-foreground">{a.message}</p>
              </li>
            ))}
            {!data.alerts.length && <p className="text-muted-foreground">Nenhum.</p>}
          </ul>
        </div>
      </section>
    </div>
  );
}
