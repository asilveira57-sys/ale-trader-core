import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listDailyReports, listWeeklyReports, generateDailyReportFn, generateWeeklyReportFn } from "@/lib/auto-trading.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileText } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({ meta: [{ title: "Relatórios | AleTrader AI" }] }),
  component: ReportsPage,
});

function ReportsPage() {
  const fetchD = useServerFn(listDailyReports);
  const fetchW = useServerFn(listWeeklyReports);
  const genD = useServerFn(generateDailyReportFn);
  const genW = useServerFn(generateWeeklyReportFn);
  const qc = useQueryClient();
  const { data: dailies } = useQuery({ queryKey: ["daily-reports"], queryFn: () => fetchD() });
  const { data: weeklies } = useQuery({ queryKey: ["weekly-reports"], queryFn: () => fetchW() });
  const today = new Date().toISOString().slice(0, 10);
  const [dDate, setDDate] = useState(today);
  const [wDate, setWDate] = useState(today);

  const mD = useMutation({ mutationFn: () => genD({ data: { date: dDate } }), onSuccess: () => { toast.success("Diário gerado"); qc.invalidateQueries({ queryKey: ["daily-reports"] }); }, onError: (e: any) => toast.error(e.message) });
  const mW = useMutation({ mutationFn: () => genW({ data: { week_start: wDate } }), onSuccess: () => { toast.success("Semanal gerado"); qc.invalidateQueries({ queryKey: ["weekly-reports"] }); }, onError: (e: any) => toast.error(e.message) });

  return (
    <div className="p-8 space-y-6 max-w-6xl">
      <header>
        <h1 className="text-3xl font-bold flex items-center gap-2"><FileText className="size-7 text-blue-400" /> Relatórios</h1>
      </header>

      <Card>
        <CardHeader><CardTitle>Diário</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2"><Input type="date" value={dDate} onChange={(e) => setDDate(e.target.value)} /><Button onClick={() => mD.mutate()}>Gerar</Button></div>
          <ul className="space-y-1 text-sm">
            {(dailies ?? []).map((r: any) => (
              <li key={r.id}><Link to="/reports/$reportId" params={{ reportId: r.id }} search={{ kind: "daily" }} className="hover:underline">{r.report_date} • {r.total_trades} trades • PnL {Number(r.net_pnl ?? 0).toFixed(2)}</Link></li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Semanal</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2"><Input type="date" value={wDate} onChange={(e) => setWDate(e.target.value)} /><Button onClick={() => mW.mutate()}>Gerar</Button></div>
          <ul className="space-y-1 text-sm">
            {(weeklies ?? []).map((r: any) => (
              <li key={r.id}><Link to="/reports/$reportId" params={{ reportId: r.id }} search={{ kind: "weekly" }} className="hover:underline">{r.week_start} → {r.week_end}</Link></li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
