import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { listExperts, createExpert } from "@/lib/experts.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, BookOpen } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/library")({
  head: () => ({ meta: [{ title: "Biblioteca — AleTrader AI" }] }),
  component: LibraryPage,
});

function LibraryPage() {
  const qc = useQueryClient();
  const fetchList = useServerFn(listExperts);
  const createFn = useServerFn(createExpert);
  const { data, isLoading } = useQuery({ queryKey: ["experts"], queryFn: () => fetchList({}) });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    category_id: "",
    risk_profile: "moderado" as "conservador" | "moderado" | "agressivo",
    bio: "",
    main_strategy: "",
    photo_url: "",
  });

  const mCreate = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          name: form.name,
          category_id: form.category_id || null,
          risk_profile: form.risk_profile,
          bio: form.bio || null,
          main_strategy: form.main_strategy || null,
          photo_url: form.photo_url || null,
        },
      }),
    onSuccess: () => {
      toast.success("Especialista criado");
      setOpen(false);
      setForm({ name: "", category_id: "", risk_profile: "moderado", bio: "", main_strategy: "", photo_url: "" });
      qc.invalidateQueries({ queryKey: ["experts"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading || !data) return <div className="p-8 text-muted-foreground">Carregando biblioteca…</div>;

  return (
    <div className="p-8 max-w-7xl space-y-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Biblioteca de Especialistas</h1>
          <p className="text-sm text-muted-foreground">
            Cadastre perfis de estratégia e importe conhecimento (YouTube, PDF, texto). Cada especialista vira um agente votante com memória própria.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="size-4 mr-2" />Novo especialista</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Novo especialista</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Nome</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex.: Perfil Value Conservador" />
              </div>
              <div>
                <Label>Categoria</Label>
                <Select value={form.category_id} onValueChange={(v) => setForm({ ...form, category_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {(data.categories ?? []).map((c: any) => (
                      <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Perfil de risco</Label>
                <Select value={form.risk_profile} onValueChange={(v) => setForm({ ...form, risk_profile: v as any })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="conservador">Conservador</SelectItem>
                    <SelectItem value="moderado">Moderado</SelectItem>
                    <SelectItem value="agressivo">Agressivo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Estratégia principal</Label>
                <Input value={form.main_strategy} onChange={(e) => setForm({ ...form, main_strategy: e.target.value })} placeholder="Ex.: Tendência de longo prazo em cripto" />
              </div>
              <div>
                <Label>Foto (URL)</Label>
                <Input value={form.photo_url} onChange={(e) => setForm({ ...form, photo_url: e.target.value })} placeholder="https://..." />
              </div>
              <div>
                <Label>Bio resumida</Label>
                <Textarea value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} rows={3} />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => mCreate.mutate()} disabled={!form.name || mCreate.isPending}>Criar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {data.experts.length === 0 && (
          <div className="col-span-full panel p-8 text-center text-muted-foreground">
            <BookOpen className="size-8 mx-auto mb-3 opacity-50" />
            Nenhum especialista ainda. Crie o primeiro para começar a importar conhecimento.
          </div>
        )}
        {data.experts.map((e: any) => (
          <Link key={e.id} to="/library/$expertId" params={{ expertId: e.id }} className="panel p-5 hover:border-primary/40 transition-colors">
            <div className="flex items-start gap-3">
              {e.photo_url ? (
                <img src={e.photo_url} alt={e.name} className="size-12 rounded-md object-cover" />
              ) : (
                <div className="size-12 rounded-md bg-muted grid place-items-center text-muted-foreground">
                  <BookOpen className="size-5" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">{e.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {e.expert_categories?.label ?? "Sem categoria"} · {e.risk_profile}
                </p>
              </div>
              <Badge variant={e.active ? "default" : "secondary"}>{e.active ? "Ativo" : "Inativo"}</Badge>
            </div>
            {e.expert_strategy?.philosophy && (
              <p className="text-xs text-muted-foreground mt-3 line-clamp-3">{e.expert_strategy.philosophy}</p>
            )}
            {e.reputation && (
              <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
                <span>Score <span className="font-mono text-foreground">{Number(e.reputation.score).toFixed(0)}</span></span>
                <span>Peso <span className="font-mono text-foreground">{Number(e.reputation.weight_current).toFixed(2)}</span></span>
                <span>Acertos <span className="font-mono text-foreground">{e.reputation.hits}</span></span>
              </div>
            )}
          </Link>
        ))}
      </section>
    </div>
  );
}
