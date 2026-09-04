// Aviso sonoro + notificação quando ABRE ou FECHA posição REAL.
//
// FONTE: b3_mt5_account_state.posicoes (o que o executor leu do MT5), que chega
// na tela dentro do payload do cockpit real. NÃO usamos o momento em que o app
// manda espelhar: mandar espelhar não é a ordem ter sido executada na corretora.
// Consequência aceita: o aviso pode chegar até ~20 s depois do fato.
//
// ESCOPO: só com o app em primeiro plano. Sem service worker, sem Web Push,
// sem nada com o app fechado.
//
// Nada aqui decide entrada, saída, tamanho ou freio — é só aviso.
import { useCallback, useEffect, useRef, useState } from "react";

export interface AlertPosition {
  root?: string | null;
  symbol?: string | null;
  side?: "buy" | "sell" | null;
  quantity?: number | null;
  magic_number?: number | null;
  ticket?: string | null;
}

type Evento = { tipo: "abriu" | "fechou"; titulo: string; corpo: string };

const chave = (p: AlertPosition) =>
  p.ticket
    ? `t:${p.ticket}`
    : `k:${p.symbol ?? p.root ?? "?"}:${p.side ?? "?"}:${p.magic_number ?? "?"}`;

const ladoTexto = (s: string | null | undefined) => (s === "buy" ? "compra" : s === "sell" ? "venda" : "");

/** "WIN venda 3x, WDO compra 1x" — agrupado por ativo+lado. */
function resumo(lista: AlertPosition[]) {
  const acc = new Map<string, number>();
  for (const p of lista) {
    const k = `${p.root ?? p.symbol ?? "?"} ${ladoTexto(p.side)}`.trim();
    acc.set(k, (acc.get(k) ?? 0) + Math.max(1, Number(p.quantity ?? 1)));
  }
  return Array.from(acc.entries()).map(([k, q]) => `${k} ${q}x`).join(", ");
}

export function useRealPositionAlerts(
  positions: AlertPosition[] | undefined,
  reportedAt: string | null | undefined,
) {
  const [armado, setArmado] = useState(false);
  const [ligado, setLigado] = useState(true);
  const conhecidas = useRef<Map<string, AlertPosition> | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const ultimoRelatorio = useRef<string | null>(null);

  // (b) DESTRAVAR O ÁUDIO NO PRIMEIRO TOQUE.
  // Navegador de celular só libera som depois de um gesto do usuário. Criamos e
  // "esquentamos" o contexto de áudio no primeiro toque em qualquer lugar da
  // página e reaproveitamos esse mesmo contexto nos avisos seguintes — sem
  // isso, funciona no desktop e falha no celular, que é onde faz falta.
  useEffect(() => {
    const destravar = () => {
      try {
        const Ctor = (window.AudioContext ?? (window as any).webkitAudioContext) as typeof AudioContext | undefined;
        if (!Ctor) return;
        const ctx = audioCtx.current ?? new Ctor();
        audioCtx.current = ctx;
        void ctx.resume();
        // toque mudo: valida o desbloqueio sem incomodar
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.value = 0;
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.01);
        setArmado(true);
      } catch { /* sem áudio a tela continua funcionando */ }
      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        void Notification.requestPermission().catch(() => undefined);
      }
    };
    window.addEventListener("pointerdown", destravar, { once: true });
    window.addEventListener("keydown", destravar, { once: true });
    return () => {
      window.removeEventListener("pointerdown", destravar);
      window.removeEventListener("keydown", destravar);
    };
  }, []);

  const bipe = useCallback((tipo: "abriu" | "fechou") => {
    const ctx = audioCtx.current;
    if (!ctx) return;
    try {
      void ctx.resume();
      const t0 = ctx.currentTime;
      // abertura: dois bipes subindo. fechamento: um bipe grave.
      const notas = tipo === "abriu" ? [880, 1320] : [440];
      notas.forEach((f, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "square";
        osc.frequency.value = f;
        const ini = t0 + i * 0.22;
        gain.gain.setValueAtTime(0.0001, ini);
        gain.gain.exponentialRampToValueAtTime(0.28, ini + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ini + 0.18);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ini);
        osc.stop(ini + 0.2);
      });
    } catch { /* aviso sonoro nunca derruba a tela */ }
  }, []);

  const avisar = useCallback((ev: Evento) => {
    bipe(ev.tipo);
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification(ev.titulo, { body: ev.corpo, tag: `real-${ev.tipo}-${Date.now()}` });
      }
    } catch { /* notificação é opcional */ }
    if (navigator.vibrate) { try { navigator.vibrate(ev.tipo === "abriu" ? [120, 80, 120] : 200); } catch { /* ok */ } }
  }, [bipe]);

  useEffect(() => {
    if (!positions) return;
    const atual = new Map<string, AlertPosition>();
    for (const p of positions) atual.set(chave(p), p);

    // Primeira leitura só fotografa o estado: posição que já estava aberta
    // quando a tela abriu não gera aviso.
    if (conhecidas.current === null) {
      conhecidas.current = atual;
      ultimoRelatorio.current = reportedAt ?? null;
      return;
    }
    // (c) UM AVISO POR RELATÓRIO DO EXECUTOR. Os 6 robôs reais abrem no mesmo
    // minuto; agrupamos tudo o que apareceu (ou saiu) na mesma foto.
    if (reportedAt && reportedAt === ultimoRelatorio.current) return;
    ultimoRelatorio.current = reportedAt ?? null;

    const antes = conhecidas.current;
    const abriram = Array.from(atual.entries()).filter(([k]) => !antes.has(k)).map(([, p]) => p);
    const fecharam = Array.from(antes.entries()).filter(([k]) => !atual.has(k)).map(([, p]) => p);
    conhecidas.current = atual;

    if (!ligado) return;
    if (abriram.length) {
      const n = abriram.length;
      avisar({
        tipo: "abriu",
        titulo: `${n} ordem${n > 1 ? "ns" : ""} REAL${n > 1 ? "IS" : ""} aberta${n > 1 ? "s" : ""}`,
        corpo: resumo(abriram),
      });
    }
    if (fecharam.length) {
      const n = fecharam.length;
      avisar({
        tipo: "fechou",
        titulo: `${n} posição${n > 1 ? "ões" : ""} REAL${n > 1 ? "IS" : ""} encerrada${n > 1 ? "s" : ""}`,
        corpo: `${resumo(fecharam)}${atual.size === 0 ? " — sem exposição real aberta" : ""}`,
      });
    }
  }, [positions, reportedAt, ligado, avisar]);

  return { armado, ligado, setLigado };
}
