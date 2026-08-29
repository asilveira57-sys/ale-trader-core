// Listas em tabela: resultado por combinação e extrato do dinheiro real.
// SOMENTE LEITURA — nada aqui participa do motor, do comitê, dos
// classificadores ou dos freios. A agregação e a ordenação da Lista 1
// acontecem no BANCO (função b3_resultado_combinacao), não no navegador:
// com 350 combinações filtrar no cliente já deu problema de peso no cockpit.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildRealLedger, loadAssetProfiles, rootSymbol, saoPauloDate, type RealCommandRow,
} from "@/lib/b3-real-cockpit.server";

export type CombGroup = "ativo" | "par" | "trio" | "modalidade" | "modo";

export interface CombRow {
  chave: string;
  symbol: string | null;
  variant: string | null;
  mode: string | null;
  resultado_brl: number;
  ops: number;
  ops_pos: number;
  hit_rate: number | null;
  pregoes: number;
  pregoes_pos: number;
  pct_pregoes_pos: number | null;
  melhor_dia: number | null;
  pior_dia: number | null;
  media_op: number | null;
  score_medio: number | null;
  // Período anterior de mesmo tamanho — só o resultado financeiro.
  resultado_anterior_brl: number | null;
}

const SORTABLE = [
  "resultado_brl", "ops", "ops_pos", "hit_rate", "pregoes", "pregoes_pos",
  "pct_pregoes_pos", "melhor_dia", "pior_dia", "media_op", "score_medio",
  "resultado_anterior_brl", "chave",
] as const;
type SortKey = (typeof SORTABLE)[number];

const dayDiff = (de: string, ate: string) =>
  Math.max(1, Math.round((Date.parse(ate) - Date.parse(de)) / 86_400_000) + 1);

const shiftDay = (iso: string, days: number) =>
  new Date(Date.parse(iso) + days * 86_400_000).toISOString().slice(0, 10);

const num = (v: any) => (v == null ? null : Number(v));

export const getB3ResultadoCombinacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { de: string; ate: string; group?: CombGroup; sort?: string; dir?: "asc" | "desc" }) => d)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const group: CombGroup = (["ativo", "par", "trio", "modalidade", "modo"] as const).includes(data.group as any)
      ? (data.group as CombGroup)
      : "trio";
    const de = String(data.de).slice(0, 10);
    const ate = String(data.ate).slice(0, 10);
    const span = dayDiff(de, ate);
    const prevAte = shiftDay(de, -1);
    const prevDe = shiftDay(prevAte, -(span - 1));

    const [atual, anterior] = await Promise.all([
      (supabase as any).rpc("b3_resultado_combinacao", { p_de: de, p_ate: ate, p_group: group }),
      (supabase as any).rpc("b3_resultado_combinacao", { p_de: prevDe, p_ate: prevAte, p_group: group }),
    ]);
    if (atual.error) throw atual.error;

    const prevByKey = new Map<string, number>();
    for (const r of (anterior.data ?? []) as any[]) prevByKey.set(String(r.chave), Number(r.resultado_brl ?? 0));

    const rows: CombRow[] = ((atual.data ?? []) as any[]).map((r) => ({
      chave: String(r.chave),
      symbol: r.symbol ?? null,
      variant: r.variant ?? null,
      mode: r.mode ?? null,
      resultado_brl: Number(r.resultado_brl ?? 0),
      ops: Number(r.ops ?? 0),
      ops_pos: Number(r.ops_pos ?? 0),
      hit_rate: num(r.hit_rate),
      pregoes: Number(r.pregoes ?? 0),
      pregoes_pos: Number(r.pregoes_pos ?? 0),
      pct_pregoes_pos: num(r.pct_pregoes_pos),
      melhor_dia: num(r.melhor_dia),
      pior_dia: num(r.pior_dia),
      media_op: num(r.media_op),
      score_medio: num(r.score_medio),
      resultado_anterior_brl: prevByKey.has(String(r.chave)) ? (prevByKey.get(String(r.chave)) as number) : null,
    }));

    // Ordenação no servidor.
    const sort: SortKey = (SORTABLE as readonly string[]).includes(String(data.sort))
      ? (data.sort as SortKey)
      : "resultado_brl";
    const dir = data.dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const va = (a as any)[sort];
      const vb = (b as any)[sort];
      if (typeof va === "string" || typeof vb === "string") {
        return String(va ?? "").localeCompare(String(vb ?? "")) * dir;
      }
      const na = va == null ? Number.NEGATIVE_INFINITY : Number(va);
      const nb = vb == null ? Number.NEGATIVE_INFINITY : Number(vb);
      return (na - nb) * dir;
    });

    const totais = rows.reduce(
      (acc, r) => {
        acc.resultado_brl += r.resultado_brl;
        acc.ops += r.ops;
        acc.ops_pos += r.ops_pos;
        acc.resultado_anterior_brl += r.resultado_anterior_brl ?? 0;
        return acc;
      },
      { resultado_brl: 0, ops: 0, ops_pos: 0, resultado_anterior_brl: 0 },
    );

    return {
      group, de, ate, prev_de: prevDe, prev_ate: prevAte, sort, dir: data.dir === "asc" ? "asc" : "desc",
      rows, totais,
    };
  });

