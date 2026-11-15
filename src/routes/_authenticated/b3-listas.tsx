// PARIDADE ENTRE MODALIDADES (pedido do dono 08/11 e 15/11; substitui "Resultado por
// combinação"). Responde: o que é bom numa modalidade também é bom na outra?
// Tudo por 1 contrato e com freio; números prontos do banco (migration 0035).
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getB3Paridade } from "@/lib/b3-listas.functions";
import { BRL } from "@/lib/b3-format";
import { vLabel, todayBrt, daysAgoBrt } from "@/lib/b3-listas-format";
import { robotLabel } from "@/lib/b3-cockpit-labels";
import { useModeApelidos } from "@/hooks/use-mode-apelidos";
import { copiarTexto, tabular } from "@/lib/b3-copiar";
import { Button } from "@/components/ui/button";
import { Copy } from "lucide-react";

export const Route = createFileRoute("/_authenticated/b3-listas")({
  head: () => ({
    meta: [
      { title: "Paridade entre modalidades — AleTrader AI" },
      { name: "description", content: "Resultado por 1 contrato de cada modalidade e modo, e quanto as modalidades andam juntas nos mesmos pregões." },
      { property: "og:title", content: "Paridade entre modalidades — AleTrader AI" },
      { property: "og:description", content: "Matriz modalidade × modo por 1 contrato e pares de modalidades." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ParidadePage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Erro: {String((error as any)?.message ?? error)}</div>,
});

const MODOS = ["conservador", "cauteloso", "moderado", "equilibrado", "semi_agressivo", "arrojado", "agressivo", "enoir"];
const PERIODOS = [{ k: "5", label: "5 dias", dias: 7 }, { k: "15", label: "15 dias", dias: 21 }, { k: "30", label: "30 dias", dias: 42 }] as const;
const money = (v: any) => (v == null ? "—" : BRL(Number(v)));
const tone = (v: any) => (v == null ? "" : Number(v) > 0 ? "text-success" : Number(v) < 0 ? "text-destructive" : "");
const base = (m: string) => m.replace(/_sc$/, "");

function ParidadePage() {
  useModeApelidos();
  const fn = useServerFn(getB3Paridade);
  const [symbol, setSymbol] = useState<"WIN" | "WDO" | "BIT">("WIN");
  const [periodo, setPeriodo] = useState<(typeof PERIODOS)[number]["k"]>("15");
  const dias = PERIODOS.find((p) => p.k === periodo)!.dias;
  const de = daysAgoBrt(dias), ate = todayBrt();
  const q = useQuery({ queryKey: ["b3-paridade", symbol, de, ate], queryFn: () => fn({ data: { de, ate, symbol } }), staleTime: 60_000 });
  const matriz = q.data?.matriz ?? [];
  const variants = [...new Set(matriz.map((r) => r.variant))].sort();
  const cell = (v: string, m: string) => matriz.find((r) => r.variant === v && base(r.mode) === m);
  const totalVar = (v: string) => matriz.filter((r) => r.variant === v).reduce((s, r) => s + Number(r.resultado_1c), 0);
  const totalModo = (m: string) => matriz.filter((r) => base(r.mode) === m).reduce((s, r) => s + Number(r.resultado_1c), 0);
  const pares = [...(q.data?.pares ?? [])].sort((a, b) => Number(b.juntos_pct ?? -1) - Number(a.juntos_pct ?? -1));
  const copy = () => copiarTexto(`Paridade ${symbol} · ${de} a ${ate} · por 1 contrato, com freio\n\n` +
    tabular(["Modo", ...variants.map(vLabel), "Total"], MODOS.map((m) => [robotLabel(m), ...variants.map((v) => money(cell(v, m)?.resultado_1c)), money(totalModo(m))])) +
    "\n\nPares de modalidades (mesmos pregões)\n" + tabular(["Par", "Pregões", "Andaram juntas", "Correlação"], pares.map((p) => [`${vLabel(p.variant_a)} × ${vLabel(p.variant_b)}`, String(p.pregoes), `${p.juntos} (${p.juntos_pct ?? "—"}%)`, p.correlacao == null ? "—" : String(p.correlacao)])));

  return (
    <div className="space-y-4 p-4 md:p-6">
      <h1 className="text-2xl font-bold">Paridade entre modalidades</h1>
      <div className="flex flex-wrap items-center gap-2">
        {(["WIN", "WDO", "BIT"] as const).map((s) => <Button key={s} className="min-h-9" variant={symbol === s ? "default" : "outline"} onClick={() => setSymbol(s)}>{s}</Button>)}
        <span className="mx-2 text-muted-foreground">|</span>
        {PERIODOS.map((p) => <Button key={p.k} className="min-h-9" variant={periodo === p.k ? "default" : "outline"} onClick={() => setPeriodo(p.k)}>{p.label}</Button>)}
        <Button variant="outline" className="ml-auto min-h-9" disabled={!q.data} onClick={copy}><Copy className="size-4" />Copiar</Button>
      </div>
      <p className="text-xs text-muted-foreground">{de} a {ate} · resultado por 1 contrato, só ordens com freio (o que a conta real faria).</p>
      {q.isPending ? <p>Carregando…</p> : q.isError ? <p role="alert" className="text-destructive">Não foi possível ler a paridade.</p> : !matriz.length ? <p>sem ordens neste período</p> : <>
        <section className="overflow-x-auto rounded-lg border">
          <h2 className="px-3 pt-2 font-semibold">Modalidade × modo (R$ por 1 contrato)</h2>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted-foreground"><th className="p-2">Modo</th>{variants.map((v) => <th key={v} className="p-2 text-right">{vLabel(v)}</th>)}<th className="p-2 text-right">Total</th></tr></thead>
            <tbody>
              {MODOS.map((m) => <tr key={m} className="border-t">
                <td className="p-2 font-medium">{robotLabel(m)}</td>
                {variants.map((v) => { const c = cell(v, m); return <td key={v} className={`p-2 text-right font-mono ${tone(c?.resultado_1c)}`} title={c ? `${c.ordens} ordens · acerto ${c.acerto_pct ?? "—"}% · ${c.pregoes} pregões` : "sem ordens"}>{c ? money(c.resultado_1c) : "—"}</td>; })}
                <td className={`p-2 text-right font-mono font-bold ${tone(totalModo(m))}`}>{money(totalModo(m))}</td>
              </tr>)}
              <tr className="border-t-2 font-bold"><td className="p-2">Total</td>{variants.map((v) => <td key={v} className={`p-2 text-right font-mono ${tone(totalVar(v))}`}>{money(totalVar(v))}</td>)}<td /></tr>
            </tbody>
          </table>
          <p className="px-3 pb-2 text-xs text-muted-foreground">Passe o mouse na célula para ver ordens, acerto e pregões. Price action SC usa o mesmo modo sem o sufixo.</p>
        </section>
        <section className="overflow-x-auto rounded-lg border">
          <h2 className="px-3 pt-2 font-semibold">As modalidades andam juntas?</h2>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted-foreground"><th className="p-2">Par</th><th className="p-2 text-right">Pregões em comum</th><th className="p-2 text-right">Mesmo sinal</th><th className="p-2 text-right">Correlação</th><th className="p-2 text-right">Resultado A</th><th className="p-2 text-right">Resultado B</th></tr></thead>
            <tbody>{pares.map((p) => <tr key={`${p.variant_a}|${p.variant_b}`} className="border-t">
              <td className="p-2">{vLabel(p.variant_a)} × {vLabel(p.variant_b)}</td>
              <td className="p-2 text-right">{p.pregoes}</td>
              <td className="p-2 text-right">{p.juntos} ({p.juntos_pct ?? "—"}%)</td>
              <td className="p-2 text-right font-mono">{p.correlacao ?? "—"}</td>
              <td className={`p-2 text-right font-mono ${tone(p.resultado_a_1c)}`}>{money(p.resultado_a_1c)}</td>
              <td className={`p-2 text-right font-mono ${tone(p.resultado_b_1c)}`}>{money(p.resultado_b_1c)}</td>
            </tr>)}</tbody>
          </table>
          <p className="px-3 pb-2 text-xs text-muted-foreground">Mesmo sinal = pregões em que as duas ganharam ou as duas perderam. Correlação perto de 1: andam juntas; perto de −1: uma compensa a outra; perto de 0: independentes. Com poucos pregões em comum, não conclua nada.</p>
        </section>
      </>}
    </div>
  );
}
