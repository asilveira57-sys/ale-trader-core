// Cópia em texto puro para a área de transferência. Só apresentação.
import { toast } from "sonner";

export async function copiarTexto(texto: string) {
  try {
    await navigator.clipboard.writeText(texto);
    toast.success("Copiado");
  } catch {
    const ta = document.createElement("textarea");
    ta.value = texto; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); toast.success("Copiado"); } catch { toast.error("Não foi possível copiar"); }
    ta.remove();
  }
}

// Tabela tabulada (cola certo em planilha e em mensagem).
export const tabular = (header: string[], rows: (string | number | null | undefined)[][]) =>
  [header, ...rows].map((r) => r.map((c) => (c == null ? "" : String(c))).join("\t")).join("\n");