// ─────────────────────── Lista 2 — extrato do real ───────────────────────

export interface ExtratoRealRow {
  data: string | null;
  root: string;
  symbol: string;
  variant: string;
  mode: string;
  magic_number: number;
  side: "buy" | "sell";
  quantity: number;
  entry_price: number | null;
  exit_price: number | null;
  entry_time: string | null;
  exit_time: string | null;
  result_brl: number | null;
  broker_ticket: string | null;
  fechada_por: "sistema" | "manual" | "desconhecido";
}

export const getB3ExtratoReal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { de?: string | null; ate?: string | null }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const hoje = saoPauloDate(new Date());
    const ate = String(data.ate ?? hoje).slice(0, 10);
    const de = String(data.de ?? shiftDay(ate, -29)).slice(0, 10);

    // O livro FIFO precisa de TODOS os comandos anteriores para casar abertura
    // com fechamento; o corte por data é aplicado na saída, não na consulta.
    const { data: cmds, error } = await (supabase as any).from("b3_mt5_commands")
      .select("id, action, side, symbol, quantity, mode, variant, status, error_message, created_at, filled_at, filled_price, broker_ticket, magic_number, requested_by")
      .eq("user_id", userId).eq("env", "real")
      .order("created_at", { ascending: true }).limit(5000);
    if (error) throw error;

    const commands = (cmds ?? []) as unknown as RealCommandRow[];
    const profileFor = await loadAssetProfiles(supabase);
    const { trades } = buildRealLedger(commands, profileFor);

    const inRange = (iso: string | null) => {
      if (!iso) return false;
      const d = saoPauloDate(new Date(iso));
      return d >= de && d <= ate;
    };

    const rows: ExtratoRealRow[] = trades
      .filter((t) => inRange(t.exit_time))
      .map((t) => ({
        data: t.exit_time ? saoPauloDate(new Date(t.exit_time)) : null,
        root: t.root,
        symbol: t.symbol,
        variant: t.variant,
        mode: t.mode,
        magic_number: t.magic_number,
        side: t.side,
        quantity: t.quantity,
        entry_price: t.entry_price,
        exit_price: t.exit_price,
        entry_time: t.entry_time,
        exit_time: t.exit_time,
        result_brl: t.result_brl,
        broker_ticket: t.broker_ticket,
        fechada_por: (t.closed_by === "user_manual_close"
          ? "manual"
          : t.closed_by
            ? "sistema"
            : "desconhecido") as ExtratoRealRow["fechada_por"],
      }))
      .sort((a, b) => new Date(b.exit_time ?? 0).getTime() - new Date(a.exit_time ?? 0).getTime());

    // Preço zerado pelo defeito antigo do executor: fica fora da soma, com
    // aviso — virar zero mentiria no acumulado.
    const semPreco = rows.filter((r) => r.result_brl == null).length;
    const somaveis = rows.filter((r) => r.result_brl != null);

    const porDia = new Map<string, { data: string; resultado_brl: number; ops: number }>();
    const porRobo = new Map<string, { chave: string; root: string; variant: string; mode: string; magic_number: number; resultado_brl: number; ops: number }>();
    for (const r of somaveis) {
      const dk = r.data ?? "—";
      const d = porDia.get(dk) ?? { data: dk, resultado_brl: 0, ops: 0 };
      d.resultado_brl += r.result_brl as number; d.ops += 1; porDia.set(dk, d);

      const rk = `${rootSymbol(r.symbol)}|${r.variant}|${r.mode}|${r.magic_number}`;
      const b = porRobo.get(rk) ?? {
        chave: rk, root: rootSymbol(r.symbol), variant: r.variant, mode: r.mode,
        magic_number: r.magic_number, resultado_brl: 0, ops: 0,
      };
      b.resultado_brl += r.result_brl as number; b.ops += 1; porRobo.set(rk, b);
    }

    return {
      de, ate, rows,
      sem_preco: semPreco,
      total_brl: somaveis.reduce((s, r) => s + (r.result_brl as number), 0),
      total_ops: rows.length,
      por_dia: [...porDia.values()].sort((a, b) => (a.data < b.data ? 1 : -1)),
      por_robo: [...porRobo.values()].sort((a, b) => b.resultado_brl - a.resultado_brl),
    };
  });
