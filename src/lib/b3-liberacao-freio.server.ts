// ── LIBERAÇÃO MANUAL DE FREIO PARA O REAL (16/09/2026) ────────────────────────
//
// Em 16/09 o freio de grupo levou WIN/price_action ao nível 4 às 10:15 e travou
// os oito robôs — e como os sete robôs autorizados no real são todos desse
// grupo, o REAL parou por completo. No simulado nada parou: com o modo sombra
// (08/09 para o grupo, 15/09 para os freios de resultado) o robô continua
// entrando e o freio só registra. Quem fica bloqueado é o espelho: nenhuma
// abertura real é enfileirada enquanto o freio daquele robô está acionado.
//
// Este módulo é o interruptor manual desse bloqueio — NÃO do simulado:
// enquanto a liberação vale, o real volta a seguir o simulado ignorando UM
// freio escolhido, por robô ou pelo grupo inteiro.
//
// ESTADO SEM TABELA NOVA: a liberação vive no próprio registro. Cada liberação
// grava `liberacao_manual` em system_logs e cada encerramento grava
// `liberacao_manual_fim`; o estado corrente é o par que ainda não tem fim no
// dia de hoje. O pedido já exigia os dois registros, então não há dado a mais —
// e nenhuma tabela grande é tocada durante o pregão.
//
// O QUE NUNCA É LIBERÁVEL: o disjuntor diário da conta real. Ele é a última
// linha de defesa da conta inteira e não tem botão de contorno; para mexer nele
// se mexe na configuração dele, fora do pregão.
//
// A MEDIÇÃO DA SOMBRA NÃO MUDA: a ordem simulada acontece de qualquer jeito,
// com os mesmos freios registrados em `freios_na_sombra`. O que passa a existir
// é a ordem REAL, marcada com `liberacao_manual` para ser contável — mesmo
// motivo de `manual_close_user` e `grupo_freio_lock` serem separados.
import { isPregaoOpen, saoPauloDate } from "./b3-real-cockpit.server";

export type FreioLiberavel = "grupo" | "pico" | "pos_meta" | "stop_diario";

export const FREIOS_LIBERAVEIS: FreioLiberavel[] = ["grupo", "pico", "pos_meta", "stop_diario"];

export const FREIO_LIBERAVEL_LABEL: Record<FreioLiberavel, string> = {
  grupo: "freio de grupo",
  pico: "freio de pico",
  pos_meta: "proteção pós-meta",
  stop_diario: "stop diário do robô",
};

export type MotivoFim = "travado_pelo_usuario" | "disjuntor_armado" | "fim_do_pregao";

export const MOTIVO_FIM_LABEL: Record<MotivoFim, string> = {
  travado_pelo_usuario: "travado por mim",
  disjuntor_armado: "disjuntor armado (pânico)",
  fim_do_pregao: "fim do pregão",
};

export interface Liberacao {
  escopo: "grupo" | "robo";
  symbol: string;   // RAIZ do ativo (WIN, WDO), nunca o contrato
  variant: string;
  mode: string | null; // null = grupo inteiro
  freio: FreioLiberavel;
  desde: string;
  trade_date: string;
}

export function chaveLiberacao(l: {
  escopo: string; symbol: string; variant: string; mode: string | null; freio: string;
}) {
  return `${l.escopo}|${l.symbol}|${l.variant}|${l.mode ?? "*"}|${l.freio}`;
}

function isFreioLiberavel(v: unknown): v is FreioLiberavel {
  return typeof v === "string" && (FREIOS_LIBERAVEIS as string[]).includes(v);
}

/**
 * Liberações ABERTAS (sem encerramento registrado) dos últimos dias, com o dia
 * de pregão de cada uma. Quem decide o que ainda vale é `separarLiberacoes`.
 */
export async function listLiberacoesAbertas(
  supabase: any, userId: string, dias = 3,
): Promise<Liberacao[]> {
  const since = new Date(Date.now() - dias * 24 * 3600_000).toISOString();
  const { data, error } = await supabase.from("system_logs")
    .select("event_type, message, technical_data, created_at")
    .in("event_type", ["liberacao_manual", "liberacao_manual_fim"])
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(2000);
  if (error) return [];

  const abertas = new Map<string, Liberacao>();
  for (const row of (data ?? []) as any[]) {
    const t = row.technical_data ?? {};
    if (t.user_id && t.user_id !== userId) continue;
    if (!isFreioLiberavel(t.freio)) continue;
    const lib: Liberacao = {
      escopo: t.escopo === "grupo" ? "grupo" : "robo",
      symbol: String(t.symbol ?? ""),
      variant: String(t.variant ?? ""),
      mode: t.mode ? String(t.mode) : null,
      freio: t.freio,
      desde: String(t.desde ?? row.created_at),
      trade_date: String(t.trade_date ?? saoPauloDate(new Date(row.created_at))),
    };
    if (!lib.symbol || !lib.variant) continue;
    const k = chaveLiberacao(lib);
    if (row.event_type === "liberacao_manual") abertas.set(k, lib);
    else abertas.delete(k);
  }
  return Array.from(abertas.values());
}

