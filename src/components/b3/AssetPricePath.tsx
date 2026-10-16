import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getCockpitPricePath } from "@/lib/b3-cockpit-measurements.functions";
import { useVisibleRefetchInterval } from "@/hooks/use-visible-refetch-interval";

const number = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const hour = (time: number) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(time);

export function AssetPricePath({ symbol, today }: { symbol: string; today: string }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(today);
  const [step, setStep] = useState<5 | 10 | 15 | 30 | 60>(30);
  const read = useServerFn(getCockpitPricePath);
  const interval = useVisibleRefetchInterval(60000);
  const query = useQuery({
    queryKey: ["cockpit-price-path", symbol, date, step],
    queryFn: () => read({ data: { symbol, date, step } }),
    enabled: open && !!date,
    staleTime: 60000,
    refetchInterval: open && date === today ? interval : false,
    refetchIntervalInBackground: false,
  });
  const points = query.data?.points ?? [];
  const minTime = points[0]?.time ?? 0, maxTime = points[points.length - 1]?.time ?? 1;
  const minPrice = points.length ? Math.min(...points.map((p) => p.price)) : 0;
  const maxPrice = points.length ? Math.max(...points.map((p) => p.price)) : 1;
  const x = (time: number) => 8 + (time - minTime) / Math.max(1, maxTime - minTime) * 684;
  const y = (price: number) => 132 - (price - minPrice) / Math.max(1, maxPrice - minPrice) * 120;
  const segments = new Map<number, typeof points>();
  for (const point of points) segments.set(point.segment, [...(segments.get(point.segment) ?? []), point]);
  return <div className="border-t border-current/20 px-3 py-2">
    <div className="flex justify-end">
      <Button variant="outline" className="min-h-11 border-border bg-background text-foreground" aria-expanded={open}
        aria-label={`${open ? "Recolher" : "Expandir"} preço de ${symbol}`} onClick={() => setOpen(!open)}>
        Preço do pregão {open ? <ChevronUp /> : <ChevronDown />}
      </Button>
    </div>
    {open && <div className="mt-2 space-y-2 text-foreground">
      <div className="flex flex-wrap items-center gap-2">
        <Input type="date" aria-label={`Data do preço de ${symbol}`} value={date} max={today}
          onChange={(event) => setDate(event.target.value)} className="h-11 w-40 bg-background" />
        <label className="flex min-h-11 items-center gap-2 rounded border border-border bg-background px-2 text-xs">
          Passo
          <select aria-label={`Passo do preço de ${symbol}`} value={step} onChange={(event) => setStep(Number(event.target.value) as typeof step)}
            className="min-h-11 bg-background text-foreground">
            {[5, 10, 15, 30, 60].map((value) => <option key={value} value={value}>{value} min</option>)}
          </select>
        </label>
      </div>
      {query.isPending ? <p className="text-sm">Carregando preço…</p> : query.isError ? <p className="text-sm">Não foi possível ler o preço.</p> : !points.length ? <p className="text-sm">sem dados</p> : <div className="bg-background px-2 py-2">
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
          <span>Abertura <strong>{number(query.data?.opening ?? 0)}</strong></span>
          <span>Amplitude <strong>{number(query.data?.amplitude ?? 0)}</strong></span>
          <span className="rounded border border-border px-1">{query.data?.source === "live" ? "ao vivo" : "histórico"}</span>
          <span>Eficiência direcional <strong>{query.data?.efficiency == null ? "—" : `${number(query.data.efficiency * 100)}%`}</strong></span>
        </div>
        <svg viewBox="0 0 700 150" className="mt-2 h-40 w-full text-primary" role="img" aria-label={`Preço de ${symbol} em ${date}`}>
          {Array.from(segments.entries()).map(([id, values]) => <polyline key={id} fill="none" stroke="currentColor" strokeWidth="2"
            points={values.map((point) => `${x(point.time)},${y(point.price)}`).join(" ")} />)}
          {points.map((point, index) => <circle key={index} cx={x(point.time)} cy={y(point.price)} r="2" fill="currentColor">
            <title>{hour(point.time)} · {number(point.price)}</title>
          </circle>)}
        </svg>
        <div className="flex justify-between text-xs text-muted-foreground"><span>{hour(minTime)}</span><span>{hour(maxTime)}</span></div>
        {segments.size > 1 && <p className="mt-1 text-xs text-warning">Há intervalos sem dados.</p>}
        {query.data?.rows_truncated && <p className="mt-1 text-xs text-warning">Leitura atingiu o limite; acompanhamento incompleto.</p>}
      </div>}
    </div>}
  </div>;
}