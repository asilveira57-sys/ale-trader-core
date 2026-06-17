import { createFileRoute, useParams, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  getExpert,
  addTextSource,
  addYoutubeSource,
  addPdfSource,
  processSource,
  extractStrategy,
  createPdfUploadUrl,
  updateExpert,
} from "@/lib/experts.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, FileText, Youtube, Upload, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/library/$expertId")({
  head: () => ({ meta: [{ title: "Especialista — AleTrader AI" }] }),
  component: ExpertPage,
});

function statusBadge(s: string) {
  if (s === "ready") return <Badge className="bg-success text-success-foreground">Pronto</Badge>;
  if (s === "processing") return <Badge variant="secondary">Processando</Badge>;
  if (s === "error") return <Badge variant="destructive">Erro</Badge>;
  return <Badge variant="outline">Pendente</Badge>;
}

function ExpertPage() {
  const { expertId } = useParams({ from: "/_authenticated/library/$expertId" });
  const qc = useQueryClient();
  const fetchExpert = useServerFn(getExpert);
  const addText = useServerFn(addTextSource);
  const addYt = useServerFn(addYoutubeSource);
  const addPdf = useServerFn(addPdfSource);
  const process = useServerFn(processSource);
  const extract = useServerFn(extractStrategy);
  const sign = useServerFn(createPdfUploadUrl);
  const update = useServerFn(updateExpert);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["expert", expertId],
    queryFn: () => fetchExpert({ data: { id: expertId } }),
    refetchInterval: 6000,
  });

  const [ytUrl, setYtUrl] = useState("");
  const [textTitle, setTextTitle] = useState("");
  const [textBody, setTextBody] = useState("");

  const mYt = useMutation({
    mutationFn: () => addYt({ data: { expert_id: expertId, url: ytUrl } }),
    onSuccess: () => { toast.success("Vídeo enfileirado"); setYtUrl(""); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });
  const mTxt = useMutation({
    mutationFn: () => addText({ data: { expert_id: expertId, title: textTitle, text: textBody } }),
    onSuccess: () => { toast.success("Texto importado"); setTextTitle(""); setTextBody(""); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });

  async function handlePdf(file: File) {
    if (!file.name.toLowerCase().endsWith(".pdf")) return toast.error("Apenas arquivos .pdf");
    if (file.size > 20 * 1024 * 1024) return toast.error("Máximo 20 MB");
    try {
      const { path, token } = await sign({ data: { expert_id: expertId, filename: file.name } });
      const up = await supabase.storage.from("expert-sources").uploadToSignedUrl(path, token, file);
      if (up.error) throw up.error;
      await addPdf({ data: { expert_id: expertId, storage_path: path, title: file.name } });
      toast.success("PDF enviado e processando");
      refetch();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  const mProcess = useMutation({
    mutationFn: (id: string) => process({ data: { source_id: id } }),
    onSuccess: () => { toast.success("Fonte reprocessada"); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });
  const mExtract = useMutation({
    mutationFn: () => extract({ data: { expert_id: expertId } }),
    onSuccess: () => { toast.success("Estratégia extraída"); qc.invalidateQueries({ queryKey: ["experts"] }); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading || !data) return <div className="p-8 text-muted-foreground">Carregando…</div>;
  const { expert, sources, strategy } = data;

  return (
    <div className="p-8 max-w-6xl space-y-6">
      <Link to="/library" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
        <ArrowLeft className="size-4" />Voltar
      </Link>

      <header className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          {expert.photo_url ? (
            <img src={expert.photo_url} alt={expert.name} className="size-14 rounded-md object-cover" />
          ) : (
            <div className="size-14 rounded-md bg-muted" />
          )}
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{expert.name}</h1>
            <p className="text-sm text-muted-foreground">
              {expert.expert_categories?.label ?? "Sem categoria"} · {expert.risk_profile} · {expert.main_strategy ?? "—"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch
              checked={expert.active}
              onCheckedChange={(v) => update({ data: { id: expert.id, active: v } }).then(() => refetch())}
            />
            <span className="text-sm">{expert.active ? "Ativo" : "Inativo"}</span>
          </div>
        </div>
      </header>

      {expert.bio && <p className="text-sm text-muted-foreground max-w-3xl">{expert.bio}</p>}

      <section className="panel p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Estratégia extraída</h2>
          <Button size="sm" variant="outline" onClick={() => mExtract.mutate()} disabled={mExtract.isPending}>
            <Sparkles className="size-4 mr-2" />Reextrair
          </Button>
        </div>
        {strategy ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            {[
              ["Filosofia", strategy.philosophy],
              ["Compra", strategy.buy_criteria],
              ["Venda", strategy.sell_criteria],
              ["Risco", strategy.risk_criteria],
              ["Confirmação", strategy.confirmation_criteria],
              ["Exclusão", strategy.exclusion_criteria],
            ].map(([k, v]) => (
              <div key={k} className="border border-border rounded-md p-3">
                <p className="text-xs uppercase text-muted-foreground mb-1">{k}</p>
                <p className="whitespace-pre-wrap">{v || "—"}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Importe conteúdo abaixo para gerar a estratégia automaticamente.</p>
        )}
      </section>

      <section className="panel p-5">
        <h2 className="text-sm font-semibold mb-3">Importar conhecimento</h2>
        <Tabs defaultValue="youtube">
          <TabsList>
            <TabsTrigger value="youtube"><Youtube className="size-4 mr-1" />YouTube</TabsTrigger>
            <TabsTrigger value="pdf"><Upload className="size-4 mr-1" />PDF</TabsTrigger>
            <TabsTrigger value="text"><FileText className="size-4 mr-1" />Texto</TabsTrigger>
          </TabsList>
          <TabsContent value="youtube" className="space-y-2 pt-4">
            <Label>URL do vídeo</Label>
            <div className="flex gap-2">
              <Input value={ytUrl} onChange={(e) => setYtUrl(e.target.value)} placeholder="https://youtube.com/watch?v=..." />
              <Button onClick={() => mYt.mutate()} disabled={!ytUrl || mYt.isPending}>Importar</Button>
            </div>
            <p className="text-xs text-muted-foreground">Requer legendas oficiais (pt ou en).</p>
          </TabsContent>
          <TabsContent value="pdf" className="space-y-2 pt-4">
            <Label>Arquivo PDF (máx 20 MB)</Label>
            <Input type="file" accept="application/pdf" onChange={(e) => e.target.files?.[0] && handlePdf(e.target.files[0])} />
          </TabsContent>
          <TabsContent value="text" className="space-y-2 pt-4">
            <Label>Título</Label>
            <Input value={textTitle} onChange={(e) => setTextTitle(e.target.value)} />
            <Label>Conteúdo</Label>
            <Textarea rows={8} value={textBody} onChange={(e) => setTextBody(e.target.value)} placeholder="Cole aqui o trecho..." />
            <Button onClick={() => mTxt.mutate()} disabled={!textTitle || textBody.length < 50 || mTxt.isPending}>Importar</Button>
          </TabsContent>
        </Tabs>
      </section>

      <section className="panel p-5">
        <h2 className="text-sm font-semibold mb-3">Fontes ({sources.length})</h2>
        <ul className="divide-y divide-border text-sm">
          {sources.map((s: any) => (
            <li key={s.id} className="py-3 flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">{s.title ?? s.url ?? s.id}</p>
                <p className="text-xs text-muted-foreground">
                  {s.kind} · {s.chunk_count ?? 0} chunks · {new Date(s.created_at).toLocaleString()}
                  {s.error_msg && <span className="text-destructive ml-2">· {s.error_msg}</span>}
                </p>
              </div>
              {statusBadge(s.status)}
              {s.status !== "processing" && (
                <Button variant="ghost" size="sm" onClick={() => mProcess.mutate(s.id)} disabled={mProcess.isPending}>
                  <RefreshCw className="size-4" />
                </Button>
              )}
            </li>
          ))}
          {sources.length === 0 && <li className="py-6 text-muted-foreground text-center">Nenhuma fonte ainda.</li>}
        </ul>
      </section>
    </div>
  );
}
