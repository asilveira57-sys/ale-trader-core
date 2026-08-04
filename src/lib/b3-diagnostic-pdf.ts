// Gera um PDF de texto com todo o conteúdo do Diagnóstico do Motor (B3 MT5).
// Somente leitura — não altera regras, motor, ordens ou parâmetros.
import { jsPDF } from "jspdf";

const M = 36; // margem
const LH = 12; // altura da linha

function fmtNum(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "number") return v.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
  return String(v);
}

function fmtTime(v: unknown): string {
  if (!v) return "—";
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? String(v) : d.toLocaleString("pt-BR");
}

class Writer {
  doc: jsPDF;
  y = M;
  constructor() {
    this.doc = new jsPDF({ unit: "pt", format: "a4" });
    this.doc.setFont("helvetica", "normal");
  }
  private space(n = LH) {
    const h = this.doc.internal.pageSize.getHeight();
    if (this.y + n > h - M) {
      this.doc.addPage();
      this.y = M;
    }
  }
  h1(t: string) {
    this.space(28);
    this.doc.setFont("helvetica", "bold").setFontSize(15);
    this.doc.text(t, M, this.y);
    this.y += 20;
    this.doc.setFont("helvetica", "normal").setFontSize(9);
  }
  h2(t: string) {
    this.space(22);
    this.y += 6;
    this.doc.setFont("helvetica", "bold").setFontSize(11);
    this.doc.text(t, M, this.y);
    this.y += 15;
    this.doc.setFont("helvetica", "normal").setFontSize(9);
  }
  h3(t: string) {
    this.space(18);
    this.y += 4;
    this.doc.setFont("helvetica", "bold").setFontSize(9.5);
    this.doc.text(t, M, this.y);
    this.y += 13;
    this.doc.setFont("helvetica", "normal").setFontSize(9);
  }
  p(t: string, indent = 0) {
    const w = this.doc.internal.pageSize.getWidth() - M * 2 - indent;
    this.doc.setFontSize(9);
    const lines = this.doc.splitTextToSize(t, w) as string[];
    for (const ln of lines) {
      this.space();
      this.doc.text(ln, M + indent, this.y);
      this.y += LH;
    }
  }
  kv(label: string, value: unknown, indent = 0) {
    this.p(`${label}: ${fmtNum(value)}`, indent);
  }
  gap(n = 6) {
    this.y += n;
  }
  save(name: string) {
    const total = this.doc.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
      this.doc.setPage(i);
      this.doc.setFontSize(7.5).setTextColor(120);
      this.doc.text(
        `AleTrader AI · Diagnóstico do Motor B3 MT5 · página ${i}/${total}`,
        M,
        this.doc.internal.pageSize.getHeight() - 18,
      );
      this.doc.setTextColor(0);
    }
    this.doc.save(name);
  }
}

// Serializa qualquer objeto em linhas "chave: valor" (profundidade limitada).
function dump(w: Writer, obj: unknown, indent = 0, depth = 0) {
  if (obj == null) return;
  if (Array.isArray(obj)) {
    obj.forEach((it, i) => {
      if (it && typeof it === "object") {
        w.p(`[${i + 1}]`, indent);
        dump(w, it, indent + 10, depth + 1);
      } else {
        w.p(`[${i + 1}] ${fmtNum(it)}`, indent);
      }
    });
    return;
  }
  if (typeof obj !== "object") {
    w.p(fmtNum(obj), indent);
    return;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (v == null) {
      w.p(`${k}: —`, indent);
    } else if (typeof v === "object") {
      if (depth >= 3) {
        w.p(`${k}: ${JSON.stringify(v).slice(0, 600)}`, indent);
      } else {
        w.p(`${k}:`, indent);
        dump(w, v, indent + 10, depth + 1);
      }
    } else {
      w.p(`${k}: ${fmtNum(v)}`, indent);
    }
  }
}

export interface DiagnosticPdfInput {
  diag: any; // getB3EngineDiagnostic
  audit: any; // getB3PipelineAudit
}

