// Cópia em texto, XLSX e PDF do painel por ativo (/b3/ativo/$symbol).
// Somente apresentação: nada aqui participa do motor de simulação.

import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import { decimalsForTick, BRL, SIGNED_BRL, assetLabel } from "./b3-format";

const VARIANT_LABEL: Record<string, string> = {
  indicador: "indicador",
  price_action: "price action",
  mean_reversion: "reversão à média",
  range: "faixa",
};
export const variantLabel = (v: string) => VARIANT_LABEL[v] ?? String(v ?? "");
export const modeLabel = (m: string) => String(m ?? "").replace("_", " ");

const dm = (d: string) => (d ? d.slice(8, 10) + "/" + d.slice(5, 7) : "—");

export const scopeLabel = (d: any) => {
  const parts = [d?.root ?? "—"];
  if (d?.variant && d.variant !== "all") parts.push(variantLabel(d.variant));
  if (d?.mode && d.mode !== "all") parts.push(modeLabel(d.mode));
  const de = d?.periodo?.de, ate = d?.periodo?.ate;
  parts.push(de === ate ? dm(de) : `${dm(de)} a ${dm(ate)}`);
  return parts.join(" · ");
};

export const fileScope = (d: any) => {
  const parts = ["b3", String(d?.root ?? "ativo")];
  if (d?.variant && d.variant !== "all") parts.push(String(d.variant).replace("_", "-"));
  if (d?.mode && d.mode !== "all") parts.push(String(d.mode).replace("_", "-"));
  const de = d?.periodo?.de, ate = d?.periodo?.ate;
  parts.push(de === ate ? de : `${de}_a_${ate}`);
  return parts.join("_");
};

const PXn = (v: number | null | undefined, tick: number) =>
  v == null ? "—" : Number(v).toLocaleString("pt-BR", {
    minimumFractionDigits: decimalsForTick(tick),
    maximumFractionDigits: decimalsForTick(tick),
  });

// Em ações (tick 0,01) o movimento é lido em centavos; em futuros, em pontos.
const movementText = (pts: number | null, tick: number) => {
  if (pts == null) return "—";
  if (Number(tick) <= 0.01) {
    const cents = Math.round(pts * 100);
    return `${cents > 0 ? "+" : ""}${cents} centavos`;
  }
  const d = decimalsForTick(tick);
  return `${pts > 0 ? "+" : ""}${Number(pts).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d })} pts`;
};

