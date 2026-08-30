// Lista 2 — extrato do dinheiro real, cronológico, em tabela.
// Somente leitura. O pareamento abertura/fechamento vem do livro FIFO do
// cockpit real, por raiz do ativo + magic.
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getB3ExtratoReal } from "@/lib/b3-listas.functions";
import { BRL, SIGNED_BRL } from "@/lib/b3-format";
import { useModeApelidos } from "@/hooks/use-mode-apelidos";
import { ModeName } from "@/components/b3/ModeName";
import { vLabel, downloadCsv, printPage, dm, hm, todayBrt, daysAgoBrt } from "@/lib/b3-listas-format";
import { Button } from "@/components/ui/button";
import { Receipt, Download, Printer, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/b3-extrato-real")({
  head: () => ({
    meta: [
      { title: "Extrato do Dinheiro Real — AleTrader AI" },
      { name: "description", content: "Extrato cronológico das operações reais encerradas na corretora, com ticket, preços, resultado e quem fechou cada operação." },
      { property: "og:title", content: "Extrato do Dinheiro Real — AleTrader AI" },
      { property: "og:description", content: "Operações reais encerradas com totais por dia e por robô, exportáveis em CSV e PDF." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ExtratoRealPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Erro: {String((error as any)?.message ?? error)}</div>,
  notFoundComponent: () => <div className="p-6">Não encontrado.</div>,
});

const PX = (v: number | null) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 }));

