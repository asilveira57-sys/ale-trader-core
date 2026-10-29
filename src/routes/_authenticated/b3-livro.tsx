import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Pencil, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { copiarTexto } from "@/lib/b3-copiar";
import { LIVRO_STATUS, LIVRO_TIPOS, agruparPorDia, filtrarLivro, retratadoPor, textoRegistro, type LivroRegistro } from "@/lib/b3-livro";

export const Route = createFileRoute("/_authenticated/b3-livro")({
  head: () => ({ meta: [
    { title: "Livro de ocorrências — B3" },
    { name: "description", content: "Achados, decisões, mudanças e retratações registrados à mão." },
    { property: "og:title", content: "Livro de ocorrências — B3" },
    { property: "og:description", content: "Memória de decisão: o que foi achado, aplicado e retratado." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: LivroPage,
});

const TIPO_COR: Record<string, string> = {
  achado: "bg-primary/15 text-primary", retratacao: "bg-destructive/15 text-destructive", mudanca_aplicada: "bg-accent text-accent-foreground",
  pedido_lovable: "bg-secondary text-secondary-foreground", decisao: "bg-primary text-primary-foreground", pendencia: "bg-muted text-foreground", fechamento_do_dia: "bg-foreground text-background",
};

function inline(t: string): ReactNode[] {
  return t.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g).map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong>
    : p.startsWith("`") && p.endsWith("`") ? <code key={i} className="rounded bg-muted px-1">{p.slice(1, -1)}</code>
    : p.startsWith("*") && p.endsWith("*") && p.length > 2 ? <em key={i}>{p.slice(1, -1)}</em> : p);
}
function Markdown({ text }: { text: string }) {
  const out: ReactNode[] = []; let list: string[] = []; let code: string[] | null = null;
  const flush = () => { if (list.length) { out.push(<ul key={out.length} className="list-disc pl-5">{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>); list = []; } };
  for (const line of text.split("\n")) {
    if (line.startsWith("```")) { if (code) { out.push(<pre key={out.length} className="overflow-x-auto rounded bg-muted p-2 text-xs">{code.join("\n")}</pre>); code = null; } else { flush(); code = []; } continue; }
    if (code) { code.push(line); continue; }
    const li = line.match(/^\s*[-*]\s+(.*)/); if (li) { list.push(li[1]); continue; }
    flush();
    const h = line.match(/^(#{1,3})\s+(.*)/);
    if (h) out.push(<p key={out.length} className="font-bold">{inline(h[2])}</p>);
    else if (line.trim()) out.push(<p key={out.length}>{inline(line)}</p>);
  }
  flush(); if (code) out.push(<pre key={out.length} className="rounded bg-muted p-2 text-xs">{code.join("\n")}</pre>);
  return <div className="space-y-1 text-sm">{out}</div>;
}

type Form = { id?: string; data: string; tipo: string; titulo: string; corpo: string; status: string; retrata_id: string; referencias: string };
const vazio = (): Form => ({ data: new Date().toISOString().slice(0, 10), tipo: "achado", titulo: "", corpo: "", status: "aberto", retrata_id: "", referencias: "" });
const field = "min-h-11 w-full rounded border border-input bg-background px-2 text-sm";

function LivroPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["b3-livro"], queryFn: async () => {
    const all: LivroRegistro[] = [];
    for (let from = 0; from < 10000; from += 1000) {
      const { data, error } = await supabase.from("b3_livro_ocorrencias").select("*").order("data", { ascending: false }).range(from, from + 999);
      if (error) throw error; all.push(...(data as LivroRegistro[])); if (data.length < 1000) break;
    }
    return all;
  } });
  const rows = q.data ?? [];
  const por = useMemo(() => retratadoPor(rows), [rows]);
  const [tipos, setTipos] = useState<string[]>([]); const [status, setStatus] = useState(""); const [busca, setBusca] = useState("");
  const [form, setForm] = useState<Form | null>(null); const [buscaRetrata, setBuscaRetrata] = useState("");
  const dias = agruparPorDia(filtrarLivro(rows, { tipos, status, busca }));

  const salvar = useMutation({ mutationFn: async (f: Form) => {
    let refs: unknown = null;
    if (f.referencias.trim()) { try { refs = JSON.parse(f.referencias); } catch { refs = { texto: f.referencias }; } }
    const payload = { data: f.data, tipo: f.tipo, titulo: f.titulo, corpo: f.corpo, status: f.status, retrata_id: f.retrata_id || null, referencias: refs as never };
    const { error } = f.id ? await supabase.from("b3_livro_ocorrencias").update(payload).eq("id", f.id) : await supabase.from("b3_livro_ocorrencias").insert(payload);
    if (error) throw error;
    // Quem retrata marca o apontado como retratado (sem apagar nada).
    if (f.retrata_id) await supabase.from("b3_livro_ocorrencias").update({ status: "retratado" }).eq("id", f.retrata_id);
  }, onSuccess: () => { setForm(null); qc.invalidateQueries({ queryKey: ["b3-livro"] }); } });

  const candidatos = rows.filter((r) => r.id !== form?.id && (!buscaRetrata || r.titulo.toLowerCase().includes(buscaRetrata.toLowerCase()))).slice(0, 30);

  return <div className="mx-auto max-w-3xl space-y-4 p-3">
    <div className="flex items-center justify-between gap-2"><h1 className="text-xl font-black">Livro de ocorrências</h1>
      <Button className="min-h-11" onClick={() => { setForm(vazio()); setBuscaRetrata(""); }}><Plus className="size-4" /> Novo registro</Button></div>
    <p className="text-xs text-muted-foreground">Escrito à mão. Nada é apagado: o errado é retratado por um registro novo e fica riscado.</p>

    <div className="space-y-2 rounded border border-border p-2">
      <div className="flex flex-wrap gap-1">{LIVRO_TIPOS.map((t) => <button key={t} onClick={() => setTipos((s) => s.includes(t) ? s.filter((x) => x !== t) : [...s, t])}
        className={`min-h-11 rounded px-3 text-xs font-semibold ${tipos.includes(t) ? TIPO_COR[t] : "border border-border"}`}>{t}</button>)}</div>
      <div className="grid gap-2 sm:grid-cols-2">
        <select className={field} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">todos os status</option>{LIVRO_STATUS.map((s) => <option key={s}>{s}</option>)}</select>
        <input className={field} placeholder="buscar no título e no corpo" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>
    </div>

    {form && <div className="space-y-2 rounded border-2 border-primary p-3">
      <p className="font-bold">{form.id ? "Editar registro" : "Novo registro"}</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <input type="date" className={field} value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })} />
        <select className={field} value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>{LIVRO_TIPOS.map((t) => <option key={t}>{t}</option>)}</select>
        <select className={field} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{LIVRO_STATUS.map((s) => <option key={s}>{s}</option>)}</select>
      </div>
      <input className={field} placeholder="título" value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} />
      <textarea className={`${field} min-h-40 py-2`} placeholder="corpo (markdown)" value={form.corpo} onChange={(e) => setForm({ ...form, corpo: e.target.value })} />
      <textarea className={`${field} py-2`} placeholder='referências (JSON ou texto livre)' value={form.referencias} onChange={(e) => setForm({ ...form, referencias: e.target.value })} />
      <p className="text-xs font-semibold">Retrata o registro (opcional)</p>
      <input className={field} placeholder="buscar registro anterior por título" value={buscaRetrata} onChange={(e) => setBuscaRetrata(e.target.value)} />
      <select className={field} value={form.retrata_id} onChange={(e) => setForm({ ...form, retrata_id: e.target.value })}>
        <option value="">não retrata nenhum</option>{candidatos.map((r) => <option key={r.id} value={r.id}>{r.data} · {r.titulo}</option>)}</select>
      {salvar.isError && <p className="text-sm text-destructive">Não foi possível salvar: {(salvar.error as Error).message}</p>}
      <div className="flex gap-2"><Button className="min-h-11" disabled={!form.titulo.trim() || !form.corpo.trim() || salvar.isPending} onClick={() => salvar.mutate(form)}>Salvar</Button>
        <Button variant="outline" className="min-h-11" onClick={() => setForm(null)}>Cancelar</Button></div>
    </div>}

    {q.isPending && <p className="text-sm">Carregando…</p>}
    {q.isError && <p className="text-sm text-destructive">Leitura do livro indisponível.</p>}
    {!q.isPending && dias.length === 0 && <p className="text-sm text-muted-foreground">sem registro</p>}
    {dias.map(([dia, regs]) => <section key={dia} className="space-y-2">
      <div className="flex items-center justify-between border-b border-border"><h2 className="font-black">{dia.split("-").reverse().join("/")}</h2>
        <Button variant="ghost" className="min-h-11" onClick={() => copiarTexto(`Livro de ocorrências — ${dia}\n\n` + regs.map((r) => textoRegistro(r, por, rows)).join("\n\n———\n\n"))}><Copy className="size-4" /> Copiar o dia</Button></div>
      {regs.map((r) => { const quem = por.get(r.id) ?? []; const ret = quem.length > 0; const alvo = r.retrata_id ? rows.find((x) => x.id === r.retrata_id) : null;
        return <article id={`reg-${r.id}`} key={r.id} className={`space-y-2 rounded border p-3 ${ret ? "border-destructive bg-destructive/5" : "border-border"}`}>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className={`rounded px-2 py-1 font-semibold ${TIPO_COR[r.tipo] ?? "bg-muted"}`}>{r.tipo}</span>
            <span className="rounded border border-border px-2 py-1">{r.status}</span>
            {ret && <span className="rounded bg-destructive px-2 py-1 font-black text-destructive-foreground">RETRATADO</span>}
          </div>
          <p className={`font-bold ${ret ? "line-through opacity-70" : ""}`}>{r.titulo}</p>
          <div className={ret ? "line-through opacity-60" : ""}><Markdown text={r.corpo} /></div>
          {ret && <p className="text-xs">Retratado por: {quem.map((x) => <a key={x.id} href={`#reg-${x.id}`} className="inline-flex min-h-11 items-center px-1 font-semibold underline">{x.titulo} ({x.data})</a>)}</p>}
          {r.retrata_id && <p className="text-xs">Retrata: <a href={`#reg-${r.retrata_id}`} className="inline-flex min-h-11 items-center px-1 underline">{alvo ? `${alvo.titulo} (${alvo.data})` : r.retrata_id}</a></p>}
          <p className="break-all text-xs text-muted-foreground">Referências: {r.referencias == null ? "sem registro" : JSON.stringify(r.referencias)}</p>
          <div className="flex gap-1">
            <Button variant="ghost" className="min-h-11" onClick={() => copiarTexto(textoRegistro(r, por, rows))}><Copy className="size-4" /> Copiar</Button>
            <Button variant="ghost" className="min-h-11" onClick={() => { setForm({ id: r.id, data: r.data, tipo: r.tipo, titulo: r.titulo, corpo: r.corpo, status: r.status, retrata_id: r.retrata_id ?? "", referencias: r.referencias == null ? "" : JSON.stringify(r.referencias, null, 2) }); window.scrollTo({ top: 0 }); }}><Pencil className="size-4" /> Editar</Button>
          </div>
        </article>; })}
    </section>)}
  </div>;
}
