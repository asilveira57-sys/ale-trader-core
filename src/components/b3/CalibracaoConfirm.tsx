import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { BRL } from "@/lib/b3-format";

export type CalibLinha = {
  id: string; symbol: string; variant: string; mode: string; apelido: string | null;
  mult_atual: number; mult_sugerido: number; ganho_estimado: number; pregoes: number;
  confiavel: boolean; motivo: string | null; aplicado: boolean; aplicado_em: string | null;
  tem_config: boolean; mult_vigente: number | null;
};

export const MULT = (v: any) => Number(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
const VAR = (v: string) => v.replace(/_/g, " ");
const MODE = (m: string) => m.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

export function linhaDePara(l: CalibLinha) {
  return {
    titulo: `${l.symbol.slice(0, 3)} · ${VAR(l.variant)} · ${l.apelido ?? l.mode} (${MODE(l.mode)})`,
    mult: `Multiplicador ${MULT(l.mult_vigente ?? l.mult_atual)} → ${MULT(l.mult_sugerido)}`,
    ganho: `Ganho estimado ${BRL(l.ganho_estimado)} · ${l.pregoes} pregões`,
  };
}

export function CalibracaoConfirm({ linhas, open, onOpenChange, onConfirm, pending }: {
  linhas: CalibLinha[]; open: boolean; onOpenChange: (o: boolean) => void; onConfirm: () => void; pending?: boolean;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-h-[80vh] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>Aplicar calibração no simulado</AlertDialogTitle>
          <AlertDialogDescription>
            {linhas.length} {linhas.length === 1 ? "robô vai mudar" : "robôs vão mudar"}. Só o simulado; o real não é tocado. Dá para desfazer depois.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="space-y-2 text-sm">
          {linhas.map((l) => {
            const d = linhaDePara(l);
            return (
              <li key={l.id} className="rounded border border-border p-2">
                <div className="font-semibold">{d.titulo}</div>
                <div>{d.mult}</div>
                <div className="text-muted-foreground">{d.ganho}</div>
              </li>
            );
          })}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction disabled={pending} onClick={(e) => { e.preventDefault(); onConfirm(); }}>
            Aplicar {linhas.length} {linhas.length === 1 ? "robô" : "robôs"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
