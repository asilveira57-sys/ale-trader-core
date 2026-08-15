import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { listPrdAuthorizations, setPrdAuthorization, revokeAllPrdAuthorizations } from "@/lib/prd-authorization.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { ShieldAlert, AlertTriangle, Lock, Unlock } from "lucide-react";

export const Route = createFileRoute("/_authenticated/prd-autorizacoes")({
  head: () => ({
    meta: [
      { title: "Autorizações de Conta Real — AleTrader AI" },
      { name: "description", content: "Portão de autorização por ativo e modo para execução em conta real B3." },
      { property: "og:title", content: "Autorizações de Conta Real — AleTrader AI" },
      { property: "og:description", content: "Portão de autorização por ativo e modo para execução em conta real B3." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PrdAuthorizationsPage,
});

type Row = {
  id: string; symbol: string; variant: string; mode: string; enabled: boolean;
  max_qty: number; max_daily_loss_brl: number;
  authorized_at: string | null; authorized_by: string | null;
};

const MODE_LABEL: Record<string, string> = {
  conservador: "Conservador", moderado: "Moderado", equilibrado: "Equilibrado",
  semi_agressivo: "Semi-agressivo", agressivo: "Agressivo",
};

const VARIANT_LABEL: Record<string, string> = {
  indicador: "Indicador", price_action: "Price Action",
  mean_reversion: "Reversão à média", range: "Range",
};

function PrdAuthorizationsPage() {
  const qc = useQueryClient();
  const list = useServerFn(listPrdAuthorizations);
  const setAuth = useServerFn(setPrdAuthorization);
  const revokeAll = useServerFn(revokeAllPrdAuthorizations);

  const { data, isLoading } = useQuery({ queryKey: ["prd-auth"], queryFn: () => list({}) });

  const [target, setTarget] = useState<Row | null>(null);
  const [password, setPassword] = useState("");
  const [qty, setQty] = useState(1);
  const [loss, setLoss] = useState(0);
  const [killStep, setKillStep] = useState<0 | 1 | 2>(0);
  const [killPassword, setKillPassword] = useState("");

  const mSet = useMutation({
    mutationFn: (p: { row: Row; enabled: boolean; password: string; max_qty: number; max_daily_loss_brl: number }) =>
      setAuth({
        data: {
          symbol: p.row.symbol as never, variant: (p.row.variant ?? "indicador") as never,
          mode: p.row.mode as never,
          enabled: p.enabled, max_qty: p.max_qty,
          max_daily_loss_brl: p.max_daily_loss_brl, password: p.password,
        },
      }),
    onSuccess: () => {
      toast.success("Autorização atualizada");
      setTarget(null); setPassword("");
      qc.invalidateQueries({ queryKey: ["prd-auth"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mKill = useMutation({
    mutationFn: () => revokeAll({ data: { password: killPassword } }),
    onSuccess: (r: { revoked: number }) => {
      toast.success(`${r.revoked} autorização(ões) desligada(s)`);
      setKillStep(0); setKillPassword("");
      qc.invalidateQueries({ queryKey: ["prd-auth"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading || !data) return <div className="p-8 text-muted-foreground">Carregando autorizações…</div>;

  const rows = (data.authorizations ?? []) as Row[];
  // Agrupa por ativo + modalidade: o par autorizado é (ativo, modalidade, modo).
  const grouped = rows.reduce<Record<string, Row[]>>((acc, r) => {
    (acc[`${r.symbol}||${r.variant ?? "indicador"}`] ??= []).push(r);
    return acc;
  }, {});
  const enabledCount = data.enabled_count ?? 0;

  function openDialog(row: Row, enabling: boolean) {
    setTarget({ ...row, enabled: enabling });
    setQty(Number(row.max_qty ?? 1));
    setLoss(Number(row.max_daily_loss_brl ?? 0));
    setPassword("");
  }

  return (
    <div className="p-8 space-y-6 max-w-6xl">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <ShieldAlert className="size-6 text-orange-500" /> Autorizações de Conta Real
          </h1>
          <p className="text-sm text-muted-foreground">
            Nega por padrão: nenhum comando real é enfileirado sem autorização explícita por ativo e modo.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className={`panel px-4 py-2 text-sm ${enabledCount > 0 ? "border-orange-500/50 bg-orange-500/10 text-orange-300" : "text-muted-foreground"}`}>
            <span className="font-mono text-lg font-semibold">{enabledCount}</span> / {rows.length} pares ligados
          </div>
          <Button variant="destructive" onClick={() => setKillStep(1)}>
            <AlertTriangle className="size-4 mr-1" /> Desligar tudo
          </Button>
        </div>
      </header>

      <div className="panel p-4 border-orange-500/40 bg-orange-500/10 text-sm text-orange-200 space-y-1">
        <p className="font-medium flex items-center gap-2"><AlertTriangle className="size-4" /> Isto controla envio de ordem com DINHEIRO REAL.</p>
        <p className="text-orange-200/80">
          Ao ligar um par ativo+modo, o motor passa a enfileirar comandos reais para aquele robô. As flags{" "}
          <code className="font-mono">DRY_RUN</code> e <code className="font-mono">REAL_TRADING_CONFIRMED</code> do executor
          Python continuam sendo a barreira final — enquanto elas estiverem em modo seguro, nenhum comando vira ordem executada.
        </p>
      </div>

      {Object.entries(grouped).map(([key, list]) => {
        const [symbol, variant] = key.split("||");
        return (
        <section key={key} className="panel p-5 space-y-3">
          <h2 className="font-medium flex items-center gap-2">
            {symbol}
            <Badge variant="outline">{VARIANT_LABEL[variant ?? ""] ?? variant}</Badge>
          </h2>
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-muted-foreground border-b border-border">
              <tr>
                <th className="text-left py-2">Modo</th>
                <th className="text-left">Modalidade</th>
                <th className="text-left">Status</th>
                <th className="text-right">Qtd. máx.</th>
                <th className="text-right">Perda diária máx.</th>
                <th className="text-left pl-4">Autorizado em</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id} className="border-b border-border/40">
                  <td className="py-2 font-medium">{MODE_LABEL[r.mode] ?? r.mode}</td>
                  <td className="text-muted-foreground">{VARIANT_LABEL[r.variant] ?? r.variant}</td>
                  <td>
                    {r.enabled
                      ? <Badge className="bg-orange-500 text-white">LIBERADO</Badge>
                      : <Badge variant="secondary">bloqueado</Badge>}
                  </td>
                  <td className="text-right font-mono">{r.max_qty}</td>
                  <td className="text-right font-mono">R$ {Number(r.max_daily_loss_brl).toFixed(2)}</td>
                  <td className="pl-4 text-muted-foreground">
                    {r.authorized_at ? new Date(r.authorized_at).toLocaleString("pt-BR") : "—"}
                  </td>
                  <td className="text-right">
                    <Button size="sm" variant={r.enabled ? "outline" : "default"} onClick={() => openDialog(r, !r.enabled)}>
                      {r.enabled ? <><Lock className="size-3.5 mr-1" /> Desligar</> : <><Unlock className="size-3.5 mr-1" /> Ligar</>}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        );
      })}

      <section className="panel p-5">
        <h2 className="font-medium mb-3">Histórico de mudanças</h2>
        {(data.log ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma mudança registrada.</p>
        ) : (
          <ul className="space-y-1 text-xs font-mono">
            {(data.log as any[]).map((l) => (
              <li key={l.id} className="text-muted-foreground">
                {new Date(l.ts).toLocaleString("pt-BR")} · {l.symbol} · {VARIANT_LABEL[l.variant] ?? l.variant ?? "indicador"} · {l.mode} ·{" "}
                <span className={l.para_enabled ? "text-orange-400" : "text-emerald-400"}>
                  {String(l.de_enabled)} → {String(l.para_enabled)}
                </span>{" "}
                · qty {l.de_max_qty} → {l.para_max_qty} · origem {l.origem ?? "—"}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog open={!!target} onOpenChange={(o) => { if (!o) { setTarget(null); setPassword(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{target?.enabled ? "Liberar execução real" : "Bloquear execução real"}</DialogTitle>
            <DialogDescription>
              {target?.enabled
                ? "Confirme com a senha mestra. O robô abaixo passará a enfileirar ordens reais."
                : "Confirme com a senha mestra para bloquear este par."}
            </DialogDescription>
          </DialogHeader>
          {target && (
            <div className="space-y-4">
              <div className="rounded-md border border-border p-3 text-sm space-y-1">
                <div>Ativo: <span className="font-medium">{target.symbol}</span></div>
                <div>Modalidade: <span className="font-medium">{VARIANT_LABEL[target.variant] ?? target.variant}</span></div>
                <div>Modo: <span className="font-medium">{MODE_LABEL[target.mode] ?? target.mode}</span></div>
                <div>Quantidade máxima: <span className="font-mono">{qty}</span> contrato(s)</div>
              </div>
              {target.enabled && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Qtd. máxima (1–100)</Label>
                    <Input type="number" min={1} max={100} value={qty} onChange={(e) => setQty(Number(e.target.value))} />
                  </div>
                  <div>
                    <Label>Perda diária máx. (R$)</Label>
                    <Input type="number" min={0} step={10} value={loss} onChange={(e) => setLoss(Number(e.target.value))} />
                  </div>
                </div>
              )}
              <div>
                <Label>Senha mestra</Label>
                <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>Cancelar</Button>
            <Button
              variant={target?.enabled ? "destructive" : "default"}
              disabled={!password || mSet.isPending}
              onClick={() => target && mSet.mutate({ row: target, enabled: target.enabled, password, max_qty: qty, max_daily_loss_brl: loss })}
            >
              {target?.enabled ? "Liberar conta real" : "Bloquear"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={killStep > 0} onOpenChange={(o) => { if (!o) { setKillStep(0); setKillPassword(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Desligar todas as autorizações reais</DialogTitle>
            <DialogDescription>
              {killStep === 1
                ? `Isto bloqueia imediatamente os ${enabledCount} par(es) liberados. Confirme para prosseguir.`
                : "Confirmação final: digite a senha mestra."}
            </DialogDescription>
          </DialogHeader>
          {killStep === 2 && (
            <div>
              <Label>Senha mestra</Label>
              <Input type="password" autoComplete="current-password" value={killPassword} onChange={(e) => setKillPassword(e.target.value)} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setKillStep(0); setKillPassword(""); }}>Cancelar</Button>
            {killStep === 1
              ? <Button variant="destructive" onClick={() => setKillStep(2)}>Continuar</Button>
              : <Button variant="destructive" disabled={!killPassword || mKill.isPending} onClick={() => mKill.mutate()}>Desligar tudo agora</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
