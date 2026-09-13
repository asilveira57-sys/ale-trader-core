// Barra de navegação por DATA dos cockpits (real e simulado).
// Só apresentação: não decide entrada, freio, espelhamento nem execução.
// O padrão é sempre "Hoje" — a escolha NÃO é guardada entre visitas.
import { AlertTriangle, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PERIOD_PRESETS, formatBrDate, type PeriodInput, type PeriodPreset } from "@/lib/b3-period";

export type { PeriodInput } from "@/lib/b3-period";

export const DEFAULT_PERIOD: PeriodInput = { preset: "hoje", start: null, end: null };

export function PeriodBar({
  value,
  onChange,
  resolved,
  busy,
}: {
  value: PeriodInput;
  onChange: (p: PeriodInput) => void;
  /** eco do servidor: {label, days, includes_today, start, end} */
  resolved?: { label?: string; days?: number; includes_today?: boolean; start?: string; end?: string } | null;
  busy?: boolean;
}) {
  const preset = (value.preset ?? "hoje") as PeriodPreset;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="rounded-xl border border-border bg-muted/20 px-2 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
        {PERIOD_PRESETS.map((p) => (
          <Button
            key={p.key}
            size="sm"
            variant={preset === p.key ? "default" : "outline"}
            className="h-8 px-2 text-[11px] font-bold"
            onClick={() => onChange({ preset: p.key, start: value.start ?? null, end: value.end ?? null })}
            disabled={busy}
          >
            {p.label}
          </Button>
        ))}
        {preset === "entre" ? (
          <span className="flex flex-wrap items-center gap-1.5">
            <Input
              type="date"
              max={today}
              value={value.start ?? ""}
              onChange={(e) => onChange({ ...value, preset: "entre", start: e.target.value || null })}
              className="h-8 w-[9.5rem] text-[11px]"
              aria-label="Data inicial"
            />
            <span className="text-[11px] text-muted-foreground">até</span>
            <Input
              type="date"
              max={today}
              value={value.end ?? ""}
              onChange={(e) => onChange({ ...value, preset: "entre", end: e.target.value || null })}
              className="h-8 w-[9.5rem] text-[11px]"
              aria-label="Data final"
            />
          </span>
        ) : null}
        {resolved?.label ? (
          <span className="ml-auto text-[11px] font-semibold text-muted-foreground">
            {resolved.label}
            {resolved.days && resolved.days > 1 ? ` · ${resolved.days} dia(s)` : ""}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Aviso permanente de MODO histórico: dado velho não pode parecer o de agora. */
export function HistoricalBanner({ resolved }: { resolved?: { includes_today?: boolean; label?: string } | null }) {
  if (!resolved || resolved.includes_today !== false) return null;
  return (
    <div className="mt-2 rounded-xl border-2 border-amber-400 bg-amber-500/20 px-3 py-2 text-amber-100">
      <p className="flex items-center gap-2 text-sm font-black leading-tight">
        <AlertTriangle className="size-5 shrink-0" />
        Visualizando {resolved.label ?? "período anterior"} — não é o dia de hoje. Ações desativadas.
      </p>
      <p className="mt-1 text-[11px] font-medium opacity-95">
        Executor, relatório da corretora, cotação viva, posição aberta e avisos da última hora ficam
        escondidos: só fazem sentido para o dia corrente.
      </p>
    </div>
  );
}

/** "Sem movimento nesta data" — ausência de pregão não é erro nem zero. */
export function NoMovementNotice({ label }: { label?: string }) {
  return (
    <p className="mt-2 rounded-xl border border-border bg-muted/30 px-3 py-6 text-center text-sm font-semibold text-muted-foreground">
      Sem movimento em {label ?? "no período"} — nenhuma ordem nem operação registrada.
    </p>
  );
}

/** Aviso de recorte truncado: número incompleto nunca pode parecer completo. */
export function TruncatedNotice({ limit }: { limit?: number }) {
  return (
    <p className="mt-2 rounded-xl border-2 border-rose-400 bg-rose-600/90 px-3 py-2 text-[12px] font-bold text-white">
      Limite de {limit ?? "?"} registros atingido neste período — os números abaixo estão INCOMPLETOS.
      Reduza o período para conferir valores.
    </p>
  );
}

/** Resultado de cada pregão do recorte. Só aparece com mais de um dia. */
export function PerDayTable({ rows, brl }: { rows: any[]; brl: (v: number | null | undefined) => string }) {
  if (!rows?.length) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-xs">
        <thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
          <tr className="border-b border-border">
            <th className="py-1 text-left">Pregão</th>
            <th className="py-1 text-right">Operações</th>
            <th className="py-1 text-right">Ganhos</th>
            <th className="py-1 text-right">Perdas</th>
            <th className="py-1 text-right">Resultado</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r: any) => (
            <tr key={r.date} className="border-b border-border/50">
              <td className="py-1 font-mono">{formatBrDate(r.date)}</td>
              <td className="py-1 text-right">{r.trades}</td>
              <td className="py-1 text-right">{r.wins}</td>
              <td className="py-1 text-right">{r.losses}</td>
              <td className={`py-1 text-right font-black ${Number(r.realized_brl) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                {brl(r.realized_brl)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