function ExtratoRealPage() {
  const fn = useServerFn(getB3ExtratoReal);
  const apelidos = useModeApelidos();
  const mText = (m?: string | null) => {
    if (!m) return "—";
    const t = apelidos.tech(m), n = apelidos.nick(m);
    return t && t !== n ? `${n} (${t})` : n;
  };
  const [de, setDe] = useState(daysAgoBrt(29));
  const [ate, setAte] = useState(todayBrt());

  const q = useQuery({
    queryKey: ["b3-extrato-real", de, ate],
    queryFn: () => fn({ data: { de, ate } }),
    staleTime: 0,
    gcTime: 0,
  });

  const rows = q.data?.rows ?? [];

  const csv = () =>
    downloadCsv(
      `b3_extrato_real_${de}_a_${ate}.csv`,
      ["Data", "Entrada", "Saída", "Ativo", "Modalidade", "Modo", "Magic", "Lado", "Qtd",
        "Preço entrada", "Preço saída", "Resultado (R$)", "Ticket corretora", "Fechada por"],
      rows.map((r) => [
        r.data, hm(r.entry_time), hm(r.exit_time), r.symbol, vLabel(r.variant), mText(r.mode),
        r.magic_number, r.side === "buy" ? "Compra" : "Venda", r.quantity,
        r.entry_price, r.exit_price, r.result_brl, r.broker_ticket ?? "",
        r.fechada_por === "manual" ? "Manual" : r.fechada_por === "sistema" ? "Sistema" : "Desconhecido",
      ]),
    );

  return (
    <div className="space-y-4 p-4 md:p-6">
      <style>{`@media print { .no-print { display: none !important } body { background: #fff } }`}</style>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Receipt className="size-5" /> Extrato do dinheiro real
          </h1>
          <p className="text-sm text-muted-foreground">
            {dm(de)} a {dm(ate)} · somente operações reais encerradas e confirmadas pela corretora
          </p>
        </div>
        <div className="no-print flex gap-2">
          <Button variant="outline" size="sm" onClick={csv} disabled={!rows.length}>
            <Download className="mr-1 size-4" /> CSV
          </Button>
          <Button variant="outline" size="sm" onClick={printPage} disabled={!rows.length}>
            <Printer className="mr-1 size-4" /> PDF
          </Button>
        </div>
      </header>

      <div className="no-print flex flex-wrap items-end gap-3 rounded-lg border border-border p-3">
        <label className="text-xs text-muted-foreground">
          De
          <input type="date" value={de} max={ate} onChange={(e) => setDe(e.target.value)}
            className="mt-1 block rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground" />
        </label>
        <label className="text-xs text-muted-foreground">
          Até
          <input type="date" value={ate} min={de} onChange={(e) => setAte(e.target.value)}
            className="mt-1 block rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground" />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-border p-3">
          <div className="text-xs text-muted-foreground">Resultado acumulado</div>
          <div className={`text-lg font-semibold tabular-nums ${(q.data?.total_brl ?? 0) >= 0 ? "text-emerald-500" : "text-destructive"}`}>
            {SIGNED_BRL(q.data?.total_brl ?? 0)}
          </div>
        </div>
        <div className="rounded-lg border border-border p-3">
          <div className="text-xs text-muted-foreground">Operações encerradas</div>
          <div className="text-lg font-semibold tabular-nums">{q.data?.total_ops ?? 0}</div>
        </div>
        <div className="rounded-lg border border-border p-3">
          <div className="text-xs text-muted-foreground">Fora da conta (preço não reportado)</div>
          <div className="text-lg font-semibold tabular-nums">{q.data?.sem_preco ?? 0}</div>
        </div>
        <div className="rounded-lg border border-border p-3">
          <div className="text-xs text-muted-foreground">Fechadas na mão</div>
          <div className="text-lg font-semibold tabular-nums">{rows.filter((r) => r.fechada_por === "manual").length}</div>
        </div>
      </div>

      {(q.data?.sem_preco ?? 0) > 0 && (
        <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {q.data?.sem_preco} operação(ões) sem preço executado gravado pela corretora aparecem com “—” e ficam fora do acumulado — tratar como zero mentiria no total.
        </p>
      )}

      {q.isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">Montando o extrato…</div>
      ) : !rows.length ? (
        <div className="p-6 text-sm text-muted-foreground">Nenhuma operação real encerrada nesse período.</div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs">
                <tr>
                  {["Data", "Entrada", "Saída", "Ativo", "Robô", "Magic", "Lado", "Qtd", "Preço entrada", "Preço saída", "Resultado", "Ticket", "Fechada por"].map((h, i) => (
                    <th key={h} className={`whitespace-nowrap px-3 py-2 ${i >= 5 && i <= 10 ? "text-right" : "text-left"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.broker_ticket ?? "s"}-${r.exit_time}-${i}`} className="border-t border-border/60">
                    <td className="whitespace-nowrap px-3 py-1.5">{dm(r.data)}</td>
                    <td className="px-3 py-1.5">{hm(r.entry_time)}</td>
                    <td className="px-3 py-1.5">{hm(r.exit_time)}</td>
                    <td className="whitespace-nowrap px-3 py-1.5">{r.symbol}</td>
                    <td className="whitespace-nowrap px-3 py-1.5">{vLabel(r.variant)} · <ModeName mode={r.mode} api={apelidos} /></td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.magic_number || "—"}</td>
                    <td className={`px-3 py-1.5 text-right ${r.side === "buy" ? "text-emerald-500" : "text-destructive"}`}>
                      {r.side === "buy" ? "Compra" : "Venda"}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.quantity}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{PX(r.entry_price)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{PX(r.exit_price)}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${r.result_brl == null ? "text-muted-foreground" : r.result_brl >= 0 ? "text-emerald-500" : "text-destructive"}`}>
                      {r.result_brl == null ? "—" : SIGNED_BRL(r.result_brl)}
                    </td>
                    <td className="px-3 py-1.5 tabular-nums">{r.broker_ticket ?? "—"}</td>
                    <td className="px-3 py-1.5">
                      {r.fechada_por === "manual" ? "Manual" : r.fechada_por === "sistema" ? "Sistema" : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-border">
              <h2 className="border-b border-border px-3 py-2 text-sm font-semibold">Total por dia</h2>
              <table className="w-full text-sm">
                <tbody>
                  {(q.data?.por_dia ?? []).map((d) => (
                    <tr key={d.data} className="border-t border-border/60">
                      <td className="px-3 py-1.5">{dm(d.data)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{d.ops} ops</td>
                      <td className={`px-3 py-1.5 text-right tabular-nums ${d.resultado_brl >= 0 ? "text-emerald-500" : "text-destructive"}`}>
                        {SIGNED_BRL(d.resultado_brl)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="rounded-lg border border-border">
              <h2 className="border-b border-border px-3 py-2 text-sm font-semibold">Total por robô</h2>
              <table className="w-full text-sm">
                <tbody>
                  {(q.data?.por_robo ?? []).map((b) => (
                    <tr key={b.chave} className="border-t border-border/60">
                      <td className="px-3 py-1.5">{b.root} · {vLabel(b.variant)} · <ModeName mode={b.mode} api={apelidos} /></td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{b.magic_number || "—"}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{b.ops} ops</td>
                      <td className={`px-3 py-1.5 text-right tabular-nums ${b.resultado_brl >= 0 ? "text-emerald-500" : "text-destructive"}`}>
                        {BRL(b.resultado_brl)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
