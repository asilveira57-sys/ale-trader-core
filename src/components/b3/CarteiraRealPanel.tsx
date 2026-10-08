import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getCarteiraReal, lancarCarteiraReal } from "@/lib/b3-carteira.functions";
import { BRL } from "@/lib/b3-format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const hojeSP = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const cor = (v: number) => (v >= 0 ? "text-emerald-400" : "text-rose-400");

export function CarteiraRealPanel() {
  const qc = useQueryClient();
  const get = useServerFn(getCarteiraReal);
  const lancar = useServerFn(lancarCarteiraReal);
  const q = useQuery({ queryKey: ["b3-carteira-real"], queryFn: () => get(), refetchInterval: 60_000 });
  const [data, setData] = useState(hojeSP());
  const [tipo, setTipo] = useState<"aporte" | "retirada" | "ajuste">("aporte");
  const [valor, setValor] = useState("");
  const [obs, setObs] = useState("");
  const m = useMutation({
    mutationFn: () => lancar({ data: { data, tipo, valor_brl: Number(valor.replace(/\./g, "").replace(",", ".")), observacao: obs || undefined } }),
    onSuccess: () => { toast.success("Lançamento registrado"); setValor(""); setObs(""); qc.invalidateQueries({ queryKey: ["b3-carteira-real"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const c = q.data;
  if (!c) return <div className="rounded border border-border p-4 text-sm text-muted-foreground">Carteira: carregando…</div>;
  const insuf = c.capacidade.filter((a) => a.insuficiente);

  return (
    <section className="space-y-3 rounded border border-border p-4">
      <h2 className="text-lg font-bold">Carteira do real</h2>
      {insuf.length > 0 && (
        <div className="rounded border border-destructive bg-destructive/10 p-2 text-sm font-semibold text-destructive">
          ABERTURA REAL BLOQUEADA em {insuf.map((a) => a.ativo).join(", ")}: capital operacional não cobre a margem de 1 contrato com folga de 30%.
          Posições abertas e simulado não são afetados.
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <div className="text-xs text-muted-foreground">Capital declarado</div>
          <div className="font-mono text-lg">{BRL(c.declarado_brl)}</div>
          {c.data_corte && <div className="text-xs text-muted-foreground">declarado em {String(c.data_corte).slice(8, 10)}/{String(c.data_corte).slice(5, 7)}</div>}
        </div>
        <div><div className="text-xs text-muted-foreground">Resultado desde a declaração ({c.ordens_fechadas} ordens)</div><div className={`font-mono text-lg ${cor(c.realizado_brl)}`}>{BRL(c.realizado_brl)}</div></div>
        <div><div className="text-xs text-muted-foreground">Capital operacional</div><div className={`font-mono text-2xl font-bold ${cor(c.capital_operacional_brl)}`}>{BRL(c.capital_operacional_brl)}</div></div>
      </div>
      {(c as any).ordens_sem_resultado > 0 && (
        <div className="text-sm font-semibold text-destructive">
          {(c as any).ordens_sem_resultado} ordens sem resultado reconciliado — o capital pode estar incompleto
        </div>
      )}
      <div className="text-xs text-muted-foreground">
        Histórico anterior à declaração (não entra na conta do capital): {BRL(c.realizado_historico_brl)} em {c.ordens_fechadas_historico} ordens.
      </div>
      <div className="text-sm">
        <div className="font-semibold">Contratos que o capital sustenta</div>
        <ul>{c.capacidade.map((a) => (
          <li key={a.ativo} className={a.insuficiente ? "text-destructive font-semibold" : ""}>
            {a.ativo}: {a.contratos == null ? "margem não cadastrada" : `${a.contratos} contrato${a.contratos === 1 ? "" : "s"}`}
            {a.minimo_brl != null && <span className="text-muted-foreground"> · mínimo {BRL(a.minimo_brl)} (margem {BRL(a.margem_brl)} × 1,30)</span>}
          </li>
        ))}</ul>
      </div>
      <div className="rounded bg-muted/40 p-2 text-sm">
        <div>Conferência MT5: patrimônio {c.mt5.patrimonio_brl == null ? "—" : BRL(c.mt5.patrimonio_brl)} · capital operacional {BRL(c.capital_operacional_brl)} · diferença {c.diferenca_brl == null ? "—" : BRL(c.diferenca_brl)}</div>
        <div className="text-xs text-muted-foreground">O MT5 mostra o patrimônio da conta; a diferença esperada é garantia e valor não liberado. Observe se ela mudar de forma inesperada.</div>
      </div>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Input type="date" value={data} onChange={(e) => setData(e.target.value)} className="w-40" />
        <select value={tipo} onChange={(e) => setTipo(e.target.value as any)} className="h-9 rounded border border-border bg-background px-2 text-sm">
          <option value="aporte">Aporte</option><option value="retirada">Retirada</option><option value="ajuste">Ajuste</option>
        </select>
        <Input placeholder="Valor (R$)" value={valor} onChange={(e) => setValor(e.target.value)} className="w-32" />
        <Input placeholder="Observação" value={obs} onChange={(e) => setObs(e.target.value)} className="w-64" />
        <Button type="submit" disabled={m.isPending || !valor}>Lançar</Button>
      </form>
      <p className="text-xs text-muted-foreground">Lançamentos não se editam nem se apagam; para corrigir, lance um ajuste (positivo ou negativo).</p>
      <table className="w-full text-sm">
        <thead className="text-left text-muted-foreground"><tr><th>Data</th><th>Tipo</th><th>Valor</th><th>Observação</th></tr></thead>
        <tbody>
          {c.lancamentos.length === 0 && <tr><td colSpan={4} className="py-2 text-muted-foreground">Nenhum lançamento ainda.</td></tr>}
          {c.lancamentos.map((l: any) => (
            <tr key={l.id} className="border-t border-border">
              <td>{new Date(l.data + "T12:00:00").toLocaleDateString("pt-BR")}</td><td>{l.tipo}</td>
              <td className={`font-mono ${cor(Number(l.valor_brl))}`}>{BRL(Number(l.valor_brl))}</td><td>{l.observacao ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
