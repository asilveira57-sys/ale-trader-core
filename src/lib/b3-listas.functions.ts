// Listas em tabela: resultado por combinação e extrato do dinheiro real.
// SOMENTE LEITURA — nada aqui participa do motor, do comitê, dos
// classificadores ou dos freios. A agregação e a ordenação da Lista 1
// acontecem no BANCO (função b3_resultado_combinacao), não no navegador:
// com 350 combinações filtrar no cliente já deu problema de peso no cockpit.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildRealLedger, loadAssetProfiles, saoPauloDate, type RealCommandRow,
} from "@/lib/b3-real-cockpit.server";
import { rootSymbol } from "@/lib/b3-format";

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

const arg = (v?: string[] | null) => {
  if (!Array.isArray(v)) return null;
  const vals = v.map((s) => String(s)).filter((s) => s && s !== "all");
  // Lista vazia = nada selecionado. Sentinela impossível para devolver vazio,
  // em vez de silenciosamente mostrar tudo.
  return vals.length ? vals : ["__nenhum__"];
};

export const getB3ResultadoCombinacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    de: string; ate: string; group?: CombGroup; sort?: string; dir?: "asc" | "desc";
    symbols?: string[] | null; variants?: string[] | null; modes?: string[] | null;
  }) => d)
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

    const p_symbols = arg(data.symbols);
    const p_variants = arg(data.variants);
    const p_modes = arg(data.modes);

    const [atual, anterior] = await Promise.all([
      (supabase as any).rpc("b3_resultado_combinacao", { p_de: de, p_ate: ate, p_group: group, p_symbols, p_variants, p_modes }),
      (supabase as any).rpc("b3_resultado_combinacao", { p_de: prevDe, p_ate: prevAte, p_group: group, p_symbols, p_variants, p_modes }),
    ]);
    if (atual.error) throw atual.error;

    const prevByKey = new Map<string, number>();
    let prevOps = 0;
    for (const r of (anterior.data ?? []) as any[]) {
      prevByKey.set(String(r.chave), Number(r.resultado_brl ?? 0));
      prevOps += Number(r.ops ?? 0);
    }

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
      rows,
      totais: {
        ...totais,
        // Resultado por operação: a única leitura comparável quando o número de
        // robôs muda entre os períodos.
        media_op: totais.ops ? totais.resultado_brl / totais.ops : null,
        ops_anterior: prevOps,
        media_op_anterior: prevOps ? totais.resultado_anterior_brl / prevOps : null,
      },
      filtro: {
        symbols: p_symbols && p_symbols[0] !== "__nenhum__" ? p_symbols : p_symbols ? [] : null,
        variants: p_variants && p_variants[0] !== "__nenhum__" ? p_variants : p_variants ? [] : null,
        modes: p_modes && p_modes[0] !== "__nenhum__" ? p_modes : p_modes ? [] : null,
      },
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
  /** Montante movimentado da operação (preço de entrada × ponto × qtd). */
  volume_brl: number | null;
  broker_ticket: string | null;
  fechada_por: "sistema" | "manual" | "desconhecido";
}

/** Testeira: bruto separado do líquido. O líquido esconde a natureza do resultado. */
export interface ExtratoStats {
  ops: number;
  ops_somaveis: number;
  sem_preco: number;
  ganho_bruto: number;
  perda_bruta: number;
  resultado_bruto: number;
  /** Custos (corretagem + emolumentos). null = a base não guarda esse dado. */
  custos_brl: number | null;
  /** Bruto − custos quando existirem; igual ao bruto quando não existem. */
  resultado_liquido: number;
  fator_lucro: number | null;
  ganhos: number;
  perdas: number;
  hit_rate: number | null;
  ganho_medio: number | null;
  perda_media: number | null;
  maior_ganho: number | null;
  maior_perda: number | null;
  volume_brl: number;
  manuais: number;
  automaticas: number;
}

export interface ExtratoGrupo extends ExtratoStats {
  chave: string;
  rotulo: string;
  root?: string;
  variant?: string;
  mode?: string;
  magic_number?: number;
  ordem?: number;
}

// Custos: b3_mt5_commands não guarda corretagem/emolumentos. Enquanto o
// executor não reportar, a linha aparece com "—" e o líquido segue BRUTO.
// Inventar número aqui faria o extrato parecer melhor do que a conta é.
const COSTS_AVAILABLE = false;