/**
 * Divide as liberações abertas entre as que ainda valem e as que expiraram.
 * Nenhuma liberação atravessa o fim do pregão: virou outro dia, ou o pregão
 * fechou, ela cai (e o encerramento é registrado por quem chamar).
 */
export function separarLiberacoes(abertas: Liberacao[], now = new Date()) {
  const hoje = saoPauloDate(now);
  const pregao = isPregaoOpen(now);
  const ativas: Liberacao[] = [];
  const expiradas: Liberacao[] = [];
  for (const l of abertas) {
    if (l.trade_date === hoje && pregao) ativas.push(l);
    else expiradas.push(l);
  }
  return { ativas, expiradas };
}

/** Liberações que valem AGORA, já com as expiradas encerradas e registradas. */
export async function listLiberacoesAtivas(supabase: any, userId: string): Promise<Liberacao[]> {
  const abertas = await listLiberacoesAbertas(supabase, userId);
  const { ativas, expiradas } = separarLiberacoes(abertas);
  if (expiradas.length) {
    await encerrarLiberacoes(supabase, userId, expiradas, "fim_do_pregao");
  }
  return ativas;
}

/**
 * Este robô está com ESTE freio liberado? O escopo de grupo cobre todos os
 * robôs do par ativo/modalidade — foi o caso que motivou o botão: sete robôs
 * travados por uma decisão única não podem exigir sete cliques.
 */
export function freioLiberado(
  liberacoes: Liberacao[], symbolRoot: string, variant: string, mode: string, freio: string,
): Liberacao | null {
  return liberacoes.find((l) =>
    l.freio === freio && l.symbol === symbolRoot && l.variant === variant &&
    (l.escopo === "grupo" ? true : l.mode === mode),
  ) ?? null;
}

export async function registrarLiberacao(
  supabase: any, userId: string, lib: Omit<Liberacao, "desde" | "trade_date">,
  estadoDoFreio: Record<string, unknown> = {},
) {
  const now = new Date();
  const full: Liberacao = {
    ...lib, desde: now.toISOString(), trade_date: saoPauloDate(now),
  };
  const alvo = lib.escopo === "grupo"
    ? `${lib.symbol}/${lib.variant} (grupo inteiro)`
    : `${lib.symbol}/${lib.variant}/${lib.mode}`;
  await supabase.from("system_logs").insert({
    event_type: "liberacao_manual",
    source: "cockpit_simulado",
    severity: "warning",
    message: `LIBERAÇÃO MANUAL: ${FREIO_LIBERAVEL_LABEL[lib.freio]} ignorado no REAL para ${alvo}. O simulado não muda; o espelho volta a enfileirar comando real.`,
    // `entry_style` é o mesmo valor de `variant` — repetido com o nome usado no
    // log de decisão de entrada, para o cruzamento não depender de tradução.
    technical_data: { user_id: userId, ...full, entry_style: full.variant, estado_do_freio: estadoDoFreio } as any,
  });
  return full;
}

export async function encerrarLiberacoes(
  supabase: any, userId: string, libs: Liberacao[], motivo: MotivoFim,
) {
  if (!libs.length) return 0;
  const rows = libs.map((l) => ({
    event_type: "liberacao_manual_fim",
    source: "cockpit_simulado",
    severity: "info",
    message: `Liberação encerrada (${MOTIVO_FIM_LABEL[motivo]}): ${FREIO_LIBERAVEL_LABEL[l.freio]} volta a bloquear o REAL em ${l.symbol}/${l.variant}/${l.mode ?? "grupo inteiro"}.`,
    technical_data: {
      user_id: userId, ...l, entry_style: l.variant,
      inicio: l.desde, fim: new Date().toISOString(), motivo_fim: motivo,
    } as any,
  }));
  try {
    await supabase.from("system_logs").insert(rows);
  } catch { return 0; }
  return rows.length;
}

/** Botão vermelho (pânico): não sobra real para liberar, tudo cai junto. */
export async function encerrarTodasLiberacoes(
  supabase: any, userId: string, motivo: MotivoFim = "disjuntor_armado",
) {
  const abertas = await listLiberacoesAbertas(supabase, userId);
  return encerrarLiberacoes(supabase, userId, abertas, motivo);
}
