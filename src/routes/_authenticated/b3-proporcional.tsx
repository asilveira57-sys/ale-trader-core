import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listProporcional, confirmarProporcional, desfazerProporcional } from "@/lib/b3-proporcional.functions";
import { resolverLimites } from "@/lib/b3-proporcional";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/b3-proporcional")({
  head: () => ({
    meta: [
      { title: "Limites proporcionais — B3" },
      { name: "description", content: "Proposta de conversão dos limites fixos em reais para percentuais do capital e do stop." },
      { property: "og:title", content: "Limites proporcionais — B3" },
      { property: "og:description", content: "Converter limites fixos em percentuais, com confirmação por robô." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

const brl = (n: number | null | undefined) =>
  n == null || !Number.isFinite(Number(n)) ? "—" : Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pctFmt = (n: number | null) => (n == null ? "—" : `${n.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`);
const r2 = (n: number) => Math.round(n * 100) / 100;

function proposta(l: any, capRef: number) {
  const byCap = (v: any) => (v != null && Number(v) > 0 && capRef > 0 ? r2((Number(v) / capRef) * 100) : null);
  const stop = Number(l.stop_pts) || 0;
  const byStop = (v: any) => (v != null && Number(v) > 0 && stop > 0 ? r2((Number(v) / stop) * 100) : null);
  const m = Number(l.margem_contrato_brl);
  return {
    peak_lock_min_profit_pct: byCap(l.peak_lock_min_profit_brl),
    daily_gain_target_pct: byCap(l.daily_gain_target_brl),
    daily_loss_limit_pct: byCap(l.daily_loss_limit_brl),
    risco_contratos_pct: m > 0 && capRef > 0 && Number(l.max_contracts) > 0 ? r2((Number(l.max_contracts) * m / capRef) * 100) : null,
    trailing_activation_pct_stop: byStop(l.trailing_activation_pts),
    trailing_giveback_pct_stop: byStop(l.trailing_giveback_pts),
    breakeven_ativa_pct_stop: byStop(l.breakeven_ativa_pts),
    breakeven_folga_pct_stop: byStop(l.breakeven_folga_pts),
  };
}

function Page() {
  const qc = useQueryClient();
  const list = useServerFn(listProporcional);
  const conf = useServerFn(confirmarProporcional);
  const undo = useServerFn(desfazerProporcional);
  const q = useQuery({ queryKey: ["b3-proporcional"], queryFn: () => list() });
  const [capRef, setCapRef] = useState<Record<string, string>>({});
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [pend, setPend] = useState<any[] | null>(null);
  const [filtro, setFiltro] = useState("");

  const linhas = useMemo(() => (q.data?.linhas ?? []).filter((l: any) =>
    !filtro || `${l.symbol} ${l.variant} ${l.mode}`.toLowerCase().includes(filtro.toLowerCase())), [q.data, filtro]);

  const itemDe = (l: any) => {
    const ref = Number(capRef[l.id] ?? l.proporcional_capital_ref_brl ?? l.capital_atual_brl ?? 0);
    return { l, ref, pcts: proposta(l, ref) };
  };

  const executar = async () => {
    if (!pend) return;
    try {
      await conf({ data: { itens: pend.map((p) => ({ id: p.l.id, capital_ref_brl: p.ref > 0 ? p.ref : null, pcts: p.pcts })) } });
      toast.success(`${pend.length} robô(s) passaram ao modelo proporcional.`);
      setPend(null); setSel(new Set());
      qc.invalidateQueries({ queryKey: ["b3-proporcional"] });
    } catch (e: any) { toast.error(e?.message ?? "Falhou"); }
  };

  const conta = q.data?.conta;
  return (
    <div className="space-y-4 p-4">
      <h1 className="text-2xl font-bold">Limites proporcionais</h1>
      <p className="text-sm text-muted-foreground">
        Proposta de conversão. Nada vale antes de você confirmar. Dinheiro vira % do capital da carteira simulada do robô; pontos viram % do stop. Contratos = capital × risco% ÷ margem do ativo (sem margem cadastrada, continua fixo).
      </p>
      {conta && (
        <div className="rounded-md border p-3 text-sm">
          <b>Conta real — capital usado no cálculo: {brl(conta.capital_aceito ?? conta.capital_liquido)}</b>
          {conta.capital_pendente != null && (
            <div className="mt-1 font-semibold text-destructive">
              Em quarentena: o MetaTrader leu {brl(conta.capital_pendente)} (alta acima de 30%). Mantido o valor anterior — leitura {conta.capital_pendente_leituras}/3.
            </div>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Filtrar ativo, modalidade, modo" value={filtro} onChange={(e) => setFiltro(e.target.value)} className="max-w-xs" />
        <Button disabled={sel.size === 0} onClick={() => setPend(linhas.filter((l: any) => sel.has(l.id)).map(itemDe))}>
          Confirmar selecionados ({sel.size})
        </Button>
      </div>
      {q.isLoading ? <p>Carregando…</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th></th><th>Robô</th><th>Capital de referência</th>
                <th>Piso do pico</th><th>Meta do dia</th><th>Perda diária</th><th>Contratos</th>
                <th>Trailing ativa / devolve</th><th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l: any) => {
                const it = itemDe(l);
                const calc = resolverLimites({ ...l, ...it.pcts, limites_proporcionais: true }, l.capital_atual_brl, l.stop_pts, { margemContrato: l.margem_contrato_brl });
                const cel = (fixo: any, p: number | null, novo: any, isBrl = true) => (
                  <td className="py-1 pr-3 align-top">
                    <div>{isBrl ? brl(fixo) : (fixo ?? "—")}</div>
                    <div className="text-muted-foreground">{pctFmt(p)} → {isBrl ? brl(novo) : (novo ?? "—")}</div>
                  </td>
                );
                return (
                  <tr key={l.id} className="border-t">
                    <td className="py-1 pr-2 align-top">
                      <Checkbox checked={sel.has(l.id)} onCheckedChange={(v) => {
                        const s = new Set(sel); v ? s.add(l.id) : s.delete(l.id); setSel(s);
                      }} />
                    </td>
                    <td className="py-1 pr-3 align-top font-semibold">{l.symbol} · {l.variant} · {l.mode}</td>
                    <td className="py-1 pr-3 align-top">
                      <Input className="h-8 w-28" inputMode="decimal"
                        value={capRef[l.id] ?? String(it.ref || "")}
                        onChange={(e) => setCapRef({ ...capRef, [l.id]: e.target.value.replace(",", ".") })} />
                      <div className="text-xs text-muted-foreground">capital usado hoje: {brl(l.capital_atual_brl)}</div>
                    </td>
                    {cel(l.peak_lock_min_profit_brl, it.pcts.peak_lock_min_profit_pct, calc.peak_lock_min_profit_brl)}
                    {cel(l.daily_gain_target_brl, it.pcts.daily_gain_target_pct, calc.daily_gain_target_brl)}
                    {cel(l.daily_loss_limit_brl, it.pcts.daily_loss_limit_pct, calc.daily_loss_limit_brl)}
                    <td className="py-1 pr-3 align-top">
                      <div>{l.max_contracts}</div>
                      <div className="text-muted-foreground">
                        {l.margem_contrato_brl ? `${pctFmt(it.pcts.risco_contratos_pct)} → ${calc.max_contracts}` : "sem margem do ativo — fixo"}
                      </div>
                    </td>
                    <td className="py-1 pr-3 align-top">
                      <div>{l.trailing_activation_pts ?? "—"} / {l.trailing_giveback_pts ?? "—"} pts</div>
                      <div className="text-muted-foreground">{pctFmt(it.pcts.trailing_activation_pct_stop)} / {pctFmt(it.pcts.trailing_giveback_pct_stop)} do stop ({l.stop_pts})</div>
                    </td>
                    <td className="py-1 align-top">
                      {l.limites_proporcionais ? (
                        <div className="space-y-1"><div className="font-semibold">proporcional</div>
                          <Button size="sm" variant="outline" onClick={async () => {
                            await undo({ data: { id: l.id } }); toast.success("Voltou ao modelo fixo.");
                            qc.invalidateQueries({ queryKey: ["b3-proporcional"] });
                          }}>Desfazer</Button></div>
                      ) : (
                        <Button size="sm" onClick={() => setPend([it])}>Confirmar</Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <AlertDialog open={!!pend} onOpenChange={(o) => !o && setPend(null)}>
        <AlertDialogContent className="max-h-[80vh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>Passar {pend?.length} robô(s) ao modelo proporcional</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                {pend?.map((p) => (
                  <div key={p.l.id} className="border-b pb-1">
                    <b>{p.l.symbol} · {p.l.variant} · {p.l.mode}</b> — referência {brl(p.ref)}<br />
                    Piso do pico {brl(p.l.peak_lock_min_profit_brl)} → {pctFmt(p.pcts.peak_lock_min_profit_pct)};
                    Meta {brl(p.l.daily_gain_target_brl)} → {pctFmt(p.pcts.daily_gain_target_pct)};
                    Perda {brl(p.l.daily_loss_limit_brl)} → {pctFmt(p.pcts.daily_loss_limit_pct)}
                  </div>
                ))}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={executar}>Confirmar {pend?.length}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
