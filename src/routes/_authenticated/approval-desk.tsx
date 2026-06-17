import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { getApprovalDeskState, approveRealRequest, rejectRealRequest, pauseRealRobot, resumeRealRobot, createDemoRequest } from "@/lib/real-trading.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle2, XCircle, AlertTriangle, ShieldAlert } from "lucide-react";

export const Route = createFileRoute("/_authenticated/approval-desk")({
  head: () => ({ meta: [{ title: "Mesa de Aprovação — AleTrader AI" }] }),
  component: ApprovalDeskPage,
});

function ApprovalDeskPage() {
  const qc = useQueryClient();
  const getState = useServerFn(getApprovalDeskState);
  const approveFn = useServerFn(approveRealRequest);
  const rejectFn = useServerFn(rejectRealRequest);
  const pauseFn = useServerFn(pauseRealRobot);
  const resumeFn = useServerFn(resumeRealRobot);
  const demoFn = useServerFn(createDemoRequest);
  const [confirms, setConfirms] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  const { data, isLoading } = useQuery({ queryKey: ["approval-desk"], queryFn: () => getState({}), refetchInterval: 10000 });

  const approve = useMutation({
    mutationFn: (id: string) => approveFn({ data: { id, confirm: "CONFIRMO" as const } }),
    onSuccess: () => { toast.success("Ordem aprovada e enviada"); qc.invalidateQueries({ queryKey: ["approval-desk"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const reject = useMutation({
    mutationFn: (id: string) => rejectFn({ data: { id, note: notes[id] ?? "" } }),
    onSuccess: () => { toast.success("Rejeitada"); qc.invalidateQueries({ queryKey: ["approval-desk"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const pause = useMutation({ mutationFn: () => pauseFn({}), onSuccess: () => { toast.success("Robô pausado"); qc.invalidateQueries({ queryKey: ["approval-desk"] }); } });
  const resume = useMutation({ mutationFn: () => resumeFn({}), onSuccess: () => { toast.success("Robô retomado"); qc.invalidateQueries({ queryKey: ["approval-desk"] }); } });
  const demo = useMutation({
    mutationFn: () => demoFn({ data: { pair: "BTCUSDT", side: "buy" as const, qty: 0.001, price: 65000, stop: 63000, take: 68000, score: 75 } }),
    onSuccess: () => { toast.success("Pedido demo criado"); qc.invalidateQueries({ queryKey: ["approval-desk"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading || !data) return <div className="p-8 text-muted-foreground">Carregando mesa de aprovação…</div>;

  const cl = data.checklist;
  const paused = data.settings?.real_robot_paused;

  return (
    <div className="p-8 space-y-6 max-w-6xl">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <ShieldAlert className="size-6 text-orange-500" /> Mesa de Aprovação
          </h1>
          <p className="text-sm text-muted-foreground">Nenhuma ordem real é enviada sem sua confirmação explícita.</p>
        </div>
        <div className="flex gap-2">
          {paused
            ? <Button variant="outline" onClick={() => resume.mutate()}>Retomar robô</Button>
            : <Button variant="destructive" onClick={() => pause.mutate()}>Pausar robô</Button>}
          <Button variant="ghost" size="sm" onClick={() => demo.mutate()}>+ Pedido demo</Button>
        </div>
      </header>

      {data.circuit_breaker && (
        <div className="panel p-4 border-red-500/40 bg-red-500/10 text-red-200 flex items-center gap-2">
          <AlertTriangle className="size-5" /> Circuit Breaker REAL ativo: {data.circuit_breaker.message}
        </div>
      )}

      <section className="panel p-5">
        <h2 className="text-sm font-medium mb-3">Checklist de segurança</h2>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {cl.items.map((i: any) => (
            <li key={i.key} className="flex items-start gap-2 text-sm">
              {i.ok ? <CheckCircle2 className="size-4 text-emerald-500 mt-0.5" /> : <XCircle className="size-4 text-red-500 mt-0.5" />}
              <span>{i.label}{i.detail && <span className="block text-xs text-muted-foreground">{i.detail}</span>}</span>
            </li>
          ))}
        </ul>
        {!cl.passed && <p className="mt-3 text-xs text-orange-400">Aprovação bloqueada até todos os itens passarem.</p>}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Pendentes ({data.pending.length})</h2>
        {data.pending.length === 0 && <p className="text-sm text-muted-foreground">Nenhum pedido aguardando aprovação.</p>}
        {data.pending.map((r: any) => (
          <article key={r.id} className="panel p-5 space-y-3">
            <header className="flex justify-between items-start">
              <div>
                <h3 className="text-base font-medium">{r.pair} — <span className={r.side === "buy" ? "text-emerald-400" : "text-red-400"}>{r.side.toUpperCase()}</span></h3>
                <p className="text-xs text-muted-foreground">Score {Number(r.score).toFixed(0)} • Risco ${Number(r.risk_amount).toFixed(2)} • Pior caso ${Number(r.worst_case ?? 0).toFixed(2)}</p>
              </div>
              <Link to="/audit" className="text-xs text-muted-foreground hover:underline">Auditorias →</Link>
            </header>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
              <Field label="Qtd" value={Number(r.suggested_qty).toFixed(6)} />
              <Field label="Preço" value={Number(r.suggested_price).toFixed(2)} />
              <Field label="Stop" value={Number(r.stop_loss).toFixed(2)} />
              <Field label="Alvo" value={Number(r.take_profit).toFixed(2)} />
              <Field label="Esperado" value={`$${Number(r.expected_result ?? 0).toFixed(2)}`} />
            </div>
            <div className="grid grid-cols-3 gap-3 text-xs text-muted-foreground">
              <span>✅ {r.votes_for} favoráveis</span>
              <span>❌ {r.votes_against} contrários</span>
              <span>🚫 {(r.vetoes ?? []).length} vetos</span>
            </div>
            {r.justification && <p className="text-sm bg-muted/30 rounded p-3">{r.justification}</p>}

            <div className="flex flex-wrap items-end gap-3 pt-2 border-t border-border">
              <div className="flex-1 min-w-[200px]">
                <Label className="text-xs">Digite CONFIRMO para aprovar</Label>
                <Input value={confirms[r.id] ?? ""} onChange={(e) => setConfirms({ ...confirms, [r.id]: e.target.value })} placeholder="CONFIRMO" />
              </div>
              <div className="flex-1 min-w-[200px]">
                <Label className="text-xs">Nota (opcional rejeição)</Label>
                <Input value={notes[r.id] ?? ""} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
              </div>
              <Button onClick={() => approve.mutate(r.id)} disabled={!cl.passed || confirms[r.id] !== "CONFIRMO" || approve.isPending} className="bg-emerald-600 hover:bg-emerald-700">Aprovar</Button>
              <Button variant="outline" onClick={() => reject.mutate(r.id)} disabled={reject.isPending}>Rejeitar</Button>
            </div>
          </article>
        ))}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Histórico recente</h2>
        <div className="panel p-4 space-y-2">
          {data.recent.length === 0 && <p className="text-xs text-muted-foreground">Sem histórico.</p>}
          {data.recent.map((r: any) => (
            <div key={r.id} className="flex justify-between text-sm border-b border-border last:border-0 py-2">
              <span>{new Date(r.created_at).toLocaleString("pt-BR")} • {r.pair} {r.side.toUpperCase()}</span>
              <span className="text-xs uppercase tracking-wider">{r.status}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return <div><div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div><div className="font-medium">{value}</div></div>;
}
