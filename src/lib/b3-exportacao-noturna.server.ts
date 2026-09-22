// EXPORTAÇÃO NOTURNA (22/09/2026) — cópia em CSV do material que a retenção apaga.
//
// Roda dentro do sistema, como a curadoria das 17:35, e não por assistente: o
// conteúdo inteiro nunca cabia num contexto de conversa, e foi isso que fez a
// exportação falhar em 19/09 e 21/09. Aqui o CSV é montado DENTRO do banco
// (public.b3_export_csv_*) e esta função só recebe o texto pronto e grava no
// arquivo — nenhuma linha passa pela aplicação uma a uma.
//
// SÓ LÊ E GRAVA ARQUIVO. Não apaga nada, não toca motor, freio, limite, espelho
// real, criação de comandos, janelas de retenção nem o resto da curadoria.
//
// Cada arquivo tem seu próprio bloco de exceção: uma falha num arquivo nunca
// aborta os outros, e toda falha vira linha de erro em system_logs — foi o
// silêncio que deixou o buraco de 19/09 passar despercebido.

export const BUCKET_ARQUIVO = "b3-arquivo";

type Sb = any;

export type ArquivoExportado = {
  dia: string;
  arquivo: string;
  caminho: string;
  linhas: number | null;
  bytes: number | null;
  status: "gravado" | "existente" | "vazio" | "erro";
  erro?: string;
};

export type ResultadoExportacao = {
  ok: boolean;
  hoje: string;
  dias: string[];
  arquivos: ArquivoExportado[];
  gravados: number;
  falhas: number;
  pendentes: number;
};

const diaBrt = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

const prefixo = (dia: string) => `${dia.slice(0, 4)}/${dia.slice(5, 7)}`;

// Uma listagem por pasta AAAA/MM, reaproveitada entre os dias do mesmo mês.
async function lerPasta(sb: Sb, pasta: string, cache: Map<string, Set<string>>) {
  const pronto = cache.get(pasta);
  if (pronto) return pronto;
  const nomes = new Set<string>();
  const { data, error } = await sb.storage.from(BUCKET_ARQUIVO).list(pasta, { limit: 1000 });
  if (error) throw error;
  for (const f of (data ?? []) as any[]) nomes.add(f.name);
  cache.set(pasta, nomes);
  return nomes;
}

async function csvDoBanco(sb: Sb, fn: string, args: Record<string, unknown>) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  const linha = Array.isArray(data) ? data[0] : data;
  return { linhas: Number(linha?.linhas ?? 0), csv: String(linha?.csv ?? "") };
}

