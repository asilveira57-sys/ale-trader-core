// AVISO ATIVO DO REAL — som + notificação do navegador (17/09/2026).
//
// Motivo: até aqui o operador só descobria que algo aconteceu no real se
// estivesse olhando a tela. Agora a tela AVISA.
//
// FONTE: só o payload LEVE do Cockpit Real (estado do executor, corretora,
// disjuntor, freio de grupo, liberações) e as posições que o executor leu do
// MT5. Nada aqui decide entrada, saída, tamanho ou freio — é só aviso.
//
// REGRAS DURAS:
//  · nada toca fora do horário de pregão (o evento é marcado como visto, para
//    não estourar um backlog quando o pregão abrir);
//  · nada toca sem o operador ter liberado o áudio num clique explícito
//    (política do navegador: aba de fundo sem gesto anterior não toca);
//  · o mesmo evento não toca duas vezes, nem se a tela recarregar
//    (identificador estável por evento, guardado em localStorage);
//  · mudo persiste em localStorage.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface AlertPosition {
  root?: string | null;
  symbol?: string | null;
  side?: "buy" | "sell" | null;
  quantity?: number | null;
  magic_number?: number | null;
  ticket?: string | null;
}

export interface RealAlertSignal {
  kind: string;
  severity?: string | null;
  title: string;
  detail?: string | null;
  at?: string | null;
}

export interface GrupoNivelSignal { key: string; label: string; nivel: number }
export interface LiberacaoFimSignal { key: string; label: string; motivo: string }

export interface UseRealAlertsInput {
  pregaoOpen: boolean;
  alerts: RealAlertSignal[];
  brokerPositions: AlertPosition[] | undefined;
  reportedAt: string | null | undefined;
  grupoNiveis?: GrupoNivelSignal[];
  liberacoesEncerradas?: LiberacaoFimSignal[];
}

type Prio = "critico" | "atencao";
interface Evento { id: string; prio: Prio; titulo: string; corpo: string }

// CRÍTICO: som insistente e notificação que não some sozinha.
const CRITICOS = new Set([
  "real_parado",                    // real desligado com o pregão aberto
  "relatorio_executor_velho",       // executor parado durante o pregão
  "disjuntor_diario_armado",        // disjuntor diário da conta real disparou
  "stop_pendente_nao_executado",    // stop enfileirado que o executor não executou
  "ordem_real_recusada",            // ordem real rejeitada pela corretora
  "cotacao_parada",                 // ativo sem preço durante o pregão (system_logs)
  "autorizacao_real_orfa",          // robô autorizado sem execução viva (system_logs)
  "carteira_insuficiente",          // capital da carteira não cobre a margem (system_logs)
  "dedupe_run_cancelada",           // dedupe cancelou execução ou travou duplicata real (system_logs)
  "ordem_real_sem_resultado",       // ordem real fechada sem resultado há >10 min no pregão
]);

const MUDO_KEY = "b3.real.alertas.mudo";
const VISTOS_KEY = "b3.real.alertas.vistos";
const GRUPO_KEY = "b3.real.alertas.grupo-nivel";
const MAX_VISTOS = 400;

const lsGet = (k: string): string | null => {
  try { return window.localStorage.getItem(k); } catch { return null; }
};
const lsSet = (k: string, v: string) => {
  try { window.localStorage.setItem(k, v); } catch { /* sem storage a tela segue */ }
};

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

