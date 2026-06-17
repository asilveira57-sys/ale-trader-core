import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { addKnowledge, listKnowledge } from "@/lib/intelligence.functions";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/knowledge")({ component: Page });

function Page() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["knowledge"], queryFn: () => listKnowledge() });
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [url, setUrl] = useState("");
  const [content, setContent] = useState("");
  const [sourceType, setSourceType] = useState<"video" | "book" | "pdf" | "article" | "report">("article");

  const add = useMutation({
    mutationFn: () => addKnowledge({ data: { source_type: sourceType, title, author: author || undefined, url: url || undefined, content: content || undefined } }),
    onSuccess: () => { toast.success("Adicionado"); setTitle(""); setAuthor(""); setUrl(""); setContent(""); qc.invalidateQueries({ queryKey: ["knowledge"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Erro"),
  });

  return (
    <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-1 space-y-3">
        <h1 className="text-xl font-semibold">Centro de Conhecimento</h1>
        <Card className="p-3 space-y-2">
          <div className="flex gap-2 text-xs">
            {(["video", "book", "pdf", "article", "report"] as const).map((t) => (
              <Button key={t} size="sm" variant={t === sourceType ? "default" : "outline"} onClick={() => setSourceType(t)}>{t}</Button>
            ))}
          </div>
          <Input placeholder="Título" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Input placeholder="Autor" value={author} onChange={(e) => setAuthor(e.target.value)} />
          <Input placeholder="URL" value={url} onChange={(e) => setUrl(e.target.value)} />
          <Textarea placeholder="Resumo / transcrição (será indexado)" value={content} onChange={(e) => setContent(e.target.value)} rows={6} />
          <Button size="sm" disabled={!title || add.isPending} onClick={() => add.mutate()}>Adicionar</Button>
        </Card>
      </div>
      <div className="lg:col-span-2 space-y-2">
        {(list.data ?? []).map((k: any) => (
          <Card key={k.id} className="p-3">
            <div className="flex justify-between">
              <span className="font-medium">{k.title}</span>
              <Badge variant="outline">{k.source_type}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">{k.author ?? ""} · {new Date(k.created_at).toLocaleDateString()}</p>
            {k.url && <a className="text-xs text-primary underline" href={k.url} target="_blank" rel="noreferrer">abrir</a>}
          </Card>
        ))}
      </div>
    </div>
  );
}
