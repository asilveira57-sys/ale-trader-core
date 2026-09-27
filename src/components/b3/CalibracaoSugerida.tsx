import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { listCalibracao, aplicarCalibracao } from "@/lib/b3-calibracao.functions";
import { CalibracaoConfirm, MULT, type CalibLinha } from "./CalibracaoConfirm";
import { rootSymbol } from "@/lib/b3-format";

// Linha discreta no card do robô: só aparece com sugestão confiável, ainda não
// aplicada, para robô com configuração no simulado. Sem sugestão, nada.
export function CalibracaoSugerida({ symbol, variant, mode }: { symbol: string; variant: string; mode: string }) {
  const qc = useQueryClient();
  const list = useServerFn(listCalibracao);
  const aplicar = useServerFn(aplicarCalibracao);
  const q = useQuery({ queryKey: ["b3-calibracao"], queryFn: () => list(), staleTime: 5 * 60_000 });
  const [open, setOpen] = useState(false);
  const m = useMutation({
    mutationFn: (id: string) => aplicar({ data: { ids: [id] } }),
    onSuccess: () => { toast.success("Calibração aplicada no simulado"); setOpen(false); qc.invalidateQueries({ queryKey: ["b3-calibracao"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const l = ((q.data?.linhas ?? []) as CalibLinha[]).find((x) =>
    rootSymbol(x.symbol) === rootSymbol(symbol) && x.variant === variant && x.mode === mode);
  if (!l || !l.confiavel || l.aplicado || !l.tem_config) return null;
  return (
    <div className="px-3 pb-1 text-[10px] text-muted-foreground">
      Calibração sugerida: multiplicador {MULT(l.mult_vigente ?? l.mult_atual)} → {MULT(l.mult_sugerido)}{" "}
      <button type="button" className="underline hover:text-foreground" onClick={() => setOpen(true)}>[aplicar]</button>
      <CalibracaoConfirm linhas={[l]} open={open} onOpenChange={setOpen} pending={m.isPending} onConfirm={() => m.mutate(l.id)} />
    </div>
  );
}
