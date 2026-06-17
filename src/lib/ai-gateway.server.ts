// Server-only helper to call Lovable AI Gateway.
// Use only inside `createServerFn` handlers or other server-only modules.

const GATEWAY = "https://ai.gateway.lovable.dev/v1";

function key(): string {
  const k = process.env.LOVABLE_API_KEY;
  if (!k) throw new Error("LOVABLE_API_KEY ausente — habilite Lovable AI nas Conexões.");
  return k;
}

export async function embed(input: string | string[]): Promise<number[][]> {
  const inputs = Array.isArray(input) ? input : [input];
  const res = await fetch(`${GATEWAY}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": key(),
    },
    body: JSON.stringify({
      model: "openai/text-embedding-3-small",
      input: inputs,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`embeddings ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { data: { embedding: number[] }[] };
  return json.data.map((d) => d.embedding);
}

export interface ChatOptions {
  model?: string;
  system?: string;
  user: string;
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  maxTokens?: number;
  temperature?: number;
}

export async function chat<T = string>(opts: ChatOptions): Promise<T> {
  const model = opts.model ?? "google/gemini-3-flash-preview";
  const messages = [
    ...(opts.system ? [{ role: "system", content: opts.system }] : []),
    { role: "user", content: opts.user },
  ];
  const body: Record<string, unknown> = {
    model,
    messages,
    ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
  };
  if (opts.jsonSchema) {
    body.response_format = {
      type: "json_schema",
      json_schema: { name: opts.jsonSchema.name, strict: false, schema: opts.jsonSchema.schema },
    };
  }
  const res = await fetch(`${GATEWAY}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": key(),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`chat ${res.status}: ${text.slice(0, 400)}`);
  }
  const json = (await res.json()) as {
    choices: { message: { content: string } }[];
  };
  const content = json.choices?.[0]?.message?.content ?? "";
  if (opts.jsonSchema) {
    try {
      return JSON.parse(content) as T;
    } catch {
      // strip ```json fences if any
      const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
      return JSON.parse(cleaned) as T;
    }
  }
  return content as unknown as T;
}
