import { z } from "zod";
export type Marco = { id: string; data: string; titulo: string; descricao: string; escopo: string; symbol: string | null; variant: string | null; criado_em?: string };
export const marcoInput = z.object({ id: z.string().uuid().optional(), data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), titulo: z.string().trim().min(1).max(100), descricao: z.string().trim().min(1), escopo: z.enum(["global", "ativo", "modalidade"]), symbol: z.string().nullable(), variant: z.string().nullable() }).superRefine((v, ctx) => {
  if (v.escopo !== "global" && !v.symbol) ctx.addIssue({ code: "custom", message: "Escolha o ativo." });
  if (v.escopo === "modalidade" && !v.variant) ctx.addIssue({ code: "custom", message: "Escolha a modalidade." });
});
export const marcosNoRecorte = (rows: Marco[], start: string, end: string, symbol?: string, variant?: string) => rows.filter(r => r.data >= start && r.data <= end && (r.escopo === "global" || ((!symbol || r.symbol === symbol) && (!variant || r.escopo === "ativo" || r.variant === variant))));
export const marcoCopy = (r: Marco) => `${r.data} · ${r.titulo}\n${r.descricao}\nEscopo: ${r.escopo}\nAtivo: ${r.symbol ?? "sem registro"}\nModalidade: ${r.variant ?? "sem registro"}\nCriado: ${r.criado_em ?? "sem registro"}`;