import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { readRobosIndicados, type RoboIndicado } from "@/lib/b3-robos-indicados.functions";
import { ligarRobosReais, desligarRobosReais } from "@/lib/prd-authorization.functions";
import { variantLabel, modeLabel } from "@/lib/b3-asset-export";
import { STOPS_POR_DIA } from "@/lib/b3-real-sizing";
import { copiarTexto, tabular } from "@/lib/b3-copiar";

export const Route = createFileRoute("/_authenticated/b3-robos-indicados")({
  head: () => ({ meta: [{ title: "Robôs indicados — B3" }, { name: "description", content: "Ranking dos robôs por resultado por 1 contrato." }] }),
  component: Page,
});

const PREGOES = [1, 2, 3, 5, 10, 15, 30] as const;
const ATIVOS = ["WIN", "WDO", "BIT"] as const;
const brl = (n: number | null | undefined) => n == null ? "—" : Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
const cor = (n: number | null | undefined) => n == null ? "" : n > 0 ? "text-success" : n < 0 ? "text-destructive" : "";
const chave = (r: RoboIndicado) => `${r.raiz}|${r.variant}|${r.mode}`;
const dataBr = (d: string | null) => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : "—";

function Page() {
  const qc = useQueryClient();
  const [ativo, setAtivo] = useState<(typeof ATIVOS)[number]>("WIN");
  const [pregoes, setPregoes] = useState<number | null>(10);
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [acao, setAcao] = useState<null | "ligar" | "desligar">(null);
  const [senha, setSenha] = useState("");
  const [busy, setBusy] = useState(false);
  const read = useServerFn(readRobosIndicados);
  const ligar = useServerFn(ligarRobosReais);
  const desligar = useServerFn(desligarRobosReais);
  const porData = pregoes == null;
  const args = { roots: [ativo], pregoes: porData ? null : pregoes, inicio: porData && inicio ? inicio : null, fim: porData && fim ? fim : null };
  const q = useQuery({
    queryKey: ["robos-indicados", args],
    queryFn: () => read({ data: args }),
    enabled: !porData || !!inicio,
    staleTime: 60_000,
  });
  const robos = q.data?.robos ?? [];
  const selecionados = useMemo(() => robos.filter((r) => sel.has(chave(r))), [robos, sel]);
  const todos = robos.length > 0 && selecionados.length === robos.length;
  const toggle = (r: RoboIndicado) => setSel((s) => { const n = new Set(s); n.has(chave(r)) ? n.delete(chave(r)) : n.add(chave(r)); return n; });
  const alvo = acao === "ligar" ? selecionados.filter((r) => !r.real) : selecionados.filter((r) => r.real);

  async function executar() {
    setBusy(true);
    try {
      if (acao === "desligar") {
        const r = await desligar({ data: { items: alvo.map((x) => ({ symbol: x.raiz as never, variant: x.variant, mode: x.mode as never })) } });
        toast.success(`${r.changed} robô(s) fora do real`);
      } else {
        const r = await ligar({ data: { password: senha, items: alvo.map((x) => ({ symbol: x.raiz as never, variant: x.variant, mode: x.mode as never })) } });
        if (!r.ok) { toast.error(`Nada foi alterado. ${r.falhas.slice(0, 4).join(" · ")}`); setBusy(false); return; }
        toast.success(`${r.changed} robô(s) autorizados no real`);
      }
      setAcao(null); setSenha(""); setSel(new Set());
      qc.invalidateQueries({ queryKey: ["robos-indicados"] });
      qc.invalidateQueries({ queryKey: ["b3-cockpit"] });
    } catch (e: any) {
      toast.error(String(e?.message ?? e));
    } finally { setBusy(false); }
  }

  const copiar = () => copiarTexto(`Robôs indicados · ${ativo} · ${q.data?.periodo.pregoes ?? 0} pregões (${dataBr(q.data?.periodo.inicio ?? null)} a ${dataBr(q.data?.periodo.fim ?? null)}) · por 1 contrato\n` +
    tabular(["#", "robô", "real", "com freio", "sem freio", "ordens", "acerto", "dias +", "pior dia", "maior queda"],
      robos.map((r, i) => [String(i + 1), `${variantLabel(r.variant)} · ${modeLabel(r.mode)}`, r.real ? "sim" : "não", brl(r.resultado), brl(r.resultado_sem_freio),
        String(r.ordens), r.ordens ? `${Math.round(r.ganhos / r.ordens * 100)}%` : "—", `${r.dias_positivos}/${r.dias}`, brl(r.pior_dia), brl(r.maior_queda)])));

  return <section className="space-y-3 p-3 md:p-6">
    <div className="flex flex-wrap items-center gap-2">
      <h1 className="text-xl font-black">Robôs indicados</h1>
      <span className="text-xs text-muted-foreground">ranking por resultado com freio · por 1 contrato</span>
      <Button variant="outline" className="ml-auto min-h-11" onClick={copiar} disabled={!robos.length}>Copiar</Button>
    </div>

    <div className="flex flex-wrap items-center gap-2 text-sm">
      {ATIVOS.map((a) => <Button key={a} size="sm" className="min-h-11" variant={ativo === a ? "default" : "outline"} onClick={() => { setAtivo(a); setSel(new Set()); }}>{a}</Button>)}
      <span className="mx-1 text-muted-foreground">|</span>
      {PREGOES.map((n) => <Button key={n} size="sm" className="min-h-11" variant={pregoes === n ? "default" : "outline"} onClick={() => setPregoes(n)}>{n} {n === 1 ? "pregão" : "pregões"}</Button>)}
      <Button size="sm" className="min-h-11" variant={porData ? "default" : "outline"} onClick={() => setPregoes(null)}>Entre datas</Button>
      {porData && <>
        <Input type="date" aria-label="Data inicial" value={inicio} onChange={(e) => setInicio(e.target.value)} className="h-11 w-40" />
        <Input type="date" aria-label="Data final" value={fim} onChange={(e) => setFim(e.target.value)} className="h-11 w-40" />
      </>}
    </div>

    {q.data && <p className="text-xs text-muted-foreground">
      {q.data.periodo.pregoes} pregões com ordem: {dataBr(q.data.periodo.inicio)} a {dataBr(q.data.periodo.fim)} · {robos.length} robôs · {robos.filter((r) => r.real).length} no real
    </p>}

    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-y border-border bg-background py-2 text-sm">
      <label className="flex min-h-11 items-center gap-2"><Checkbox checked={todos} onCheckedChange={(v) => setSel(v ? new Set(robos.map(chave)) : new Set())} aria-label="Selecionar todos" />Todos</label>
      <span className="text-muted-foreground">{selecionados.length} selecionado(s)</span>
      <Button className="min-h-11" disabled={!selecionados.some((r) => !r.real)} onClick={() => setAcao("ligar")}>Autorizar no real</Button>
      <Button className="min-h-11" variant="outline" disabled={!selecionados.some((r) => r.real)} onClick={() => setAcao("desligar")}>Tirar do real</Button>
    </div>

    {(porData && !inicio) ? <p className="text-sm">Escolha a data inicial.</p>
      : q.isPending ? <p className="text-sm">Carregando…</p>
      : q.isError ? <p className="text-sm" role="alert">{String((q.error as any)?.message ?? "Não foi possível ler o ranking.")}</p>
      : !robos.length ? <p className="text-sm">Sem ordens no período.</p>
      : <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-[11px] text-muted-foreground">
            <tr><th className="p-1"></th><th className="p-1">#</th><th className="p-1">Robô</th><th className="p-1 text-right">Com freio</th><th className="p-1 text-right">Sem freio</th><th className="p-1 text-right">Ordens</th><th className="p-1 text-right">Acerto</th><th className="p-1 text-right">Dias +</th><th className="p-1 text-right">Pior dia</th><th className="p-1 text-right">Maior queda</th></tr>
          </thead>
          <tbody>
            {robos.map((r, i) => <tr key={chave(r)} className={`border-t border-border ${sel.has(chave(r)) ? "bg-primary/10" : ""}`} onClick={() => toggle(r)}>
              <td className="p-1" onClick={(e) => e.stopPropagation()}><Checkbox checked={sel.has(chave(r))} onCheckedChange={() => toggle(r)} aria-label={`Selecionar ${modeLabel(r.mode)}`} /></td>
              <td className="p-1 font-mono font-bold">{i + 1}º</td>
              <td className="p-1">
                <span className={`mr-1.5 inline-block size-2.5 rounded-full ${r.real ? "bg-emerald-500" : "bg-muted-foreground/30"}`} title={r.real ? "Autorizado no real" : "Só simulado"} />
                <span className="font-semibold">{variantLabel(r.variant)}</span> · {modeLabel(r.mode)}
                {r.real && <span className="ml-1 rounded bg-emerald-500/15 px-1 text-[10px] font-bold text-emerald-600">REAL</span>}
              </td>
              <td className={`p-1 text-right font-mono font-bold ${cor(r.resultado)}`}>{brl(r.resultado)}</td>
              <td className={`p-1 text-right font-mono ${cor(r.resultado_sem_freio)}`}>{brl(r.resultado_sem_freio)}</td>
              <td className="p-1 text-right font-mono">{r.ordens}</td>
              <td className="p-1 text-right font-mono">{r.ordens ? `${Math.round(r.ganhos / r.ordens * 100)}%` : "—"}</td>
              <td className="p-1 text-right font-mono">{r.dias_positivos}/{r.dias}</td>
              <td className={`p-1 text-right font-mono ${cor(r.pior_dia)}`}>{brl(r.pior_dia)}</td>
              <td className={`p-1 text-right font-mono ${cor(r.maior_queda)}`}>{brl(r.maior_queda)}</td>
            </tr>)}
          </tbody>
        </table>
        <p className="mt-2 text-[11px] text-muted-foreground">Com freio = só ordens que valeram. Dias + = pregões positivos / pregões com ordem. Maior queda = maior recuo do acumulado dentro do período.</p>
      </div>}

    <Dialog open={!!acao} onOpenChange={(o) => { if (!o) { setAcao(null); setSenha(""); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{acao === "ligar" ? `Autorizar ${alvo.length} robô(s) no real` : `Tirar ${alvo.length} robô(s) do real`}</DialogTitle>
          <DialogDescription>
            {acao === "ligar"
              ? `Cada robô passa a espelhar ordens com dinheiro real, ${STOPS_POR_DIA} stops de perda diária e a quantidade já cadastrada (mínimo 1 contrato). Se algum não passar nas checagens, nenhum é ligado.`
              : "Os robôs deixam de abrir ordens reais. Posição real aberta não é fechada por aqui."}
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-48 overflow-y-auto text-sm">{alvo.map((r) => <li key={chave(r)}>{variantLabel(r.variant)} · {modeLabel(r.mode)} · {brl(r.resultado)}</li>)}</ul>
        {acao === "ligar" && <Input type="password" autoComplete="current-password" placeholder="Senha mestra" value={senha} onChange={(e) => setSenha(e.target.value)} className="h-11" />}
        <DialogFooter>
          <Button variant="outline" className="min-h-11" onClick={() => { setAcao(null); setSenha(""); }}>Cancelar</Button>
          <Button className="min-h-11" disabled={busy || !alvo.length || (acao === "ligar" && !senha)} onClick={executar}>{busy ? "Aplicando…" : "Confirmar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
