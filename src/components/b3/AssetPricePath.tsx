import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronUp, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getCockpitPricePath } from "@/lib/b3-cockpit-measurements.functions";
import { useVisibleRefetchInterval } from "@/hooks/use-visible-refetch-interval";
import { copiarTexto, tabular } from "@/lib/b3-copiar";

const number = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const hour = (time: number) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(time);

const W = 760, H = 240, L = 64, R = 12, T = 14, B = 26;

export function AssetPricePath({ symbol, today }: { symbol: string; today: string }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(today);
  const [step, setStep] = useState<5 | 10 | 15 | 30 | 60>(30);
  const [hover, setHover] = useState<number | null>(null);
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
  const opening = query.data?.opening ?? null;
  const minTime = points[0]?.time ?? 0, maxTime = points[points.length - 1]?.time ?? 1;
  const prices = points.map((p) => p.price).concat(opening != null ? [opening] : []);
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const maxPrice = prices.length ? Math.max(...prices) : 1;
  const x = (time: number) => L + (time - minTime) / Math.max(1, maxTime - minTime) * (W - L - R);
  const y = (price: number) => T + (1 - (price - minPrice) / Math.max(1e-9, maxPrice - minPrice)) * (H - T - B);
  const segments = new Map<number, typeof points>();
  for (const point of points) segments.set(point.segment, [...(segments.get(point.segment) ?? []), point]);
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => minPrice + f * (maxPrice - minPrice));
  const stepMs = step * 60_000;
  const xTicks: number[] = [];
  for (let t = Math.ceil(minTime / stepMs) * stepMs; t <= maxTime; t += stepMs) xTicks.push(t);
  const labelEvery = Math.max(1, Math.ceil(xTicks.length / 10));
  const last = points[points.length - 1];
  const hiIdx = points.reduce((b, p, i) => (p.price > points[b].price ? i : b), 0);
  const loIdx = points.reduce((b, p, i) => (p.price < points[b].price ? i : b), 0);
  const marks = points.length ? [
    { i: 0, t: "abertura" }, { i: hiIdx, t: "máx" }, { i: loIdx, t: "mín" }, { i: points.length - 1, t: "último" },
  ].filter((m, k, arr) => arr.findIndex((o) => o.i === m.i) === k) : [];
  const pick = (clientX: number, el: SVGSVGElement) => {
    const r = el.getBoundingClientRect();
    const sx = (clientX - r.left) / r.width * W;
    let best = 0;
    points.forEach((p, i) => { if (Math.abs(x(p.time) - sx) < Math.abs(x(points[best].time) - sx)) best = i; });
    setHover(points.length ? best : null);
  };
  const hp = hover != null ? points[hover] : null;
  const copy = () => copiarTexto(`Preço do pregão ${symbol} · ${date} · passo ${step} min · ${query.data?.source === "live" ? "ao vivo" : "histórico"}\n` +
    (points.length ? `Abertura ${number(opening ?? 0)} · Máxima ${number(points[hiIdx].price)} · Mínima ${number(points[loIdx].price)} · Último ${number(last!.price)} · Amplitude ${number(query.data?.amplitude ?? 0)} · Eficiência ${query.data?.efficiency == null ? "sem registro" : `${number(query.data.efficiency * 100)}%`}\n` +
      tabular(["hora", "preço"], points.map((p) => [hour(p.time), number(p.price)])) + (segments.size > 1 ? "\nHá intervalos sem dados (não interpolados)." : "")
      : "sem registro"));
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
        <Button variant="outline" className="ml-auto min-h-11 bg-background" onClick={copy} disabled={!query.data}><Copy className="mr-1 size-4" />Copiar</Button>
      </div>
      {query.isPending ? <p className="text-sm">Carregando preço…</p> : query.isError ? <p className="text-sm">Não foi possível ler o preço.</p> : !points.length ? <p className="text-sm">sem dados</p> : <div className="bg-background px-2 py-2">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-1 text-xs">
          <span>Abertura <strong>{number(opening ?? 0)}</strong></span>
          <span>Amplitude <strong>{number(query.data?.amplitude ?? 0)}</strong></span>
          <span className="rounded border border-border px-1">{query.data?.source === "live" ? "ao vivo" : "histórico"}</span>
          <span>Eficiência direcional <strong>{query.data?.efficiency == null ? "—" : `${number(query.data.efficiency * 100)}%`}</strong></span>
          <span className="ml-auto text-right"><span className="block text-[10px] text-muted-foreground">último · {hour(last!.time)}</span>
            <span className="font-mono text-2xl font-black">{number(last!.price)}</span></span>
        </div>
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-60 w-full touch-none select-none text-primary" role="img" aria-label={`Preço de ${symbol} em ${date}`}
            onPointerMove={(e) => pick(e.clientX, e.currentTarget)} onPointerDown={(e) => pick(e.clientX, e.currentTarget)}
            onPointerLeave={(e) => { if (e.pointerType === "mouse") setHover(null); }}>
            {yTicks.map((v, i) => <g key={`y${i}`}>
              <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="currentColor" className="text-border" strokeWidth="1" />
              <text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="11" className="fill-muted-foreground">{number(v)}</text>
            </g>)}
            {xTicks.map((t, i) => <g key={`x${t}`}>
              <line x1={x(t)} x2={x(t)} y1={T} y2={H - B} stroke="currentColor" className="text-border" strokeWidth="1" strokeDasharray="2 3" />
              {i % labelEvery === 0 && <text x={x(t)} y={H - 8} textAnchor="middle" fontSize="11" className="fill-muted-foreground">{hour(t)}</text>}
            </g>)}
            {opening != null && <line x1={L} x2={W - R} y1={y(opening)} y2={y(opening)} stroke="currentColor" className="text-warning" strokeWidth="1.5" strokeDasharray="6 4" />}
            {Array.from(segments.entries()).map(([id, values]) => <polyline key={id} fill="none" stroke="currentColor" strokeWidth="2"
              points={values.map((point) => `${x(point.time)},${y(point.price)}`).join(" ")} />)}
            {marks.map((m) => { const p = points[m.i]; const above = m.t !== "mín";
              return <g key={m.t}>
                <circle cx={x(p.time)} cy={y(p.price)} r="3.5" fill="currentColor" />
                <text x={Math.min(W - R - 4, Math.max(L + 4, x(p.time)))} y={y(p.price) + (above ? -7 : 15)} fontSize="11" fontWeight="700"
                  textAnchor={m.i === points.length - 1 ? "end" : m.i === 0 ? "start" : "middle"} className="fill-foreground">{m.t} {number(p.price)}</text>
              </g>; })}
            {hp && <g>
              <line x1={x(hp.time)} x2={x(hp.time)} y1={T} y2={H - B} stroke="currentColor" className="text-foreground" strokeWidth="1" />
              <circle cx={x(hp.time)} cy={y(hp.price)} r="5" fill="currentColor" />
            </g>}
          </svg>
          {hp && <div className="pointer-events-none absolute top-1 rounded border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow"
            style={{ left: `${Math.min(80, Math.max(0, x(hp.time) / W * 100 - 8))}%` }}>
            {hour(hp.time)} · <strong className="font-mono">{number(hp.price)}</strong>
          </div>}
        </div>
        <p className="text-[10px] text-muted-foreground">Linha tracejada amarela: abertura do dia. Toque ou passe o dedo no gráfico para ver o valor.</p>
        {segments.size > 1 && <p className="mt-1 text-xs text-warning">Há intervalos sem dados (não interpolados).</p>}
        {query.data?.rows_truncated && <p className="mt-1 text-xs text-warning">Leitura atingiu o limite; acompanhamento incompleto.</p>}
      </div>}
    </div>}
  </div>;
}
