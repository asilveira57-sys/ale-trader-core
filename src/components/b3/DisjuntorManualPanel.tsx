import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BRL, SIGNED_BRL } from "@/lib/b3-format";
import { ajustarTetoDisjuntor, destravarDisjuntor, getDisjuntorManual } from "@/lib/b3-disjuntor-manual.functions";

const hora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }) : "—";
const diaHora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(",", " às") : "—";

export function DisjuntorManualPanel() {
  const qc = useQueryClient();
  const load = useServerFn(getDisjuntorManual);
  const destravar = useServerFn(destravarDisjuntor);
  const ajustar = useServerFn(ajustarTetoDisjuntor);
  const { data } = useQuery({ queryKey: ["disjuntor-manual"], queryFn: () => load(), refetchInterval: 15000 });
  const [pctTxt, setPctTxt] = useState<string>("");
  const [confirmar, setConfirmar] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["disjuntor-manual"] });

  const mTeto = useMutation({
    mutationFn: (pct: number) => ajustar({ data: { pct } }),
    onSuccess: () => { toast.success("Teto alterado"); setPctTxt(""); refresh(); },
    onError: (e: any) => toast.error(e.message),
  });
  const mDestravar = useMutation({
    mutationFn: () => destravar(),
    onSuccess: () => { toast.success("Disjuntor destravado"); setConfirmar(false); refresh(); },
    onError: (e: any) => toast.error(e.message),
  });

  if (!data) return null;
  const capAtualPct = Math.round(data.cap_pct * 100);
  const pctDigitado = Number(pctTxt);
  const pctValido = pctTxt !== "" && Number.isInteger(pctDigitado) && pctDigitado >= 1 && pctDigitado <= 95;
  const pctTela = pctValido ? pctDigitado : capAtualPct;
  const tetoBrl = (pctTela / 100) * data.base_brl;
  const folga = tetoBrl + data.result_brl;
  const folgaAtual = data.cap_pct * data.base_brl + data.result_brl;

  const aviso = data.cap_pct > 0.30 ? (
    <div className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm font-medium">
      Teto de perda em {capAtualPct}%, acima do padrão de 25%. Alterado em {diaHora(data.cap_alterado_em)}.
    </div>
  ) : null;

  if (!data.armed) return aviso;

  const kindTxt = data.kind === "gain" || data.kind === "meta" ? "meta de ganho do dia" : "teto de perda do dia";
  return (
    <div className="space-y-2">
      {aviso}
      <div className="rounded-md border border-destructive/60 bg-destructive/10 p-4 space-y-3">
        <div className="font-semibold">Disjuntor acionado às {hora(data.armed_at)} — {kindTxt}</div>
        <div className="grid grid-cols-[auto_auto] gap-x-6 gap-y-1 text-sm w-fit">
          <span className="text-muted-foreground">Base do cálculo</span><span className="font-mono">{BRL(data.base_brl)}</span>
          <span className="text-muted-foreground">Resultado do dia</span><span className="font-mono">{SIGNED_BRL(data.result_brl)}</span>
          <span className="text-muted-foreground">Teto configurado</span><span className="font-mono">{pctTela}% = {BRL(tetoBrl)}</span>
          <span className="text-muted-foreground">Folga até rearmar</span>
          <span className={`font-mono font-semibold ${folga > 0 ? "text-success" : "text-destructive"}`}>{BRL(folga)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">Teto (%)</span>
          <Input className="h-8 w-20" inputMode="numeric" placeholder={String(capAtualPct)} value={pctTxt}
            onChange={(e) => setPctTxt(e.target.value.replace(/\D/g, ""))} />
          <Button size="sm" variant="outline" disabled={!pctValido || pctDigitado === capAtualPct || mTeto.isPending}
            onClick={() => { if (confirm(`Alterar teto de ${capAtualPct}% para ${pctDigitado}%? Folga passa a ser ${BRL(folga)}.`)) mTeto.mutate(pctDigitado); }}>
            Gravar teto
          </Button>
        </div>
        {folgaAtual <= 0 ? (
          <div className="space-y-1">
            <Button size="sm" variant="destructive" disabled>Destravar disjuntor</Button>
            <div className="text-sm text-destructive">sem folga — o disjuntor rearma no próximo tique. Ajuste o teto antes.</div>
          </div>
        ) : confirmar ? (
          <div className="rounded border border-border p-3 space-y-2 text-sm">
            <div>Destravar com: base {BRL(data.base_brl)} · resultado {SIGNED_BRL(data.result_brl)} · teto {capAtualPct}% = {BRL(data.cap_pct * data.base_brl)} · folga {BRL(folgaAtual)}</div>
            <div className="flex gap-2">
              <Button size="sm" variant="destructive" disabled={mDestravar.isPending} onClick={() => mDestravar.mutate()}>Confirmar</Button>
              <Button size="sm" variant="outline" onClick={() => setConfirmar(false)}>Cancelar</Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="destructive" onClick={() => setConfirmar(true)}>Destravar disjuntor</Button>
        )}
      </div>
    </div>
  );
}