const emptyStats = (): ExtratoStats => ({
  ops: 0, ops_somaveis: 0, sem_preco: 0, ganho_bruto: 0, perda_bruta: 0,
  resultado_bruto: 0, custos_brl: COSTS_AVAILABLE ? 0 : null, resultado_liquido: 0,
  fator_lucro: null, ganhos: 0, perdas: 0, hit_rate: null,
  ganho_medio: null, perda_media: null, maior_ganho: null, maior_perda: null,
  volume_brl: 0, manuais: 0, automaticas: 0,
});

function statsOf(rows: ExtratoRealRow[]): ExtratoStats {
  const s = emptyStats();
  s.ops = rows.length;
  for (const r of rows) {
    if (r.fechada_por === "manual") s.manuais += 1;
    else if (r.fechada_por === "sistema") s.automaticas += 1;
    s.volume_brl += r.volume_brl ?? 0;
    // Sem preço executado: fora do acumulado (decisão de 30/08/2026).
    if (r.result_brl == null) { s.sem_preco += 1; continue; }
    const v = r.result_brl;
    s.ops_somaveis += 1;
    if (v >= 0) {
      s.ganhos += 1; s.ganho_bruto += v;
      s.maior_ganho = s.maior_ganho == null ? v : Math.max(s.maior_ganho, v);
    } else {
      s.perdas += 1; s.perda_bruta += Math.abs(v);
      s.maior_perda = s.maior_perda == null ? Math.abs(v) : Math.max(s.maior_perda, Math.abs(v));
    }
  }
  s.resultado_bruto = s.ganho_bruto - s.perda_bruta;
  s.resultado_liquido = s.resultado_bruto - (s.custos_brl ?? 0);
  s.fator_lucro = s.perda_bruta > 0 ? s.ganho_bruto / s.perda_bruta : null;
  s.hit_rate = s.ops_somaveis ? s.ganhos / s.ops_somaveis : null;
  s.ganho_medio = s.ganhos ? s.ganho_bruto / s.ganhos : null;
  s.perda_media = s.perdas ? s.perda_bruta / s.perdas : null;
  return s;
}

function groupBy(
  rows: ExtratoRealRow[],
  key: (r: ExtratoRealRow) => { chave: string; rotulo: string; extra?: Partial<ExtratoGrupo> } | null,
): ExtratoGrupo[] {
  const buckets = new Map<string, { rotulo: string; extra: Partial<ExtratoGrupo>; rows: ExtratoRealRow[] }>();
  for (const r of rows) {
    const k = key(r);
    if (!k) continue;
    const b = buckets.get(k.chave) ?? { rotulo: k.rotulo, extra: k.extra ?? {}, rows: [] };
    b.rows.push(r);
    buckets.set(k.chave, b);
  }
  return [...buckets.entries()].map(([chave, b]) => ({
    chave, rotulo: b.rotulo, ...b.extra, ...statsOf(b.rows),
  }));
}

