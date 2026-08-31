// Lista 2 — extrato do dinheiro real, cronológico, em tabela.
// Somente leitura. O pareamento abertura/fechamento vem do livro FIFO do
// cockpit real, por raiz do ativo + magic. Tudo em horário de Brasília.
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getB3ExtratoReal, type ExtratoGrupo, type ExtratoStats } from "@/lib/b3-listas.functions";
import { BRL, SIGNED_BRL } from "@/lib/b3-format";
import { useModeApelidos } from "@/hooks/use-mode-apelidos";
import { ModeName } from "@/components/b3/ModeName";
import { vLabel, downloadCsv, printPage, dm, hm, todayBrt, daysAgoBrt } from "@/lib/b3-listas-format";
import { Button } from "@/components/ui/button";
import { Receipt, Download, Printer, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/b3-extrato-real")({
  head: () => ({
    meta: [
      { title: "Extrato do Dinheiro Real — AleTrader AI" },
      { name: "description", content: "Extrato cronológico das operações reais encerradas na corretora, com ganho bruto, perda bruta, fator de lucro, custos e totais por dia, ativo, modalidade, modo, semana e mês." },
      { property: "og:title", content: "Extrato do Dinheiro Real — AleTrader AI" },
      { property: "og:description", content: "Operações reais encerradas com testeira completa, filtros combináveis e exportação em CSV e PDF." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ExtratoRealPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Erro: {String((error as any)?.message ?? error)}</div>,
  notFoundComponent: () => <div className="p-6">Não encontrado.</div>,
});

const PX = (v: number | null) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 }));
const PCT = (v: number | null | undefined) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const NUM = (v: number | null | undefined, d = 2) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d }));

// Atalhos de data, sempre em horário de Brasília.
const monthStart = (ymd: string) => `${ymd.slice(0, 7)}-01`;
const shiftMonth = (ymd: string, n: number) => {
  const y = Number(ymd.slice(0, 4)), m = Number(ymd.slice(5, 7)) - 1 + n;
  const d = new Date(Date.UTC(y, m, 1));
  return d.toISOString().slice(0, 10);
};
const monthEnd = (ymd: string) => {
  const d = new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)), 0));
  return d.toISOString().slice(0, 10);
};

type Group = "dia" | "ativo" | "modalidade" | "modo" | "robo" | "semana" | "mes";
const GROUPS: { key: Group; label: string }[] = [
  { key: "dia", label: "Por dia" },
  { key: "ativo", label: "Por ativo" },
  { key: "modalidade", label: "Por modalidade" },
  { key: "modo", label: "Por modo" },
  { key: "robo", label: "Por robô" },
  { key: "semana", label: "Por semana" },
  { key: "mes", label: "Por mês" },
];

