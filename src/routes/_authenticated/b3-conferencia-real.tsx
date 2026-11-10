import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Copy } from "lucide-react";
import { readConferencia, saveExtrato } from "@/lib/b3-conferencia-real.functions";
import { realResultText } from "@/lib/b3-real-apuracao";
import { SIGNED_BRL, BRL } from "@/lib/b3-format";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/b3-conferencia-real")({
  head: () => ({
    meta: [
      { title: "Conferência do real × extrato da corretora — AleTrader AI" },
      { name: "description", content: "Lançamento manual do extrato da corretora e divergência por pregão contra as ordens reais gravadas, sem corrigir nenhum número." },
      { property: "og:title", content: "Conferência do real × extrato — AleTrader AI" },
      { property: "og:description", content: "Corretora, sistema e diferença lado a lado por pregão." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

const v = (x: unknown) => (x == null ? "sem registro" : SIGNED_BRL(Number(x)));
const FIELDS = [
  ["ajuste_day_trade_brl", "Ajuste day-trade"], ["custos_brl", "Custos (líquido das operações)"],
  ["irrf_brl", "IRRF"], ["deposito_brl", "Depósito"], ["saldo_apos_brl", "Saldo após"],
] as const;
const copiar = (t: string) => navigator.clipboard.writeText(t).then(() => toast.success("Copiado"));

function Page() {
  const qc = useQueryClient();
  const read = useServerFn(readConferencia);
  const save = useServerFn(saveExtrato);
  const q = useQuery({ queryKey: ["b3-conferencia-real"], queryFn: () => read() });
  const [form, setForm] = useState<Record<string, string>>({ pregao: "", origem: "extrato_pdf" });
  const rows = q.data?.divergencia ?? [];

  const parse = (s?: string) => (s == null || s.trim() === "" ? null : Number(s.replace(/\./g, "").replace(",", ".")));
  const submit = async () => {
    try {
      await save({ data: { pregao: form.pregao, origem: form.origem as any, ...Object.fromEntries(FIELDS.map(([k]) => [k, parse(form[k])])) } as any });
      toast.success("Lançamento salvo"); qc.invalidateQueries({ queryKey: ["b3-conferencia-real"] });
    } catch (e: any) { toast.error(e?.message ?? "Erro"); }
  };
  const textoForm = `Lançamento extrato · pregão ${form.pregao || "sem registro"} · origem ${form.origem}\n` + FIELDS.map(([k, l]) => `${l}: ${form[k]?.trim() ? form[k] : "sem registro"}`).join("\n");
  const textoTabela = ["pregão\tcorretora\tsistema\tdiferença\tordens\tfechadas executor\tfechadas corretora\tsem resultado\tcustos corretora\tcustos sistema",
    ...rows.map((r) => [r.pregao, r.extrato_lancado ? v(r.corretora_brl) : "extrato não lançado", realResultText(Number(r.sistema_brl ?? 0), Number(r.sem_resultado ?? 0)),
      r.sem_resultado ? "DESCONHECIDO" : r.diferenca_brl == null ? "extrato não lançado" : v(r.diferenca_brl), r.ordens, r.fechadas_executor, r.fechadas_corretora, r.sem_resultado,
      r.extrato_lancado ? v(r.custos_corretora_brl) : "extrato não lançado", v(r.custos_sistema_brl)].join("\t"))].join("\n");

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-bold">Conferência do real × extrato da corretora</h1>
        <p className="text-sm text-muted-foreground">Mostra os dois lados e a diferença. Nenhum número é corrigido aqui. Ordem sem resultado não entra como zero: tem contador próprio.</p>
      </header>

      <section className="rounded border border-border p-4">
        <h2 className="mb-3 font-semibold">Lançar pregão do extrato</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm">Pregão (data de movimento)
            <input type="date" className="mt-1 block min-h-11 w-full rounded border border-border bg-background px-2" value={form.pregao} onChange={(e) => setForm({ ...form, pregao: e.target.value })} />
          </label>
          {FIELDS.map(([k, l]) => (
            <label key={k} className="text-sm">{l} (R$)
              <input inputMode="decimal" className="mt-1 block min-h-11 w-full rounded border border-border bg-background px-2 font-mono" value={form[k] ?? ""} onChange={(e) => setForm({ ...form, [k]: e.target.value })} placeholder="ex.: -369,00" />
            </label>
          ))}
          <label className="text-sm">Origem
            <select className="mt-1 block min-h-11 w-full rounded border border-border bg-background px-2" value={form.origem} onChange={(e) => setForm({ ...form, origem: e.target.value })}>
              <option value="extrato_pdf">extrato PDF</option><option value="manual">manual</option>
            </select>
          </label>
        </div>
        <div className="mt-3 flex gap-2">
          <Button className="min-h-11" disabled={!form.pregao} onClick={submit}>Salvar lançamento</Button>
          <Button variant="outline" className="min-h-11" onClick={() => copiar(textoForm)}><Copy className="mr-2 size-4" />Copiar lançamento</Button>
        </div>
      </section>

      <section className="rounded border border-border p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="font-semibold">Divergência por pregão (maior diferença absoluta primeiro)</h2>
          <Button variant="outline" className="min-h-11" disabled={!rows.length} onClick={() => copiar(textoTabela)}><Copy className="mr-2 size-4" />Copiar tabela</Button>
        </div>
        {q.isLoading ? <p className="text-sm text-muted-foreground">Carregando…</p> : q.isError ? <p className="text-sm text-destructive">{String((q.error as any)?.message)}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-xs">
              <thead className="text-[10px] uppercase text-muted-foreground"><tr className="border-b border-border">
                {["Pregão", "Corretora", "Sistema", "Diferença", "Ordens", "Fech. executor", "Fech. corretora", "Sem resultado", "Custos corretora", "Custos sistema"].map((h, i) => <th key={h} className={`py-1 ${i ? "text-right" : "text-left"}`}>{h}</th>)}
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.pregao} className="border-b border-border/50 font-mono">
                    <td className="py-1">{r.pregao}</td>
                    <td className="py-1 text-right">{r.extrato_lancado ? v(r.corretora_brl) : <span className="text-amber-200">extrato não lançado</span>}</td>
                    <td className={`py-1 text-right ${r.sem_resultado ? "text-warning font-bold" : ""}`}>{realResultText(Number(r.sistema_brl ?? 0), Number(r.sem_resultado ?? 0))}</td>
                    <td className="py-1 text-right font-bold">{r.sem_resultado ? <span className="text-warning">DESCONHECIDO</span> : r.diferenca_brl == null ? <span className="text-amber-200">extrato não lançado</span> : v(r.diferenca_brl)}</td>
                    <td className="py-1 text-right">{r.ordens}</td>
                    <td className="py-1 text-right">{r.fechadas_executor}</td>
                    <td className="py-1 text-right">{r.fechadas_corretora}</td>
                    <td className={`py-1 text-right ${r.sem_resultado ? "text-amber-200 font-bold" : ""}`}>{r.sem_resultado}</td>
                    <td className="py-1 text-right">{r.extrato_lancado ? (r.custos_corretora_brl == null ? "sem registro" : BRL(Number(r.custos_corretora_brl))) : "extrato não lançado"}</td>
                    <td className="py-1 text-right">{r.custos_sistema_brl == null ? "sem registro" : BRL(Number(r.custos_sistema_brl))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
