import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listAssets, upsertAsset, deleteAsset } from "@/lib/atrader.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/assets")({
  head: () => ({ meta: [{ title: "Ativos monitorados — AleTrader AI" }] }),
  component: AssetsPage,
});

const TF_OPTIONS = ["15m", "1h", "4h", "1d"];

function AssetsPage() {
  const qc = useQueryClient();
  const fetchFn = useServerFn(listAssets);
  const saveFn = useServerFn(upsertAsset);
  const delFn = useServerFn(deleteAsset);

  const { data: assets = [] } = useQuery({ queryKey: ["assets"], queryFn: () => fetchFn({}) });
  const [editing, setEditing] = useState<any | null>(null);
  const [open, setOpen] = useState(false);

  const save = useMutation({
    mutationFn: (d: any) => saveFn({ data: d }),
    onSuccess: () => { toast.success("Ativo salvo"); qc.invalidateQueries({ queryKey: ["assets"] }); setOpen(false); },
    onError: (e: any) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => { toast.success("Ativo removido"); qc.invalidateQueries({ queryKey: ["assets"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  function openNew() { setEditing({ name: "", pair: "", active: true, timeframes: ["15m", "1h", "4h", "1d"], notes: "" }); setOpen(true); }
  function openEdit(a: any) { setEditing({ ...a }); setOpen(true); }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    save.mutate({
      id: editing.id,
      name: editing.name,
      pair: editing.pair.toUpperCase(),
      active: editing.active,
      timeframes: editing.timeframes,
      notes: editing.notes || null,
    });
  }

  return (
    <div className="p-8 space-y-6 max-w-6xl">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Ativos monitorados</h1>
          <p className="text-sm text-muted-foreground">Pares acompanhados pelo robô e seus timeframes.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" onClick={openNew}><Plus className="size-4 mr-2" />Novo ativo</Button>
          </DialogTrigger>
          {editing && (
            <DialogContent>
              <DialogHeader><DialogTitle>{editing.id ? "Editar ativo" : "Novo ativo"}</DialogTitle></DialogHeader>
              <form onSubmit={submit} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Nome</Label><Input required value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
                  <div><Label>Par</Label><Input required value={editing.pair} onChange={(e) => setEditing({ ...editing, pair: e.target.value.toUpperCase() })} placeholder="BTCUSDT" /></div>
                </div>
                <div>
                  <Label>Timeframes</Label>
                  <div className="flex gap-2 mt-2">
                    {TF_OPTIONS.map((tf) => {
                      const on = editing.timeframes.includes(tf);
                      return (
                        <button type="button" key={tf} onClick={() => setEditing({ ...editing, timeframes: on ? editing.timeframes.filter((x: string) => x !== tf) : [...editing.timeframes, tf] })} className={`px-3 py-1.5 rounded-md text-xs font-mono border ${on ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground"}`}>
                          {tf}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div><Label>Observações</Label><Textarea value={editing.notes ?? ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></div>
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-2">Ativo <Switch checked={editing.active} onCheckedChange={(v) => setEditing({ ...editing, active: v })} /></Label>
                </div>
                <DialogFooter><Button type="submit" disabled={save.isPending}>Salvar</Button></DialogFooter>
              </form>
            </DialogContent>
          )}
        </Dialog>
      </header>

      <div className="panel divide-y divide-border">
        {assets.map((a: any) => (
          <div key={a.id} className="flex items-center justify-between p-4">
            <div>
              <div className="flex items-center gap-2">
                <p className="font-medium">{a.pair}</p>
                <Badge variant={a.active ? "default" : "secondary"}>{a.active ? "ativo" : "inativo"}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">{a.name}</p>
              <div className="flex gap-1 mt-1">
                {a.timeframes.map((tf: string) => <span key={tf} className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono">{tf}</span>)}
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="icon" onClick={() => openEdit(a)}><Pencil className="size-4" /></Button>
              <Button variant="ghost" size="icon" onClick={() => del.mutate(a.id)}><Trash2 className="size-4 text-destructive" /></Button>
            </div>
          </div>
        ))}
        {!assets.length && <p className="p-6 text-sm text-muted-foreground">Nenhum ativo cadastrado.</p>}
      </div>
    </div>
  );
}