export function useRealAlerts(input: UseRealAlertsInput) {
  const { pregaoOpen, alerts, brokerPositions, reportedAt } = input;
  const grupoNiveis = useMemo(() => input.grupoNiveis ?? [], [input.grupoNiveis]);
  const liberacoesEncerradas = useMemo(
    () => input.liberacoesEncerradas ?? [], [input.liberacoesEncerradas],
  );

  const [armado, setArmado] = useState(false);
  const [ligado, setLigado] = useState(true);
  const audioCtx = useRef<AudioContext | null>(null);
  const vistos = useRef<Set<string> | null>(null);
  const conhecidas = useRef<Map<string, AlertPosition> | null>(null);
  const ultimoRelatorio = useRef<string | null>(null);
  // Primeira passada: só criticos podem tocar. Aviso de atenção acumulado antes
  // de a tela abrir não interessa — o que interessa é o que muda daqui pra frente.
  const primeira = useRef(true);

  // ── mudo e vistos, persistidos ──
  useEffect(() => {
    setLigado(lsGet(MUDO_KEY) !== "1");
    try {
      const raw = lsGet(VISTOS_KEY);
      vistos.current = new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
    } catch { vistos.current = new Set(); }
  }, []);

  const setMudo = useCallback((v: boolean) => {
    setLigado(v);
    lsSet(MUDO_KEY, v ? "0" : "1");
  }, []);

  const marcarVisto = useCallback((ids: string[]) => {
    const set = vistos.current ?? new Set<string>();
    for (const id of ids) set.add(id);
    // Corta o mais antigo: a lista é um anel, não um histórico.
    const arr = Array.from(set).slice(-MAX_VISTOS);
    vistos.current = new Set(arr);
    lsSet(VISTOS_KEY, JSON.stringify(arr));
  }, []);

  // ── LIBERAR O ÁUDIO NUM CLIQUE EXPLÍCITO ──
  // O navegador só libera som depois de um gesto do usuário; no celular, sem
  // isso, o aviso simplesmente não sai. Este é o botão "liberar som".
  const armar = useCallback(() => {
    try {
      const Ctor = (window.AudioContext ?? (window as any).webkitAudioContext) as typeof AudioContext | undefined;
      if (Ctor) {
        const ctx = audioCtx.current ?? new Ctor();
        audioCtx.current = ctx;
        void ctx.resume();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.value = 0.0001; // toque mudo: valida o desbloqueio sem incomodar
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.01);
        setArmado(true);
      }
    } catch { /* sem áudio a tela continua funcionando */ }
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        void Notification.requestPermission().catch(() => undefined);
      }
    } catch { /* notificação é opcional */ }
  }, []);

  const bipe = useCallback((prio: Prio) => {
    const ctx = audioCtx.current;
    if (!ctx) return;
    try {
      void ctx.resume();
      const t0 = ctx.currentTime;
      // crítico: sirene insistente (8 toques alternados). atenção: um toque curto.
      const notas = prio === "critico"
        ? [1320, 990, 1320, 990, 1320, 990, 1320, 990]
        : [880];
      const passo = prio === "critico" ? 0.34 : 0.2;
      notas.forEach((f, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "square";
        osc.frequency.value = f;
        const ini = t0 + i * passo;
        gain.gain.setValueAtTime(0.0001, ini);
        gain.gain.exponentialRampToValueAtTime(prio === "critico" ? 0.35 : 0.22, ini + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ini + passo * 0.8);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ini);
        osc.stop(ini + passo);
      });
    } catch { /* aviso sonoro nunca derruba a tela */ }
  }, []);

  const avisar = useCallback((ev: Evento) => {
    bipe(ev.prio);
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification(ev.titulo, {
          body: ev.corpo,
          tag: ev.id,
          // Crítico não some sozinho: quem estava longe da tela precisa achar o aviso.
          requireInteraction: ev.prio === "critico",
        } as NotificationOptions);
      }
    } catch { /* notificação é opcional */ }
    if (navigator.vibrate) {
      try { navigator.vibrate(ev.prio === "critico" ? [200, 100, 200, 100, 200] : 140); } catch { /* ok */ }
    }
  }, [bipe]);

  useEffect(() => {
    if (vistos.current === null) return; // storage ainda não lido
    const eventos: Evento[] = [];

    // 1) avisos do payload leve — só os que o operador pediu
    for (const a of alerts ?? []) {
      if (!CRITICOS.has(a.kind)) continue;
      // O payload pesado também usa "cotacao_parada" (idade da cotação); só o
      // alarme "ATIVO SEM PRECO" do payload leve toca.
      if (a.kind === "cotacao_parada" && a.title !== "Ativo sem preço durante o pregão") continue;
      eventos.push({
        id: `a:${a.kind}:${a.at ?? a.title}`,
        prio: "critico",
        titulo: a.title,
        corpo: a.detail ?? "",
      });
    }

    // 2) freio de grupo SUBIU de nível (descer não é aviso)
    let grupoAnterior: Record<string, number> = {};
    try { grupoAnterior = JSON.parse(lsGet(GRUPO_KEY) ?? "{}") as Record<string, number>; } catch { /* vazio */ }
    const grupoAtual: Record<string, number> = { ...grupoAnterior };
    for (const g of grupoNiveis) {
      const antes = Number(grupoAnterior[g.key] ?? 0);
      grupoAtual[g.key] = g.nivel;
      if (g.nivel > antes) {
        eventos.push({
          id: `g:${g.key}:${g.nivel}`,
          prio: "atencao",
          titulo: `Freio de grupo subiu para nível ${g.nivel}`,
          corpo: `${g.label} — o real deixa de abrir nos robôs travados deste grupo. O simulado segue igual.`,
        });
      }
    }
    lsSet(GRUPO_KEY, JSON.stringify(grupoAtual));

    // 3) liberação manual encerrada por fim de pregão
    for (const l of liberacoesEncerradas) {
      eventos.push({
        id: `x:${l.key}:${l.motivo}`,
        prio: "atencao",
        titulo: "Liberação manual de freio expirou",
        corpo: `${l.label} — motivo: ${l.motivo}. O freio volta a bloquear o real.`,
      });
    }

    // 4) posição real aberta / fechada — um aviso por relatório do executor
    if (brokerPositions) {
      const atual = new Map<string, AlertPosition>();
      for (const p of brokerPositions) atual.set(chave(p), p);
      if (conhecidas.current === null) {
        conhecidas.current = atual;
        ultimoRelatorio.current = reportedAt ?? null;
      } else if (!reportedAt || reportedAt !== ultimoRelatorio.current) {
        ultimoRelatorio.current = reportedAt ?? null;
        const antes = conhecidas.current;
        const abriram = Array.from(atual.entries()).filter(([k]) => !antes.has(k)).map(([, p]) => p);
        const fecharam = Array.from(antes.entries()).filter(([k]) => !atual.has(k)).map(([, p]) => p);
        conhecidas.current = atual;
        if (abriram.length) {
          const n = abriram.length;
          eventos.push({
            id: `p:abriu:${reportedAt ?? Date.now()}`,
            prio: "atencao",
            titulo: `${n} posição${n > 1 ? "ões" : ""} REAL${n > 1 ? "IS" : ""} aberta${n > 1 ? "s" : ""}`,
            corpo: resumo(abriram),
          });
        }
        if (fecharam.length) {
          const n = fecharam.length;
          eventos.push({
            id: `p:fechou:${reportedAt ?? Date.now()}`,
            prio: "atencao",
            titulo: `${n} posição${n > 1 ? "ões" : ""} REAL${n > 1 ? "IS" : ""} encerrada${n > 1 ? "s" : ""}`,
            corpo: `${resumo(fecharam)}${atual.size === 0 ? " — sem exposição real aberta" : ""}`,
          });
        }
      }
    }

    const novos = eventos.filter((e) => !vistos.current!.has(e.id));
    const eraPrimeira = primeira.current;
    primeira.current = false;
    if (!novos.length) return;
    marcarVisto(novos.map((e) => e.id));

    // Fora do pregão nada toca: o evento fica marcado como visto e pronto.
    if (!pregaoOpen || !ligado) return;
    for (const ev of novos) {
      if (eraPrimeira && ev.prio !== "critico") continue;
      avisar(ev);
    }
  }, [alerts, grupoNiveis, liberacoesEncerradas, brokerPositions, reportedAt, pregaoOpen, ligado, avisar, marcarVisto]);

  return { armado, ligado, setLigado: setMudo, armar };
}