const stamp = () => {
  const now = new Date();
  return `${now.toLocaleDateString("pt-BR")} ${now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
};

// ─────────────────────────── copiar (texto puro) ───────────────────────────

export function buildAssetCopyText(d: any): string {

  const tick = Number(d?.tick_size ?? 5);
  const lines: string[] = [`AleTrader B3 — ${stamp()} — ${scopeLabel(d)} (${assetLabel(d.root)})`];
  lines.push(
    `resultado ${SIGNED_BRL(d.resultado_dia_brl)} · realizado ${BRL(d.realizado_brl)} · em aberto ${BRL(d.aberto_brl)}`,
  );
  if (!d.multi_day) {
    lines.push(`limite de perda ${BRL(d.scale_brl)} · ${Number(d.pior_ponto_pct ?? 0).toFixed(0)}% usado no pior momento`);
  }
  lines.push(
    `ganhos ${SIGNED_BRL(d.ganhos_brl)} · perdas ${BRL(d.perdas_brl)} · ${d.ops_total ?? 0} ops (${d.ops_lucro ?? 0} no lucro)`,
  );
  lines.push(
    `pico de exposição ${BRL(d.pico_exposicao_brl)} · ${d.pico_exposicao_data ? dm(d.pico_exposicao_data) + " " : ""}${d.pico_exposicao_hora ?? "—"} · ${d.pico_contratos ?? 0} contratos`,
  );

  if (d.multi_day && d.dias?.length) {
    lines.push("");
    lines.push("Por pregão:");
    for (const dia of d.dias) {
      const sujo = dia.limpo === false ? ` · pregão sujo: ${dia.motivo_sujo ?? "sem motivo"}` : "";
      lines.push(`  ${dm(dia.trade_date)} ${SIGNED_BRL(dia.resultado_brl)} · ${dia.ops} ops${sujo}`);
    }
  }

  for (const g of d.groups ?? []) {
    lines.push("");
    lines.push(`${variantLabel(g.variant)} — ${SIGNED_BRL(g.resultado_brl)} · ${g.ops} ops · ${g.wins} no lucro (${Number(g.hit_rate ?? 0).toFixed(1)}%)`);
    for (const m of g.modes ?? []) {
      lines.push(`  ${modeLabel(m.mode)}: ${SIGNED_BRL(m.resultado_brl)} · ${m.ops} ops · ${Number(m.hit_rate ?? 0).toFixed(0)}% acerto${m.enabled === false ? " · desligado" : ""}`);
    }
  }
  void PXn; void tick;
  return lines.join("\n").trimEnd();
}

export function buildModeCopyText(d: any, variant: string, m: any): string {
  const tick = Number(d?.tick_size ?? 5);
  const de = d?.periodo?.de, ate = d?.periodo?.ate;
  const periodo = de === ate ? dm(de) : `${dm(de)} a ${dm(ate)}`;
  const lines: string[] = [
    `AleTrader B3 — ${stamp()} — ${d.root} · ${variantLabel(variant)} · ${modeLabel(m.mode)} · ${periodo}`,
    `resultado ${SIGNED_BRL(m.resultado_brl)} · ${m.ops} ops · ${m.wins} no lucro (${Number(m.hit_rate ?? 0).toFixed(1)}%)`,
    `ganhos ${SIGNED_BRL(m.ganhos_brl)} · perdas ${BRL(m.perdas_brl)}${m.enabled === false ? " · desligado" : ""}`,
  ];
  const ops = (d.orders ?? []).filter((o: any) => o.mode === m.mode && o.variant === variant);
  if (ops.length) {
    lines.push("");
    for (const o of ops.slice(0, 40)) {
      lines.push(
        `  ${dm(o.trade_date)} ${o.hora_entrada}→${o.hora_saida ?? "aberta"} ${o.side === "buy" ? "COMPRA" : "VENDA"} ${o.quantity}x @ ${PXn(o.entry_price, tick)}` +
        ` → ${PXn(o.exit_price, tick)} (${movementText(o.pontos, tick)}, ${o.net_brl == null ? "em aberto" : SIGNED_BRL(o.net_brl)})${o.close_reason ? ` · ${o.close_reason}` : ""}`,
      );
    }
    if (ops.length > 40) lines.push(`  … e outras ${ops.length - 40} operações`);
  }
  return lines.join("\n");
}

// ─────────────────────────────── XLSX ───────────────────────────────

export function exportAssetXlsx(d: any) {
  const resumo = [
    ["Ativo", "Modalidade", "Modo", "Pregões", "Operações", "Acertos", "Taxa de acerto (%)",
      "Ganhos (R$)", "Perdas (R$)", "Resultado (R$)", "Capital exigido (R$)", "Retorno sobre capital (%)", "Pior drawdown (R$)"],
  ];
  const pregoes = d.multi_day ? (d.dias?.length ?? 0) : 1;
  for (const g of d.groups ?? []) {
    for (const m of g.modes ?? []) {
      const capital = Number(m.capital_exigido_brl ?? m.daily_loss_limit_brl ?? 0);
      const res = Number(m.resultado_brl ?? 0);
      resumo.push([
        d.root, variantLabel(g.variant), modeLabel(m.mode), pregoes,
        Number(m.ops ?? 0), Number(m.wins ?? 0), Number(Number(m.hit_rate ?? 0).toFixed(1)),
        Number(m.ganhos_brl ?? 0), Number(m.perdas_brl ?? 0), res,
        capital, capital > 0 ? Number(((res / capital) * 100).toFixed(2)) : 0,
        Number(m.perdas_brl ?? 0),
      ] as any);
    }
  }

  const ops = [
    ["Data", "Entrada", "Saída", "Modo", "Modalidade", "Lado", "Qtd", "Preço entrada",
      "Preço saída", "Pontos", "Resultado líquido (R$)", "Motivo do fechamento"],
  ];
  for (const o of d.orders ?? []) {
    ops.push([
      o.trade_date, o.hora_entrada, o.hora_saida ?? "", modeLabel(o.mode), variantLabel(o.variant),
      o.side === "buy" ? "Compra" : "Venda", o.quantity, o.entry_price, o.exit_price ?? "",
      o.pontos ?? "", o.net_brl ?? "", o.close_reason ?? "",
    ] as any);
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumo), "Resumo");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ops), "Operações");
  XLSX.writeFile(wb, `${fileScope(d)}.xlsx`);
}

// ─────────────────────────────── PDF ───────────────────────────────

const M = 36, LH = 12;

export function exportAssetPdf(d: any) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  let y = M;
  const nl = (n = LH) => {
    if (y + n > doc.internal.pageSize.getHeight() - M) { doc.addPage(); y = M; }
    y += n;
  };

  doc.setFont("helvetica", "bold").setFontSize(15);
  doc.text(`${d.root} — ${assetLabel(d.root)}`, M, y);
  y += 18;
  doc.setFont("helvetica", "normal").setFontSize(9.5);
  doc.text(`${scopeLabel(d)} · gerado em ${stamp()}`, M, y);
  y += 8;
  doc.setDrawColor(180).line(M, y, W - M, y);
  y += 16;

  // Números consolidados
  doc.setFont("helvetica", "bold").setFontSize(11).text("Consolidado do período", M, y);
  y += 15;
  doc.setFont("helvetica", "normal").setFontSize(9.5);
  const linhas = [
    `Resultado: ${SIGNED_BRL(d.resultado_dia_brl)}   (realizado ${BRL(d.realizado_brl)} · em aberto ${BRL(d.aberto_brl)})`,
    `Ganhos: ${SIGNED_BRL(d.ganhos_brl)}   Perdas: ${BRL(d.perdas_brl)}`,
    `Operações: ${d.ops_total ?? 0}   No lucro: ${d.ops_lucro ?? 0}`,
    `Pico de exposição: ${BRL(d.pico_exposicao_brl)} (${d.pico_exposicao_data ? dm(d.pico_exposicao_data) + " " : ""}${d.pico_exposicao_hora ?? "—"} · ${d.pico_contratos ?? 0} contratos)`,
    d.multi_day
      ? `Pregões no período: ${d.dias?.length ?? 0}`
      : `Limite de perda diário: ${BRL(d.scale_brl)} · ${Number(d.pior_ponto_pct ?? 0).toFixed(0)}% usado no pior momento`,
  ];
  for (const l of linhas) { doc.text(l, M, y); nl(13); }

  // Tabela por modo
  nl(10);
  doc.setFont("helvetica", "bold").setFontSize(11).text("Desempenho por modo", M, y);
  nl(16);
  const cols = [M, M + 110, M + 210, M + 260, M + 315, M + 380, M + 450];
  const head = ["Modalidade", "Modo", "Ops", "Acerto", "Ganhos", "Perdas", "Resultado"];
  doc.setFont("helvetica", "bold").setFontSize(8.5);
  head.forEach((h, i) => doc.text(h, cols[i], y));
  nl(11);
  doc.setFont("helvetica", "normal");
  for (const g of d.groups ?? []) {
    for (const m of g.modes ?? []) {
      const cells = [
        variantLabel(g.variant), modeLabel(m.mode), String(m.ops ?? 0),
        `${Number(m.hit_rate ?? 0).toFixed(0)}%`,
        BRL(m.ganhos_brl), BRL(m.perdas_brl), SIGNED_BRL(m.resultado_brl),
      ];
      cells.forEach((c, i) => doc.text(c, cols[i], y));
      nl(11);
    }
  }

  // Gráfico de barras por dia
  const dias = (d.dias ?? []) as any[];
  if (dias.length) {
    nl(14);
    if (y + 150 > doc.internal.pageSize.getHeight() - M) { doc.addPage(); y = M; }
    doc.setFont("helvetica", "bold").setFontSize(11).text("Resultado por pregão", M, y);
    y += 16;
    const gw = W - M * 2, gh = 110, base = y + gh / 2;
    const max = Math.max(1, ...dias.map((x) => Math.abs(Number(x.resultado_brl ?? 0))));
    const bw = Math.min(28, gw / dias.length - 4);
    doc.setDrawColor(200).line(M, base, M + gw, base);
    doc.setFontSize(7);
    dias.forEach((x, i) => {
      const v = Number(x.resultado_brl ?? 0);
      const h = (Math.abs(v) / max) * (gh / 2 - 8);
      const cx = M + (gw / dias.length) * i + (gw / dias.length - bw) / 2;
      const sujo = x.limpo === false;
      if (v >= 0) doc.setFillColor(sujo ? 150 : 40, sujo ? 190 : 160, sujo ? 150 : 90);
      else doc.setFillColor(sujo ? 200 : 190, sujo ? 150 : 70, sujo ? 150 : 70);
      doc.rect(cx, v >= 0 ? base - h : base, bw, Math.max(1, h), "F");
      doc.setTextColor(110).text(dm(x.trade_date), cx + bw / 2, base + gh / 2 + 6, { align: "center" });
      doc.setTextColor(60).text(SIGNED_BRL(v), cx + bw / 2, v >= 0 ? base - h - 3 : base + h + 8, { align: "center" });
    });
    doc.setTextColor(0);
    y = base + gh / 2 + 18;
    const sujos = dias.filter((x) => x.limpo === false);
    if (sujos.length) {
      doc.setFontSize(8).setTextColor(120);
      doc.text(`Pregões sujos (não contam): ${sujos.map((s) => `${dm(s.trade_date)} — ${s.motivo_sujo ?? "sem motivo"}`).join("; ")}`, M, y, {
        maxWidth: W - M * 2,
      });
      doc.setTextColor(0);
    }
  }

  doc.save(`${fileScope(d)}.pdf`);
}
