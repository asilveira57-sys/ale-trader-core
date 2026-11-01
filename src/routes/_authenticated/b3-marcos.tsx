import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Pencil, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { readMarcos, saveMarco } from "@/lib/b3-marcos.functions";
import { marcoInput, marcoCopy, type Marco } from "@/lib/b3-marcos";
import { copiarTexto } from "@/lib/b3-copiar";
import { supabase } from "@/integrations/supabase/client";
import { brtDate } from "@/lib/b3-period";
export const Route = createFileRoute("/_authenticated/b3-marcos")({ head: () => ({ meta: [
  { title: "Marcos de configuração — AleTrader B3" }, { name: "description", content: "Mudanças manuais de configuração na linha do tempo dos pregões B3." },
  { property: "og:title", content: "Marcos de configuração — AleTrader B3" }, { property: "og:description", content: "Marcos por ativo e modalidade para distinguir períodos de configurações diferentes." },
  { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
] }), component: MarcosPage });
type Form = { id?: string; data: string; titulo: string; descricao: string; escopo: "global" | "ativo" | "modalidade"; symbol: string; variant: string };
function MarcosPage() {
  const read = useServerFn(readMarcos), save = useServerFn(saveMarco), qc = useQueryClient();
  const q = useQuery({ queryKey: ["b3-marcos"], queryFn: () => read() });
  const options = useQuery({ queryKey: ["b3-marcos-opcoes"], queryFn: async () => { const { data, error } = await supabase.from("b3_simulation_runs").select("symbol,variant"); if (error) throw error; return data; } });
  const [form, setForm] = useState<Form | null>(null);
  const m = useMutation({ mutationFn: (f: Form) => save({ data: marcoInput.parse({ ...f, symbol: f.symbol || null, variant: f.variant || null }) }), onSuccess: () => { setForm(null); qc.invalidateQueries({ queryKey: ["b3-marcos"] }); } });
  return <main className="mx-auto max-w-4xl space-y-4 p-4">
    <header className="flex flex-wrap items-center justify-between gap-2"><h1 className="text-2xl font-bold">Marcos de configuração</h1><Button className="min-h-11" onClick={() => setForm({ data: brtDate(new Date()), titulo: "", descricao: "", escopo: "global", symbol: "", variant: "" })}><Plus />Novo marco</Button></header>
    {form && <form className="space-y-3 border-y border-primary py-4" onSubmit={e => { e.preventDefault(); m.mutate(form); }}>
      <h2 className="font-bold">{form.id ? "Editar marco" : "Novo marco"}</h2>
      <label className="block text-sm">Data<Input aria-label="Data do marco" className="min-h-11" type="date" value={form.data} onChange={e => setForm({ ...form, data: e.target.value })} required /></label>
      <label className="block text-sm">Título<Input aria-label="Título do marco" className="min-h-11" value={form.titulo} maxLength={100} onChange={e => setForm({ ...form, titulo: e.target.value })} required /></label>
      <label className="block text-sm">Descrição<Textarea aria-label="Descrição do marco" value={form.descricao} onChange={e => setForm({ ...form, descricao: e.target.value })} required /></label>
      <label className="block text-sm">Escopo<select aria-label="Escopo do marco" className="min-h-11 w-full border border-input bg-background px-2" value={form.escopo} onChange={e => setForm({ ...form, escopo: e.target.value as Form['escopo'] })}>{["global", "ativo", "modalidade"].map(v => <option key={v}>{v}</option>)}</select></label>
      {form.escopo !== "global" && <label className="block text-sm">Ativo<select aria-label="Ativo do marco" className="min-h-11 w-full border border-input bg-background px-2" value={form.symbol} onChange={e => setForm({ ...form, symbol: e.target.value })} required><option value="">Escolha</option>{[...new Set(options.data?.map(r => r.symbol))].map(v => <option key={v}>{v}</option>)}</select></label>}
      {form.escopo === "modalidade" && <label className="block text-sm">Modalidade<select aria-label="Modalidade do marco" className="min-h-11 w-full border border-input bg-background px-2" value={form.variant} onChange={e => setForm({ ...form, variant: e.target.value })} required><option value="">Escolha</option>{[...new Set(options.data?.filter(r => r.symbol === form.symbol).map(r => r.variant))].map(v => <option key={v}>{v}</option>)}</select></label>}
      {m.isError && <p role="alert" className="text-destructive">{m.error.message}</p>}
      <div className="flex gap-2"><Button className="min-h-11" disabled={m.isPending}>Salvar marco</Button><Button type="button" variant="outline" className="min-h-11" onClick={() => setForm(null)}>Cancelar</Button></div>
    </form>}
    <Button variant="outline" className="min-h-11" onClick={() => copiarTexto(q.data?.map(marcoCopy).join("\n\n") || "sem registro")}><Copy />Copiar todos os marcos</Button>
    {q.isPending ? <p>Carregando…</p> : q.isError ? <p role="alert">Não foi possível ler os marcos.</p> : !q.data?.length ? <p>sem registro</p> : q.data.map((r: Marco) => <article key={r.id} className="border-b border-border py-3">
      <p className="text-xs text-muted-foreground">{r.data} · {r.escopo} {r.symbol} {r.variant}</p><h2 className="font-bold">{r.titulo}</h2><p className="whitespace-pre-wrap text-sm">{r.descricao}</p>
      <div className="flex gap-2"><Button variant="ghost" className="min-h-11" onClick={() => copiarTexto(marcoCopy(r))}><Copy />Copiar marco</Button><Button variant="ghost" className="min-h-11" onClick={() => setForm({ ...r, escopo: r.escopo as Form['escopo'], symbol: r.symbol ?? "", variant: r.variant ?? "" })}><Pencil />Editar marco</Button></div>
    </article>)}
  </main>;
}