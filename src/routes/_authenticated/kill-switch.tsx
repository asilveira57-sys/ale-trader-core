import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getGovernanceState, activateKillSwitchFn, deactivateKillSwitchFn } from "@/lib/auto-trading.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, PowerOff } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/kill-switch")({
  head: () => ({ meta: [{ title: "Kill Switch | AleTrader AI" }] }),
  component: KillSwitchPage,
});

function KillSwitchPage() {
  const fetchState = useServerFn(getGovernanceState);
  const activate = useServerFn(activateKillSwitchFn);
  const deactivate = useServerFn(deactivateKillSwitchFn);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["governance"], queryFn: () => fetchState(), refetchInterval: 15_000 });
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState("");

  const act = useMutation({
    mutationFn: () => activate({ data: { reason, confirm: "DESLIGAR" as const } }),
    onSuccess: () => { toast.success("Robô desligado"); setReason(""); setConfirm(""); qc.invalidateQueries({ queryKey: ["governance"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const reactivate = useMutation({
    mutationFn: () => deactivate({}),
    onSuccess: () => { toast.success("Kill switch desativado"); qc.invalidateQueries({ queryKey: ["governance"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const active = data?.gov?.kill_switch_active;
  const killIncidents = (data?.incidents ?? []).filter((i: any) => i.kind === "kill_switch");

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <header>
        <h1 className="text-3xl font-bold flex items-center gap-2 text-red-500"><PowerOff className="size-7" /> Kill Switch</h1>
        <p className="text-muted-foreground">Desligamento global imediato. Bloqueia novas entradas e cancela ordens pendentes. Não fecha posições abertas.</p>
      </header>

      <Card className={active ? "border-red-500/50 bg-red-500/5" : ""}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Status: <Badge variant={active ? "destructive" : "secondary"}>{active ? "ATIVO" : "INATIVO"}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {active ? (
            <>
              <p className="text-sm"><strong>Motivo:</strong> {data?.gov?.kill_switch_reason}</p>
              <p className="text-sm"><strong>Ativado em:</strong> {data?.gov?.kill_switch_activated_at && new Date(data.gov.kill_switch_activated_at).toLocaleString()}</p>
              <Button variant="outline" onClick={() => reactivate.mutate()}>Reativar robô</Button>
            </>
          ) : (
            <>
              <Textarea placeholder="Motivo do desligamento" value={reason} onChange={(e) => setReason(e.target.value)} />
              <Input placeholder='Digite "DESLIGAR" para confirmar' value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              <Button variant="destructive" className="w-full text-lg py-6" disabled={confirm !== "DESLIGAR" || reason.length < 3} onClick={() => act.mutate()}>
                <AlertTriangle className="size-5 mr-2" /> DESLIGAR ROBÔ
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Histórico</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {killIncidents.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum acionamento.</p> :
            killIncidents.map((i: any) => (
              <div key={i.id} className="text-sm border-b border-border py-2">
                <div className="flex justify-between"><span>{i.message}</span><span className="text-muted-foreground">{new Date(i.created_at).toLocaleString()}</span></div>
              </div>
            ))}
        </CardContent>
      </Card>
    </div>
  );
}
