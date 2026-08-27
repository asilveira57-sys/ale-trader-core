import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getB3DiagnosticoDia } from "@/lib/b3-diagnostico.functions";
import { BRL, SIGNED_BRL, rootSymbol, assetLabel } from "@/lib/b3-format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Stethoscope, AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";

export const Route = createFileRoute("/_authenticated/b3-diagnostico")({
  head: () => ({
    meta: [
      { title: "Diagnóstico Diário dos Robôs — AleTrader AI" },
      { name: "description", content: "Leitura por robô do pregão: resultado, estouro de stop, motivos de saída e frases de diagnóstico." },
      { property: "og:title", content: "Diagnóstico Diário dos Robôs — AleTrader AI" },
      { property: "og:description", content: "Resultado, estouro de stop e diagnóstico por robô em cada pregão." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DiagnosticoPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Erro: {String((error as any)?.message ?? error)}</div>,
  notFoundComponent: () => <div className="p-6">Não encontrado.</div>,
});

// Frases graves conhecidas hoje. Canal visual próprio (âmbar/vermelho de
// diagnóstico) — não mexe na cor de constância vinda de b3_cor_do_robo.
const GRAVES = ["stop atravessado", "cortando vencedor cedo", "risco-retorno invertido", "sangramento lento"];
const isGrave = (frase: string) => GRAVES.some((g) => frase.toLowerCase().includes(g));

const NUM = (v: any, d = 0) =>
  Number(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });

const MODE_LABEL: Record<string, string> = {
  conservador: "Conservador",
  moderado: "Moderado",
  equilibrado: "Equilibrado",
  semi_agressivo: "Semi agressivo",
  agressivo: "Agressivo",
};

function Chip({ on, children, onClick }: { on: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
        on ? "border-primary/40 bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function DiagnosticoPage() {
  const fn = useServerFn(getB3DiagnosticoDia);
  const [date, setDate] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["b3-diagnostico", date],
    queryFn: () => fn({ data: { trade_date: date } }),
  });

  const [fSymbols, setFSymbols] = useState<string[]>([]);
  const [fVariants, setFVariants] = useState<string[]>([]);
  const [fModes, setFModes] = useState<string[]>([]);
  const [soAlerta, setSoAlerta] = useState(false);

  const rows = q.data?.rows ?? [];
  const datas = q.data?.datas ?? [];
  const atual = q.data?.trade_date ?? null;
  const idx = atual ? datas.indexOf(atual) : -1;

  const toggle = (arr: string[], set: (v: string[]) => void, v: string) =>
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const opts = useMemo(() => {
    const s = new Set<string>(), va = new Set<string>(), m = new Set<string>();
    for (const r of rows) {
      s.add(rootSymbol(String(r.symbol)));
      va.add(String(r.variant ?? "indicador"));
      m.add(String(r.mode));
    }
    return { symbols: [...s].sort(), variants: [...va].sort(), modes: [...m].sort() };
  }, [rows]);

  const visiveis = useMemo(() => {
    const list = rows.filter((r: any) => {
      if (fSymbols.length && !fSymbols.includes(rootSymbol(String(r.symbol)))) return false;
      if (fVariants.length && !fVariants.includes(String(r.variant ?? "indicador"))) return false;
      if (fModes.length && !fModes.includes(String(r.mode))) return false;
      if (soAlerta && !(r.diagnostico ?? []).some((f: string) => isGrave(f))) return false;
      return true;
    });
    return [...list].sort((a, b) => Number(b.resultado_brl ?? 0) - Number(a.resultado_brl ?? 0));
  }, [rows, fSymbols, fVariants, fModes, soAlerta]);

  // Resumo: quantos robôs receberam cada frase. Mostra se o problema é de um
  // robô só ou do sistema inteiro.
  const resumo = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of visiveis) for (const f of (r.diagnostico ?? []) as string[]) map.set(f, (map.get(f) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [visiveis]);

  const total = visiveis.reduce((s: number, r: any) => s + Number(r.resultado_brl ?? 0), 0);
  const ops = visiveis.reduce((s: number, r: any) => s + Number(r.ops ?? 0), 0);
  const acertos = visiveis.reduce((s: number, r: any) => s + Number(r.acertos ?? 0), 0);
  const filtroAtivo = fSymbols.length || fVariants.length || fModes.length || soAlerta;

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-[1400px]">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Stethoscope className="size-6 text-sky-400" /> Diagnóstico Diário
          </h1>
          <p className="text-sm text-muted-foreground">
            Uma linha por robô no pregão. Leitura apenas — quem escreve é o fechamento automático das 17:35.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" disabled={idx < 0 || idx >= datas.length - 1}
            onClick={() => setDate(datas[idx + 1] ?? null)} aria-label="Pregão anterior">
            <ChevronLeft className="size-4" />
          </Button>
          <select
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            value={atual ?? ""}
            onChange={(e) => setDate(e.target.value || null)}
          >
            {datas.map((d) => (
              <option key={d} value={d}>{new Date(`${d}T12:00:00Z`).toLocaleDateString("pt-BR")}</option>
            ))}
          </select>
          <Button variant="outline" size="icon" disabled={idx <= 0}
            onClick={() => setDate(datas[idx - 1] ?? null)} aria-label="Próximo pregão">
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </header>

      <div className="panel space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-24 text-[11px] uppercase tracking-wider text-muted-foreground">Ativo</span>
          {opts.symbols.map((s) => (
            <Chip key={s} on={fSymbols.includes(s)} onClick={() => toggle(fSymbols, setFSymbols, s)}>
              {s} <span className="opacity-60">· {assetLabel(s)}</span>
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-24 text-[11px] uppercase tracking-wider text-muted-foreground">Modalidade</span>
          {opts.variants.map((v) => (
            <Chip key={v} on={fVariants.includes(v)} onClick={() => toggle(fVariants, setFVariants, v)}>{v}</Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-24 text-[11px] uppercase tracking-wider text-muted-foreground">Modo</span>
          {opts.modes.map((m) => (
            <Chip key={m} on={fModes.includes(m)} onClick={() => toggle(fModes, setFModes, m)}>{MODE_LABEL[m] ?? m}</Chip>
          ))}
          <span className="mx-2 h-4 w-px bg-border" />
          <Chip on={soAlerta} onClick={() => setSoAlerta((v) => !v)}>Só com alerta</Chip>
          {filtroAtivo ? (
            <Button variant="ghost" size="sm" className="text-xs"
              onClick={() => { setFSymbols([]); setFVariants([]); setFModes([]); setSoAlerta(false); }}>
              Limpar filtro
            </Button>
          ) : null}
        </div>
        {filtroAtivo ? (
          <p className="text-[11px] text-amber-300/90">Filtro ativo — os totais abaixo consideram só o recorte visível.</p>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Resultado do dia" value={SIGNED_BRL(total)} pos={total >= 0} />
        <Stat label="Robôs" value={NUM(visiveis.length)} />
        <Stat label="Operações" value={NUM(ops)} />
        <Stat label="Taxa de acerto" value={ops ? `${NUM((acertos / ops) * 100, 1)}%` : "—"} />
      </div>

      {resumo.length ? (
        <section className="panel p-4">
          <h2 className="mb-2 text-sm font-medium">Diagnósticos do dia</h2>
          <div className="flex flex-wrap gap-2">
            {resumo.map(([frase, n]) => (
              <span key={frase}
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${
                  isGrave(frase)
                    ? "border-red-500/40 bg-red-500/10 text-red-200"
                    : "border-border bg-muted/40 text-muted-foreground"
                }`}>
                {isGrave(frase) ? <AlertTriangle className="size-3" /> : null}
                {frase} <strong className="ml-1">{n}</strong>
              </span>
            ))}
          </div>
        </section>
      ) : null}

      <section className="panel divide-y divide-border">
        {q.isLoading && <p className="p-4 text-sm text-muted-foreground">Carregando diagnóstico…</p>}
        {!q.isLoading && visiveis.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">Nenhum robô no recorte selecionado.</p>
        )}
        {visiveis.map((r: any) => {
          const frases = (r.diagnostico ?? []) as string[];
          const grave = frases.some(isGrave);
          const res = Number(r.resultado_brl ?? 0);
          const saidas = (r.saidas ?? {}) as Record<string, any>;
          return (
            <article key={`${r.symbol}|${r.variant}|${r.mode}`}
              className={`p-4 ${grave ? "border-l-2 border-l-red-500/70 bg-red-500/[0.04]" : ""}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.symbol}</span>
                  <Badge variant="outline" className="text-[10px]">{r.variant ?? "indicador"}</Badge>
                  <Badge variant="outline" className="text-[10px]">{MODE_LABEL[r.mode] ?? r.mode}</Badge>
                  {grave ? (
                    <span className="inline-flex items-center gap-1 rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] text-red-200">
                      <AlertTriangle className="size-3" /> atenção
                    </span>
                  ) : null}
                </div>
                <div className={`text-lg font-semibold ${res >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {SIGNED_BRL(res)}
                </div>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-muted-foreground md:grid-cols-4 lg:grid-cols-7">
                <Info k="Ops" v={`${NUM(r.ops)} (${NUM(r.acertos)} acertos)`} />
                <Info k="1ª hora" v={BRL(r.primeira_hora_brl)} />
                <Info k="Resto do dia" v={BRL(r.resto_do_dia_brl)} />
                <Info k="Estouro médio do stop" v={`${NUM(r.estouro_stop_medio, 1)} pts`} />
                <Info k="Operou por" v={r.minutos_ate_ultima_op == null ? "—" : `${NUM(r.minutos_ate_ultima_op)} min`} />
                <Info k="Robôs no sinal" v={NUM(r.robos_no_sinal_medio, 1)} />
                <Info k="Score médio" v={NUM(r.score_medio, 1)} />
              </div>

              {Object.keys(saidas).length ? (
                <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
                  {Object.entries(saidas).map(([k, v]) => (
                    <span key={k} className="rounded bg-muted/50 px-1.5 py-0.5 text-muted-foreground">
                      {k}: {NUM(v)}
                    </span>
                  ))}
                </div>
              ) : null}

              {frases.length ? (
                <ul className="mt-3 space-y-1 text-xs">
                  {frases.map((f, i) => (
                    <li key={i} className={isGrave(f) ? "text-red-200" : "text-foreground/80"}>
                      {isGrave(f) ? "▲ " : "• "}{f}
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>
          );
        })}
      </section>
    </div>
  );
}

function Info({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="uppercase tracking-wider opacity-70">{k}</div>
      <div className="text-foreground">{v}</div>
    </div>
  );
}

function Stat({ label, value, pos }: { label: string; value: string; pos?: boolean }) {
  return (
    <div className="panel p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${pos === undefined ? "" : pos ? "text-emerald-400" : "text-red-400"}`}>
        {value}
      </div>
    </div>
  );
}