function Chip({ active, onClick, children }: { active: boolean; onClick: (e: React.MouseEvent) => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-xs transition ${
        active ? "border-primary bg-primary/15 text-foreground" : "border-border text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function Card({ label, value, tone, hint }: { label: string; value: React.ReactNode; tone?: "pos" | "neg" | "mute"; hint?: string }) {
  const color = tone === "pos" ? "text-emerald-500" : tone === "neg" ? "text-destructive" : tone === "mute" ? "text-muted-foreground" : "";
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${color}`}>{value}</div>
      {hint ? <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

function ExtratoRealPage() {
  const fn = useServerFn(getB3ExtratoReal);
  const apelidos = useModeApelidos();
  const mText = (m?: string | null) => {
    if (!m) return "—";
    const t = apelidos.tech(m), n = apelidos.nick(m);
    return t && t !== n ? `${n} (${t})` : n;
  };
  const [de, setDe] = useState(daysAgoBrt(29));
  const [ate, setAte] = useState(todayBrt());
  const [symbols, setSymbols] = useState<string[] | null>(null);
  const [variants, setVariants] = useState<string[] | null>(null);
  const [modes, setModes] = useState<string[] | null>(null);
  const [group, setGroup] = useState<Group>("dia");

  const q = useQuery({
    queryKey: ["b3-extrato-real", de, ate, symbols, variants, modes],
    queryFn: () => fn({ data: { de, ate, symbols, variants, modes } }),
    staleTime: 0,
    gcTime: 0,
  });

  const rows = q.data?.rows ?? [];
  const st: ExtratoStats | undefined = q.data?.stats;
  const opts = q.data?.opcoes;

  const grupos: ExtratoGrupo[] = useMemo(() => {
    const d = q.data;
    if (!d) return [];
    return (
      group === "dia" ? d.por_dia
      : group === "ativo" ? d.por_ativo
      : group === "modalidade" ? d.por_modalidade
      : group === "modo" ? d.por_modo
      : group === "robo" ? d.por_robo
      : group === "semana" ? d.por_semana
      : d.por_mes
    ) as ExtratoGrupo[];
  }, [q.data, group]);

  // Clique simples ISOLA o item (mesma convenção do cockpit); Ctrl/Shift soma.
  const pick = (cur: string[] | null, all: string[], v: string, e: React.MouseEvent): string[] | null => {
    const aditivo = e.ctrlKey || e.metaKey || e.shiftKey;
    if (!aditivo) return cur && cur.length === 1 && cur[0] === v ? null : [v];
    const base = cur ?? all;
    const next = base.includes(v) ? base.filter((x) => x !== v) : [...base, v];
    return next.length === all.length ? null : next;
  };

  const grupoRotulo = (g: ExtratoGrupo) =>
    group === "dia" ? dm(g.chave)
    : group === "modalidade" ? vLabel(g.variant)
    : group === "modo" ? mText(g.mode)
    : group === "robo" ? `${g.root} · ${vLabel(g.variant)} · ${mText(g.mode)}${g.magic_number ? ` · ${g.magic_number}` : ""}`
    : g.rotulo;

  const csv = () =>
    downloadCsv(
      `b3_extrato_real_${de}_a_${ate}.csv`,
      ["Data", "Entrada", "Saída", "Ativo", "Modalidade", "Modo", "Magic", "Lado", "Qtd",
        "Preço entrada", "Preço saída", "Resultado (R$)", "Montante (R$)", "Ticket corretora", "Fechada por"],
      rows.map((r) => [
        r.data, hm(r.entry_time), hm(r.exit_time), r.symbol, vLabel(r.variant), mText(r.mode),
        r.magic_number, r.side === "buy" ? "Compra" : "Venda", r.quantity,
        r.entry_price, r.exit_price, r.result_brl, r.volume_brl, r.broker_ticket ?? "",
        r.fechada_por === "manual" ? "Manual" : r.fechada_por === "sistema" ? "Sistema" : "Desconhecido",
      ]),
    );

  const csvGrupo = () =>
    downloadCsv(
      `b3_extrato_real_${group}_${de}_a_${ate}.csv`,
      ["Grupo", "Ops", "Ganho bruto", "Perda bruta", "Resultado", "Fator de lucro", "Ganhos", "Perdas",
        "Taxa de acerto", "Ganho médio", "Perda média", "Maior ganho", "Maior perda", "Montante", "Manuais", "Automáticas"],
      grupos.map((g) => [
        grupoRotulo(g), g.ops, g.ganho_bruto, g.perda_bruta, g.resultado_liquido, g.fator_lucro,
        g.ganhos, g.perdas, g.hit_rate, g.ganho_medio, g.perda_media, g.maior_ganho, g.maior_perda,
        g.volume_brl, g.manuais, g.automaticas,
      ]),
    );

  const filtroAtivo =
    (symbols ? `ativo (${symbols.length})` : "") ||
    (variants ? `modalidade (${variants.length})` : "") ||
    (modes ? `modo (${modes.length})` : "");

  return (
    <div className="space-y-4 p-4 md:p-6">
      <style>{`@media print { .no-print { display: none !important } body { background: #fff } }`}</style>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Receipt className="size-5" /> Extrato do dinheiro real
          </h1>
          <p className="text-sm text-muted-foreground">
            {dm(de)} a {dm(ate)} · somente operações reais encerradas e confirmadas pela corretora · horário de Brasília
          </p>
        </div>
        <div className="no-print flex gap-2">
          <Button variant="outline" size="sm" onClick={csv} disabled={!rows.length}>
            <Download className="mr-1 size-4" /> CSV
          </Button>
          <Button variant="outline" size="sm" onClick={printPage} disabled={!rows.length}>
            <Printer className="mr-1 size-4" /> PDF
          </Button>
        </div>
      </header>

      <div className="no-print space-y-3 rounded-lg border border-border p-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-muted-foreground">
            De
            <input type="date" value={de} max={ate} onChange={(e) => setDe(e.target.value)}
              className="mt-1 block rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground" />
          </label>
          <label className="text-xs text-muted-foreground">
            Até
            <input type="date" value={ate} min={de} onChange={(e) => setAte(e.target.value)}
              className="mt-1 block rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground" />
          </label>
          <div className="flex flex-wrap gap-1.5">
            <Chip active={de === todayBrt() && ate === todayBrt()} onClick={() => { setDe(todayBrt()); setAte(todayBrt()); }}>Hoje</Chip>
            <Chip active={de === daysAgoBrt(6) && ate === todayBrt()} onClick={() => { setDe(daysAgoBrt(6)); setAte(todayBrt()); }}>Últimos 7 dias</Chip>
            <Chip active={de === daysAgoBrt(29) && ate === todayBrt()} onClick={() => { setDe(daysAgoBrt(29)); setAte(todayBrt()); }}>Últimos 30 dias</Chip>
            <Chip active={de === monthStart(todayBrt()) && ate === todayBrt()} onClick={() => { setDe(monthStart(todayBrt())); setAte(todayBrt()); }}>Este mês</Chip>
            <Chip
              active={de === shiftMonth(monthStart(todayBrt()), -1) && ate === monthEnd(shiftMonth(monthStart(todayBrt()), -1))}
              onClick={() => { const p = shiftMonth(monthStart(todayBrt()), -1); setDe(p); setAte(monthEnd(p)); }}
            >Mês passado</Chip>
          </div>
        </div>

        <div className="flex flex-wrap items-start gap-x-6 gap-y-2 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground">Ativo:</span>
            <Chip active={!symbols} onClick={() => setSymbols(null)}>Todos</Chip>
            {(opts?.symbols ?? []).map((s) => (
              <Chip key={s} active={!symbols || symbols.includes(s)} onClick={(e) => setSymbols(pick(symbols, opts?.symbols ?? [], s, e))}>{s}</Chip>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground">Modalidade:</span>
            <Chip active={!variants} onClick={() => setVariants(null)}>Todas</Chip>
            {(opts?.variants ?? []).map((v) => (
              <Chip key={v} active={!variants || variants.includes(v)} onClick={(e) => setVariants(pick(variants, opts?.variants ?? [], v, e))}>{vLabel(v)}</Chip>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground">Modo:</span>
            <Chip active={!modes} onClick={() => setModes(null)}>Todos</Chip>
            {(opts?.modes ?? []).map((m) => (
              <Chip key={m} active={!modes || modes.includes(m)} onClick={(e) => setModes(pick(modes, opts?.modes ?? [], m, e))}>{apelidos.nick(m)}</Chip>
            ))}
          </div>
          {filtroAtivo ? (
            <span className="rounded-full bg-primary/15 px-2 py-1 text-[11px] font-semibold">
              Recorte ativo — a testeira e os agrupamentos já refletem o filtro
            </span>
          ) : null}
        </div>
      </div>

      {/* Testeira: bruto separado do líquido, porque o líquido esconde a natureza do resultado. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Card label="Ganho bruto acumulado" value={BRL(st?.ganho_bruto ?? 0)} tone="pos" hint={`${st?.ganhos ?? 0} ganho(s)`} />
        <Card label="Perda bruta acumulada" value={BRL(st?.perda_bruta ?? 0)} tone="neg" hint={`${st?.perdas ?? 0} perda(s)`} />
        <Card
          label={q.data?.custos_disponiveis ? "Corretagem + emolumentos" : "Corretagem + emolumentos"}
          value={q.data?.custos_disponiveis ? BRL(st?.custos_brl ?? 0) : "—"}
          tone="mute"
          hint={q.data?.custos_disponiveis ? undefined : "custo não vem da base: o líquido abaixo ainda é BRUTO"}
        />
        <Card
          label={q.data?.custos_disponiveis ? "Resultado líquido" : "Resultado (bruto)"}
          value={SIGNED_BRL(st?.resultado_liquido ?? 0)}
          tone={(st?.resultado_liquido ?? 0) >= 0 ? "pos" : "neg"}
        />
        <Card label="Fator de lucro" value={NUM(st?.fator_lucro ?? null)} hint="ganho bruto ÷ perda bruta" />
        <Card label="Taxa de acerto" value={PCT(st?.hit_rate)} hint={`${st?.ganhos ?? 0} × ${st?.perdas ?? 0}`} />
        <Card label="Ganho médio" value={BRL(st?.ganho_medio ?? 0)} tone="pos" hint="par risco-retorno" />
        <Card label="Perda média" value={BRL(st?.perda_media ?? 0)} tone="neg" hint="par risco-retorno" />
        <Card label="Maior ganho" value={BRL(st?.maior_ganho ?? 0)} tone="pos" />
        <Card label="Maior perda" value={BRL(st?.maior_perda ?? 0)} tone="neg" />
        <Card label="Montante movimentado" value={BRL(st?.volume_brl ?? 0)} hint="volume total operado" />
        <Card
          label="Operações encerradas"
          value={st?.ops ?? 0}
          hint={`${st?.automaticas ?? 0} automática(s) · ${st?.manuais ?? 0} na mão · ${st?.sem_preco ?? 0} fora da conta`}
        />
      </div>

      {(st?.sem_preco ?? 0) > 0 && (
        <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {st?.sem_preco} operação(ões) sem preço executado gravado pela corretora aparecem com “—” e ficam fora do acumulado — tratar como zero mentiria no total.
        </p>
      )}

      {q.isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">Montando o extrato…</div>
      ) : !rows.length ? (
        <div className="p-6 text-sm text-muted-foreground">Nenhuma operação real encerrada nesse recorte.</div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs">
                <tr>
                  {["Data", "Entrada", "Saída", "Ativo", "Robô", "Magic", "Lado", "Qtd", "Preço entrada", "Preço saída", "Resultado", "Montante", "Ticket", "Fechada por"].map((h, i) => (
                    <th key={h} className={`whitespace-nowrap px-3 py-2 ${i >= 5 && i <= 11 ? "text-right" : "text-left"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.broker_ticket ?? "s"}-${r.exit_time}-${i}`} className="border-t border-border/60">
                    <td className="whitespace-nowrap px-3 py-1.5">{dm(r.data)}</td>
                    <td className="px-3 py-1.5">{hm(r.entry_time)}</td>
                    <td className="px-3 py-1.5">{hm(r.exit_time)}</td>
                    <td className="whitespace-nowrap px-3 py-1.5">{r.symbol}</td>
                    <td className="whitespace-nowrap px-3 py-1.5">{vLabel(r.variant)} · <ModeName mode={r.mode} api={apelidos} /></td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.magic_number || "—"}</td>
                    <td className={`px-3 py-1.5 text-right ${r.side === "buy" ? "text-emerald-500" : "text-destructive"}`}>
                      {r.side === "buy" ? "Compra" : "Venda"}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.quantity}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{PX(r.entry_price)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{PX(r.exit_price)}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${r.result_brl == null ? "text-muted-foreground" : r.result_brl >= 0 ? "text-emerald-500" : "text-destructive"}`}>
                      {r.result_brl == null ? "—" : SIGNED_BRL(r.result_brl)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.volume_brl == null ? "—" : BRL(r.volume_brl)}</td>
                    <td className="px-3 py-1.5 tabular-nums">{r.broker_ticket ?? "—"}</td>
                    <td className="px-3 py-1.5">
                      {r.fechada_por === "manual" ? "Manual" : r.fechada_por === "sistema" ? "Sistema" : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-lg border border-border">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
              <div className="no-print flex flex-wrap gap-1.5">
                {GROUPS.map((g) => (
                  <Chip key={g.key} active={group === g.key} onClick={() => setGroup(g.key)}>{g.label}</Chip>
                ))}
              </div>
              <Button className="no-print" variant="outline" size="sm" onClick={csvGrupo} disabled={!grupos.length}>
                <Download className="mr-1 size-4" /> CSV do agrupamento
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs">
                  <tr>
                    <th className="px-3 py-2 text-left">Grupo</th>
                    {["Ops", "Ganho bruto", "Perda bruta", "Resultado", "Fator", "Ganhos", "Perdas", "Acerto", "Ganho médio", "Perda média", "Maior ganho", "Maior perda", "Montante", "Manuais"].map((h) => (
                      <th key={h} className="whitespace-nowrap px-3 py-2 text-right">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grupos.map((g) => (
                    <tr key={g.chave} className="border-t border-border/60">
                      <td className="whitespace-nowrap px-3 py-1.5">{grupoRotulo(g)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{g.ops}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-emerald-500">{BRL(g.ganho_bruto)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-destructive">{BRL(g.perda_bruta)}</td>
                      <td className={`px-3 py-1.5 text-right tabular-nums ${g.resultado_liquido >= 0 ? "text-emerald-500" : "text-destructive"}`}>
                        {SIGNED_BRL(g.resultado_liquido)}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{NUM(g.fator_lucro)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{g.ganhos}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{g.perdas}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{PCT(g.hit_rate)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{BRL(g.ganho_medio ?? 0)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{BRL(g.perda_media ?? 0)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{BRL(g.maior_ganho ?? 0)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{BRL(g.maior_perda ?? 0)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{BRL(g.volume_brl)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{g.manuais}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