export async function runExportacaoNoturna(
  sb: Sb,
  opts: { force?: boolean; dias?: string[]; maxArquivos?: number } = {},
): Promise<ResultadoExportacao> {
  const hoje = diaBrt();
  const force = opts.force === true;
  const orcamento = Math.max(1, Math.min(60, opts.maxArquivos ?? 10));

  // Dias que AINDA existem no banco — não só o dia corrente. Na primeira
  // execução isso é o backfill: 17/09 e 18/09 só sobrevivem se saírem agora.
  let janela: { dia: string; ativos: string[] }[] = [];
  if (opts.dias?.length) {
    const { data } = await sb.rpc("b3_export_dias", { p_desde: null });
    const porDia = new Map<string, string[]>();
    for (const r of (data ?? []) as any[]) porDia.set(String(r.dia), (r.ativos ?? []) as string[]);
    janela = opts.dias.map((d) => ({ dia: d, ativos: porDia.get(d) ?? [] }));
  } else {
    const { data, error } = await sb.rpc("b3_export_dias", { p_desde: null });
    if (error) throw new Error(`b3_export_dias: ${error.message}`);
    janela = ((data ?? []) as any[]).map((r) => ({ dia: String(r.dia), ativos: (r.ativos ?? []) as string[] }));
  }

  const arquivos: ArquivoExportado[] = [];
  const cache = new Map<string, Set<string>>();
  let gravados = 0;
  let pendentes = 0;

  for (const { dia, ativos } of janela) {
    const tarefas: { nome: string; fn: string; args: Record<string, unknown> }[] = [
      ...ativos.map((a) => ({
        nome: `b3-bloqueios-${dia}-${a}.csv`,
        fn: "b3_export_csv_bloqueios",
        args: { p_date: dia, p_ativo: a },
      })),
      { nome: `b3-dossie-${dia}.csv`, fn: "b3_export_csv_dossie_ordens", args: { p_date: dia } },
      { nome: `b3-dossie-votos-${dia}.csv`, fn: "b3_export_csv_dossie_votos", args: { p_date: dia } },
      { nome: `b3-decisoes-${dia}.csv`, fn: "b3_export_csv_decisoes", args: { p_date: dia } },
    ];

    for (const t of tarefas) {
      const pasta = prefixo(dia);
      const caminho = `${pasta}/${t.nome}`;
      const base: ArquivoExportado = { dia, arquivo: t.nome, caminho, linhas: null, bytes: null, status: "erro" };
      try {
        const existentes = await lerPasta(sb, pasta, cache);
        if (!force && existentes.has(t.nome)) {
          arquivos.push({ ...base, status: "existente" });
          continue;
        }
        if (gravados >= orcamento) {
          pendentes += 1;
          continue;
        }
        const { linhas, csv } = await csvDoBanco(sb, t.fn, t.args);
        if (linhas === 0) {
          arquivos.push({ ...base, linhas: 0, bytes: 0, status: "vazio" });
          continue;
        }
        const corpo = new TextEncoder().encode(csv);
        const { error } = await sb.storage.from(BUCKET_ARQUIVO).upload(caminho, corpo, {
          contentType: "text/csv; charset=utf-8",
          upsert: true,
        });
        if (error) throw error;
        existentes.add(t.nome);
        gravados += 1;
        arquivos.push({ ...base, linhas, bytes: corpo.byteLength, status: "gravado" });
      } catch (e) {
        arquivos.push({ ...base, status: "erro", erro: (e as Error).message });
      }
    }
  }

  const falhas = arquivos.filter((a) => a.status === "erro");

  // Registro: quais dias, quais arquivos, quantas linhas, tamanho e o que falhou.
  try {
    await sb.from("system_logs").insert({
      event_type: "exportacao_noturna",
      source: "b3_exportacao_noturna",
      severity: falhas.length ? "error" : "info",
      message: falhas.length
        ? `Exportação noturna: ${gravados} arquivo(s) gravado(s), ${falhas.length} falha(s)`
        : `Exportação noturna: ${gravados} arquivo(s) gravado(s) de ${janela.length} dia(s)`,
      technical_data: {
        hoje,
        force,
        dias: janela.map((j) => j.dia),
        pendentes,
        gravados: arquivos.filter((a) => a.status === "gravado"),
        existentes: arquivos.filter((a) => a.status === "existente").map((a) => a.caminho),
        vazios: arquivos.filter((a) => a.status === "vazio").map((a) => a.caminho),
        falhas: falhas.map((a) => ({ dia: a.dia, arquivo: a.arquivo, erro: a.erro })),
        bytes_total: arquivos.reduce((s, a) => s + (a.bytes ?? 0), 0),
      },
    });
    // Uma linha de erro POR arquivo que falhou: o log tem que dizer qual dia e
    // qual arquivo, sem depender de alguém abrir o resumo.
    for (const f of falhas) {
      await sb.from("system_logs").insert({
        event_type: "exportacao_noturna",
        source: "b3_exportacao_noturna",
        severity: "error",
        message: `Não exportou ${f.arquivo} do dia ${f.dia}: ${f.erro ?? "erro sem mensagem"}`,
        technical_data: { dia: f.dia, arquivo: f.arquivo, caminho: f.caminho, erro: f.erro },
      });
    }
  } catch {
    // Falhar ao registrar não pode desfazer o que já foi gravado.
  }

  return { ok: falhas.length === 0, hoje, dias: janela.map((j) => j.dia), arquivos, gravados, falhas: falhas.length, pendentes };
}