export function generateB3DiagnosticPdf({ diag, audit }: DiagnosticPdfInput): string {
  const w = new Writer();
  const now = new Date();

  w.h1("Diagnóstico do Motor — B3 Day Trade (WIN) / MT5");
  w.p(`Gerado em: ${now.toLocaleString("pt-BR")}`);
  w.p(`Dia da sessão: ${diag?.session_date ?? audit?.session_date ?? "—"}`);
  w.p(`Reinícios da sessão: ${fmtNum(diag?.restart_count ?? audit?.restart_count ?? 0)}`);
  w.p(`Fonte de cotação: ${diag?.price_source ?? "—"}`);

  // ── Execuções do dia
  const execs: any[] = diag?.executions ?? audit?.executions ?? [];
  if (execs.length) {
    w.h2(`Execuções do dia (${execs.length})`);
    execs.forEach((e, i) => {
      w.p(
        `#${i + 1} · ${fmtTime(e.started_at)} → ${e.finished_at ? fmtTime(e.finished_at) : "em andamento"} · ${fmtNum(e.duration_s)}s · ${e.status}`,
      );
    });
  }

  // ── Run atual
  if (diag?.run) {
    w.h2("Simulação (run) atual");
    dump(w, diag.run);
  }

  // ── Último tick / snapshot
  if (diag?.snapshot) {
    const { extra, ...rest } = diag.snapshot as any;
    w.h2("Último snapshot de mercado (tick)");
    dump(w, rest);
  }

  // ── Auditoria do motor (engine_audit) do último tick
  if (diag?.audit) {
    w.h2("Auditoria do motor no último tick (engine_audit)");
    dump(w, diag.audit);
  }

  // ── Configuração efetiva por modo
  const settings: any[] = diag?.settings ?? [];
  if (settings.length) {
    w.h2("Configuração efetiva por robô/modo");
    settings.forEach((s) => {
      w.h3(String(s.mode ?? s.id ?? "modo"));
      dump(w, s, 10);
    });
  }

  // ── Totais do pipeline
  if (audit?.totals) {
    w.h2("Totais do pipeline (dia)");
    dump(w, audit.totals);
  }

  // ── Pipeline por robô
  const modes: any[] = (audit?.modes ?? []).filter(Boolean);
  if (modes.length) {
    w.h2("Pipeline de decisão — por robô");
    modes.forEach((m) => {
      w.h3(`Robô: ${m.mode ?? "—"}`);
      dump(w, m, 10);
    });
  }

  // ── Histórico de bloqueios (últimos 100)
  const history: any[] = audit?.history ?? [];
  if (history.length) {
    w.h2(`Histórico de bloqueios (${history.length} mais recentes)`);
    history.forEach((h, i) => {
      w.p(
        `${i + 1}. ${fmtTime(h.at)} · ${h.mode ?? "—"} · ${h.step ?? h.stage ?? "—"} · ${h.reason ?? "—"}`,
      );
      const rest = { ...h };
      delete rest.at; delete rest.mode; delete rest.step; delete rest.stage; delete rest.reason;
      if (Object.keys(rest).length) dump(w, rest, 14, 2);
    });
  }

  // ── Decisões (últimas 100)
  const decisions: any[] = audit?.decisions ?? [];
  if (decisions.length) {
    w.h2(`Decisões registradas (${decisions.length} mais recentes)`);
    decisions.forEach((d, i) => {
      w.p(`${i + 1}.`);
      dump(w, d, 14, 1);
    });
  }

  // ── Eventos de trade
  const events: any[] = audit?.trade_events ?? [];
  if (events.length) {
    w.h2(`Eventos de trade (${events.length} mais recentes)`);
    events.forEach((e, i) => {
      w.p(`${i + 1}.`);
      dump(w, e, 14, 1);
    });
  }

  const stamp = `${now.toISOString().slice(0, 10)}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  const filename = `diagnostico-motor-b3_${stamp}.pdf`;
  w.save(filename);
  return filename;
}
