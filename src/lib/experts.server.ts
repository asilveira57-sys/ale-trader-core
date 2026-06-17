// Server-only helpers for expert ingestion, embedding and strategy extraction.
import { embed, chat } from "./ai-gateway.server";

// ---------------- Text utilities ----------------

export function chunkText(text: string, target = 900, overlap = 150): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const out: string[] = [];
  let i = 0;
  while (i < clean.length) {
    const end = Math.min(clean.length, i + target);
    // backtrack to a sentence boundary when possible
    let cut = end;
    if (end < clean.length) {
      const slice = clean.slice(i, end);
      const lastDot = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("? "), slice.lastIndexOf("! "));
      if (lastDot > target * 0.5) cut = i + lastDot + 1;
    }
    out.push(clean.slice(i, cut).trim());
    if (cut >= clean.length) break;
    i = Math.max(cut - overlap, cut);
  }
  return out.filter((c) => c.length > 40);
}

// ---------------- YouTube transcript ----------------

export async function fetchYoutubeTranscript(url: string): Promise<{ text: string; title?: string }> {
  const { YoutubeTranscript } = await import("youtube-transcript");
  let entries: Array<{ text: string }>;
  try {
    entries = await YoutubeTranscript.fetchTranscript(url, { lang: "pt" } as any);
  } catch {
    entries = await YoutubeTranscript.fetchTranscript(url);
  }
  const text = entries.map((e) => e.text).join(" ").replace(/\s+/g, " ").trim();
  if (!text) throw new Error("Vídeo sem legendas disponíveis (pt/en).");
  return { text };
}

// ---------------- PDF extraction ----------------

export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(bytes);
  const { text } = await extractText(doc, { mergePages: true });
  const joined = Array.isArray(text) ? text.join("\n") : text;
  return (joined || "").replace(/\s+\n/g, "\n").trim();
}

// ---------------- Strategy extraction prompt ----------------

const STRATEGY_SCHEMA = {
  type: "object",
  properties: {
    philosophy: { type: "string" },
    buy_criteria: { type: "string" },
    sell_criteria: { type: "string" },
    risk_criteria: { type: "string" },
    confirmation_criteria: { type: "string" },
    exclusion_criteria: { type: "string" },
    catchphrases: { type: "array", items: { type: "string" }, maxItems: 8 },
    suggested_agent_name: { type: "string" },
    risk_profile: { type: "string", enum: ["conservador", "moderado", "agressivo"] },
  },
  required: [
    "philosophy",
    "buy_criteria",
    "sell_criteria",
    "risk_criteria",
    "confirmation_criteria",
    "exclusion_criteria",
  ],
} as const;

export interface StrategyResult {
  philosophy: string;
  buy_criteria: string;
  sell_criteria: string;
  risk_criteria: string;
  confirmation_criteria: string;
  exclusion_criteria: string;
  catchphrases?: string[];
  suggested_agent_name?: string;
  risk_profile?: "conservador" | "moderado" | "agressivo";
}

export async function extractStrategyFromCorpus(
  expertName: string,
  corpus: string,
): Promise<StrategyResult> {
  // Trim corpus to keep prompt under model limit (~30k chars worth of tokens)
  const trimmed = corpus.length > 28000 ? corpus.slice(0, 28000) : corpus;
  return chat<StrategyResult>({
    model: "google/gemini-3-flash-preview",
    system:
      "Você analisa material de estratégias de investimento (não copia pessoas, extrai padrões de raciocínio). Responda apenas no JSON pedido, em português.",
    user: `A partir do conteúdo abaixo, descreva como o especialista "${expertName}" pensa. Foque em padrões de decisão genéricos e não atribua opiniões inventadas.\n\n--- CONTEÚDO ---\n${trimmed}\n--- FIM ---`,
    jsonSchema: { name: "expert_strategy", schema: STRATEGY_SCHEMA as any },
    temperature: 0.3,
  });
}

// ---------------- Expert vote prompt ----------------

const VOTE_SCHEMA = {
  type: "object",
  properties: {
    vote: { type: "string", enum: ["buy", "sell", "hold", "wait"] },
    confidence: { type: "number" },
    perceived_risk: { type: "number" },
    justification: { type: "string" },
    has_veto: { type: "boolean" },
    veto_reason: { type: "string" },
  },
  required: ["vote", "confidence", "perceived_risk", "justification"],
} as const;

export interface ExpertVote {
  vote: "buy" | "sell" | "hold" | "wait";
  confidence: number;
  perceived_risk: number;
  justification: string;
  has_veto?: boolean;
  veto_reason?: string;
}

export async function expertVote(args: {
  expertName: string;
  strategy: StrategyResult | null;
  context: Record<string, unknown>;
  chunks: { content: string; similarity: number }[];
}): Promise<ExpertVote> {
  const knowledge =
    args.chunks
      .slice(0, 5)
      .map((c, i) => `[${i + 1}] (sim ${c.similarity.toFixed(2)}) ${c.content.slice(0, 600)}`)
      .join("\n\n") || "(nenhuma memória relevante)";
  const strat = args.strategy
    ? `Filosofia: ${args.strategy.philosophy}\nCompra: ${args.strategy.buy_criteria}\nVenda: ${args.strategy.sell_criteria}\nRisco: ${args.strategy.risk_criteria}\nConfirmação: ${args.strategy.confirmation_criteria}\nExclusão: ${args.strategy.exclusion_criteria}`
    : "(estratégia ainda não extraída)";

  return chat<ExpertVote>({
    model: "google/gemini-3-flash-preview",
    system:
      "Você é um agente votante de um comitê de simulação de criptomoedas. Vote estritamente segundo a estratégia descrita. Nunca prometa lucro. Responda apenas no JSON pedido, em português.",
    user: `Especialista: ${args.expertName}\n\n=== ESTRATÉGIA ===\n${strat}\n\n=== MEMÓRIA RELEVANTE ===\n${knowledge}\n\n=== MERCADO ===\n${JSON.stringify(args.context, null, 2)}\n\nDecida vote ∈ {buy,sell,hold,wait}, confidence/perceived_risk (0-100), justification curta (≤240 chars). has_veto=true só em risco extremo.`,
    jsonSchema: { name: "expert_vote", schema: VOTE_SCHEMA as any },
    temperature: 0.4,
    maxTokens: 600,
  });
}

// ---------------- Debate ----------------

const DEBATE_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    transcript: {
      type: "array",
      items: {
        type: "object",
        properties: {
          agent: { type: "string" },
          message: { type: "string" },
        },
        required: ["agent", "message"],
      },
    },
  },
  required: ["summary", "transcript"],
} as const;

export interface DebateResult {
  summary: string;
  transcript: { agent: string; message: string }[];
}

export async function generateDebateText(args: {
  pair: string;
  decision: string;
  votes: { agent: string; vote: string; confidence: number; justification: string }[];
}): Promise<DebateResult> {
  return chat<DebateResult>({
    model: "google/gemini-3-flash-preview",
    system:
      "Você modera um comitê de simulação. Gere um debate curto e respeitoso (até 2 turnos por agente) e um resumo final objetivo. Português, sem promessa de lucro.",
    user: `Ativo: ${args.pair}\nDecisão consolidada: ${args.decision}\n\nVotos:\n${args.votes.map((v) => `- ${v.agent} → ${v.vote} (conf ${v.confidence.toFixed(0)}): ${v.justification}`).join("\n")}\n\nGere transcript (até 8 mensagens) e summary (≤320 chars).`,
    jsonSchema: { name: "debate", schema: DEBATE_SCHEMA as any },
    temperature: 0.6,
    maxTokens: 900,
  });
}