// Semana ISO em horário de Brasília (a data já vem convertida por saoPauloDate).
const isoWeek = (ymd: string) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const fday = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - fday + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${d.getUTCFullYear()}-S${String(week).padStart(2, "0")}`;
};

export const getB3ExtratoReal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    de?: string | null; ate?: string | null;
    symbols?: string[] | null; variants?: string[] | null; modes?: string[] | null;
  }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const hoje = saoPauloDate(new Date());
    const ate = String(data.ate ?? hoje).slice(0, 10);
    const de = String(data.de ?? shiftDay(ate, -29)).slice(0, 10);

    // O livro FIFO precisa de TODOS os comandos anteriores para casar abertura
    // com fechamento; o corte por data é aplicado na saída, não na consulta.
    const { data: cmds, error } = await (supabase as any).from("b3_mt5_commands")
      .select("id, action, side, symbol, quantity, mode, variant, status, error_message, created_at, filled_at, filled_price, broker_ticket, magic_number, requested_by, broker_position_ticket")
      .eq("user_id", userId).eq("env", "real")
      .order("created_at", { ascending: true }).limit(5000);
    if (error) throw error;

    const commands = (cmds ?? []) as unknown as RealCommandRow[];
    const profileFor = await loadAssetProfiles(supabase);
    const { trades } = buildRealLedger(commands, profileFor);

    // Apelidos e ordem dos modos: a ordenação por modo segue a coluna `ordem`.
    const { data: apelidos } = await (supabase as any)
      .from("b3_mode_apelidos").select("mode, apelido, ordem");
    const modeMeta = new Map<string, { apelido: string; ordem: number }>(
      ((apelidos ?? []) as any[]).map((a) => [String(a.mode), { apelido: String(a.apelido ?? a.mode), ordem: Number(a.ordem ?? 999) }]),
    );

    const inRange = (iso: string | null) => {
      if (!iso) return false;
      const d = saoPauloDate(new Date(iso));
      return d >= de && d <= ate;
    };

    const todas: ExtratoRealRow[] = trades
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
        volume_brl: t.entry_price == null ? null
          : Math.abs(t.entry_price) * profileFor(t.root).point_value_brl * t.quantity,
        broker_ticket: t.broker_ticket,
        fechada_por: (t.closed_by === "user_manual_close"
          ? "manual"
          : t.closed_by
            ? "sistema"
            : "desconhecido") as ExtratoRealRow["fechada_por"],
      }))
      .sort((a, b) => new Date(b.exit_time ?? 0).getTime() - new Date(a.exit_time ?? 0).getTime());

    // Recorte: a testeira e TODOS os agrupamentos usam as mesmas linhas
    // filtradas — total parado com lista filtrada mente.
    const sel = (v?: string[] | null) => {
      if (!Array.isArray(v)) return null;
      const vals = v.map(String).filter((s) => s && s !== "all");
      return new Set(vals);
    };
    const fSym = sel(data.symbols), fVar = sel(data.variants), fMode = sel(data.modes);
    const rows = todas.filter((r) =>
      (!fSym || fSym.has(rootSymbol(r.symbol))) &&
      (!fVar || fVar.has(r.variant)) &&
      (!fMode || fMode.has(r.mode)));

    const stats = statsOf(rows);

    const porDia = groupBy(rows, (r) => (r.data ? { chave: r.data, rotulo: r.data } : null))
      .sort((a, b) => (a.chave < b.chave ? 1 : -1));
    const porRobo = groupBy(rows, (r) => ({
      chave: `${rootSymbol(r.symbol)}|${r.variant}|${r.mode}|${r.magic_number}`,
      rotulo: `${rootSymbol(r.symbol)} · ${r.variant} · ${r.mode}`,
      extra: { root: rootSymbol(r.symbol), variant: r.variant, mode: r.mode, magic_number: r.magic_number },
    })).sort((a, b) => b.resultado_liquido - a.resultado_liquido);
    const porAtivo = groupBy(rows, (r) => ({
      chave: rootSymbol(r.symbol), rotulo: rootSymbol(r.symbol), extra: { root: rootSymbol(r.symbol) },
    })).sort((a, b) => b.resultado_liquido - a.resultado_liquido);
    const porModalidade = groupBy(rows, (r) => ({
      chave: r.variant, rotulo: r.variant, extra: { variant: r.variant },
    })).sort((a, b) => b.resultado_liquido - a.resultado_liquido);
    const porModo = groupBy(rows, (r) => ({
      chave: r.mode,
      rotulo: modeMeta.get(r.mode)?.apelido ?? r.mode,
      extra: { mode: r.mode, ordem: modeMeta.get(r.mode)?.ordem ?? 999 },
    })).sort((a, b) => (a.ordem ?? 999) - (b.ordem ?? 999) || a.chave.localeCompare(b.chave));
    const porSemana = groupBy(rows, (r) => (r.data ? { chave: isoWeek(r.data), rotulo: isoWeek(r.data) } : null))
      .sort((a, b) => (a.chave < b.chave ? 1 : -1));
    const porMes = groupBy(rows, (r) => (r.data ? { chave: r.data.slice(0, 7), rotulo: r.data.slice(0, 7) } : null))
      .sort((a, b) => (a.chave < b.chave ? 1 : -1));

    return {
      de, ate, rows,
      custos_disponiveis: COSTS_AVAILABLE,
      stats,
      // Compatibilidade com os cartões antigos da tela.
      sem_preco: stats.sem_preco,
      total_brl: stats.resultado_liquido,
      total_ops: stats.ops,
      por_dia: porDia,
      por_robo: porRobo,
      por_ativo: porAtivo,
      por_modalidade: porModalidade,
      por_modo: porModo,
      por_semana: porSemana,
      por_mes: porMes,
      filtro: {
        symbols: fSym ? [...fSym] : null,
        variants: fVar ? [...fVar] : null,
        modes: fMode ? [...fMode] : null,
      },
      opcoes: {
        symbols: [...new Set(todas.map((r) => rootSymbol(r.symbol)))].sort(),
        variants: [...new Set(todas.map((r) => r.variant))].sort(),
        modes: [...new Set(todas.map((r) => r.mode))]
          .sort((a, b) => (modeMeta.get(a)?.ordem ?? 999) - (modeMeta.get(b)?.ordem ?? 999)),
      },
    };
  });

