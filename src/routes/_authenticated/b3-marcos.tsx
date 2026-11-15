import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Pencil, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { readMarcos, saveMarco, readManual } from "@/lib/b3-marcos.functions";
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
// Marcos (linha do tempo) + Manual (livretos), em abas. O Livro de ocorrências saiu
// do menu (15/11): marcos e livretos já são preenchidos automaticamente (livreto 107).
const ATIVOS_FILTRO = ["todos", "WIN", "WDO", "BIT"];
function MarcosPage() {
  const [aba, setAba] = useState<"marcos" | "manual">("marcos");
  const [ativo, setAtivo] = useState("todos");
  const [busca, setBusca] = useState("");
  const manualFn = useServerFn(readManual);
  const manual = useQuery({ queryKey: ["b3-manual"], queryFn: () => manualFn(), enabled: aba === "manual", staleTime: 60_000 });
  const read = useServerFn(readMarcos), save = useServerFn(saveMarco), qc = useQueryClient();
  const q = useQuery({ queryKey: ["b3-marcos"], queryFn: () => read() });
  const options = useQuery({ queryKey: ["b3-marcos-opcoes"], queryFn: async () => { const { data, error } = await supabase.from("b3_simulation_runs").select("symbol,variant"); if (error) throw error; return data; } });
  const [form, setForm] = useState<Form | null>(null);
  // Filtro por ativo: marco global vale para todos; marco de ativo casa pela raiz (WINZ26 → WIN).
  const marcosVisiveis = (q.data ?? []).filter((r: Marco) => ativo === "todos" || r.escopo === "global" || String(r.symbol ?? "").toUpperCase().startsWith(ativo));
  const m = useMutation({ mutationFn: (f: Form) => save({ data: marcoInput.parse({ ...f, symbol: f.symbol || null, variant: f.variant || null }) }), onSuccess: () => { setForm(null); qc.invalidateQueries({ queryKey: ["b3-marcos"] }); } });
  return <main className="mx-auto max-w-4xl space-y-4 p-4">
    <header className="flex flex-wrap items-center justify-between gap-2"><h1 className="text-2xl font-bold">Marcos e manual</h1>
      <div className="flex gap-1" role="tablist">{(["marcos", "manual"] as const).map(t => <Button key={t} role="tab" aria-selected={aba === t} variant={aba === t ? "default" : "outline"} className="min-h-9" onClick={() => setAba(t)}>{t === "marcos" ? "Marcos (linha do tempo)" : "Manual (livretos)"}</Button>)}</div><Button className="min-h-11" onClick={() => setForm({ data: brtDate(new Date()), titulo: "", descricao: "", escopo: "global", symbol: "", variant: "" })}><Plus />Novo marco</Button></header>
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
    {aba === "manual" ? <ManualTab q={manual} busca={busca} setBusca={setBusca} /> : <>
    <div className="flex flex-wrap items-center gap-1"><span className="text-sm text-muted-foreground">Ativo:</span>{ATIVOS_FILTRO.map(a => <Button key={a} variant={ativo === a ? "default" : "outline"} className="min-h-9" onClick={() => setAtivo(a)}>{a}</Button>)}</div>
    <Button variant="outline" className="min-h-11" onClick={() => copiarTexto(marcosVisiveis.map(marcoCopy).join("\n\n") || "sem registro")}><Copy />Copiar marcos</Button>
    {q.isPending ? <p>Carregando…</p> : q.isError ? <p role="alert">Não foi possível ler os marcos.</p> : !marcosVisiveis.length ? <p>sem registro</p> : marcosVisiveis.map((r: Marco) => <article key={r.id} className="border-b border-border py-3">
      <p className="text-xs text-muted-foreground">{String(r.data).split("-").reverse().join("/")} · {r.escopo === "global" ? "todos os ativos" : `${r.symbol ?? ""} ${r.variant ?? ""}`}</p><h2 className="font-bold">{r.titulo}</h2><p className="whitespace-pre-wrap text-sm">{r.descricao}</p>
      <div className="flex gap-2"><Button variant="ghost" className="min-h-11" onClick={() => copiarTexto(marcoCopy(r))}><Copy />Copiar marco</Button><Button variant="ghost" className="min-h-11" onClick={() => setForm({ ...r, escopo: r.escopo as Form['escopo'], symbol: r.symbol ?? "", variant: r.variant ?? "" })}><Pencil />Editar marco</Button></div>
    </article>)}
    </>}
  </main>;
}
function ManualTab({ q, busca, setBusca }: { q: any; busca: string; setBusca: (v: string) => void }) {
  const termo = busca.trim().toLowerCase();
  const rows = ((q.data ?? []) as any[]).filter(r => !termo || String(r.id) === termo || `${r.area} ${r.titulo} ${r.o_que_e}`.toLowerCase().includes(termo));
  const txt = (r: any) => `Livreto ${r.id} · ${r.area} · ${r.gravidade}\n${r.titulo}\n${r.o_que_e}${r.armadilha ? `\nArmadilha: ${r.armadilha}` : ""}${r.como_verificar ? `\nComo verificar: ${r.como_verificar}` : ""}`;
  return <section className="space-y-2">
    <div className="flex flex-wrap gap-2"><Input aria-label="Buscar no manual" className="min-h-9 max-w-sm" placeholder="Número do livreto ou palavra" value={busca} onChange={e => setBusca(e.target.value)} /><Button variant="outline" className="min-h-9" onClick={() => copiarTexto(rows.map(txt).join("\n\n") || "sem registro")}><Copy />Copiar</Button></div>
    {q.isPending ? <p>Carregando…</p> : q.isError ? <p role="alert">Não foi possível ler o manual.</p> : !rows.length ? <p>sem registro</p> : rows.map(r => <details key={r.id} className="border-b border-border py-2">
      <summary className="cursor-pointer list-none"><span className="mr-2 rounded bg-muted px-1.5 text-xs font-bold">{r.id}</span><span className="text-xs text-muted-foreground">{r.area} · {r.descoberto_em ? String(r.descoberto_em).split("-").reverse().join("/") : ""}</span><p className="font-semibold">{r.titulo}</p></summary>
      <div className="mt-2 space-y-1 whitespace-pre-wrap text-sm"><p>{r.o_que_e}</p>{r.armadilha && <p><b>Armadilha:</b> {r.armadilha}</p>}{r.como_verificar && <p className="font-mono text-xs text-muted-foreground">{r.como_verificar}</p>}<Button variant="ghost" className="min-h-9" onClick={() => copiarTexto(txt(r))}><Copy />Copiar livreto</Button></div>
    </details>)}
  </section>;
}
