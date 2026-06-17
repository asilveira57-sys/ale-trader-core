import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { listRecommendations } from "@/lib/intelligence.functions";
import { listAgentRankings } from "@/lib/intelligence.functions";
import { listRadar } from "@/lib/intelligence.functions";
import { listSeasonal } from "@/lib/intelligence.functions";
import { Card } from "@/components/ui/card";
import { Brain, Lightbulb, Radar, Trophy, FlaskConical, BookMarked, Calendar, Database } from "lucide-react";

export const Route = createFileRoute("/_authenticated/intelligence")({ component: IntelligenceHub });

function IntelligenceHub() {
  const recs = useQuery({ queryKey: ["recs", "pending"], queryFn: () => listRecommendations({ data: { status: "pending" } }) });
  const ranks = useQuery({ queryKey: ["ranks", "30d"], queryFn: () => listAgentRankings({ data: { period: "30d" } }) });
  const radar = useQuery({ queryKey: ["radar"], queryFn: () => listRadar() });
  const seasonal = useQuery({ queryKey: ["seasonal"], queryFn: () => listSeasonal() });

  const tiles: Array<{ to: string; label: string; desc: string; icon: any }> = [
    { to: "/recommendations", label: "Recomendações", desc: "Fila de melhorias sugeridas", icon: Lightbulb },
    { to: "/strategic-memory", label: "Memória Estratégica", desc: "Busca semântica no histórico", icon: Database },
    { to: "/strategy-lab", label: "Laboratório", desc: "Experimentação de estratégias", icon: FlaskConical },
    { to: "/regimes", label: "Regimes de Mercado", desc: "Detector de cenário", icon: Brain },
    { to: "/radar", label: "Radar de Oportunidades", desc: "Ativos promissores e perigosos", icon: Radar },
    { to: "/seasons", label: "Temporadas", desc: "Performance 30/90/180/365 dias", icon: Calendar },
    { to: "/agent-rankings", label: "Conselho Evolutivo", desc: "Ranking de agentes", icon: Trophy },
    { to: "/knowledge", label: "Centro de Conhecimento", desc: "Vídeos, livros, PDFs, artigos", icon: BookMarked },
  ];

  return (
    <div className="p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Centro de Inteligência Estratégica</h1>
        <p className="text-sm text-muted-foreground">Aprende, propõe e evolui — sem alterar limites de risco sem aprovação.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Stat title="Recomendações pendentes" value={recs.data?.length ?? 0} />
        <Stat title="Agentes ranqueados (30d)" value={ranks.data?.length ?? 0} />
        <Stat title="Sinais no radar" value={radar.data?.length ?? 0} />
        <Stat title="Snapshots de temporada" value={seasonal.data?.length ?? 0} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {tiles.map((t) => (
          <Link key={t.to} to={t.to as any} className="block">
            <Card className="p-4 hover:bg-accent/50 transition-colors h-full">
              <div className="flex items-center gap-2 mb-1">
                <t.icon className="size-4 text-primary" />
                <h2 className="font-medium">{t.label}</h2>
              </div>
              <p className="text-xs text-muted-foreground">{t.desc}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Stat({ title, value }: { title: string; value: number | string }) {
  return (
    <Card className="p-4">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{title}</p>
      <p className="text-2xl font-semibold mt-1">{value}</p>
    </Card>
  );
}
