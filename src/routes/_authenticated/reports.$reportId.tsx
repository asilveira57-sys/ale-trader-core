import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getReport } from "@/lib/auto-trading.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";
import { z } from "zod";

export const Route = createFileRoute("/_authenticated/reports/$reportId")({
  head: () => ({ meta: [{ title: "Relatório | AleTrader AI" }] }),
  validateSearch: z.object({ kind: z.enum(["daily", "weekly"]).default("daily") }),
  component: ReportDetail,
});

function ReportDetail() {
  const { reportId } = Route.useParams();
  const { kind } = Route.useSearch();
  const fetchFn = useServerFn(getReport);
  const { data } = useQuery({ queryKey: ["report", reportId, kind], queryFn: () => fetchFn({ data: { id: reportId, kind } }) });

  if (!data) return <div className="p-8">Carregando…</div>;
  return (
    <div className="p-8 max-w-4xl mx-auto space-y-4 print:p-0">
      <div className="flex justify-between items-center print:hidden">
        <h1 className="text-2xl font-bold">Relatório {kind === "daily" ? "Diário" : "Semanal"}</h1>
        <Button variant="outline" onClick={() => window.print()}><Printer className="size-4 mr-1" />Imprimir / PDF</Button>
      </div>
      <Card>
        <CardHeader><CardTitle>{kind === "daily" ? data.report_date : `${data.week_start} → ${data.week_end}`}</CardTitle></CardHeader>
        <CardContent>
          <pre className="whitespace-pre-wrap text-sm font-sans">{data.content}</pre>
        </CardContent>
      </Card>
    </div>
  );
}
