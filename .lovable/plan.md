# Liberar entradas: Anti-Euforia sem veto + setup por threshold

Três edições literais, exatamente como especificado. Nada além disso muda.

## 1. Anti-Euforia deixa de vetar (`src/lib/b3-committee.server.ts`)

No `return` final de `aAntiTendencia` (linhas 231-240), trocar `has_veto: block` por `has_veto: false` e `veto_reason: undefined`, mantendo `vote: block ? "reject" : "neutral"`, `confidence: block ? 85 : 50` e `data: { rsi, high, low, rule: "rsi_only" }`.

Efeito: RSI extremo passa a contar como voto contrário normal, sem cravar o score em 25 pelo cap de veto.

## 2. `classifySetup` passa de "9/9 obrigatórias" para bloqueio duro + placar macio

Em `src/lib/b3-simulation.functions.ts`, substituir todo o corpo a partir do comentário `// Lateral bloqueia setup direcional.` (linha 768) até o `return { name, ok: false, reasons: failures, details };` final da função (linha 810) pelo código enviado:

- Bloqueio duro: mercado lateral (direção lateral, força < 30 ou volatilidade < 0,3) e tendência contrária ao lado avaliado.
- 8 condições macias (força >= 40, VWAP, EMA9/EMA21, pullback, estrutura, candle de confirmação, distância de topo/fundo, R:R >= 1,5) somam para um placar.
- Threshold `cfg.setup_min_soft_hits` (padrão 6 de 8) decide `trend_pullback` válido.
- Setups alternativos (`breakout_retest`, `consolidation_breakout`, `support_resistance_rejection`) recebem `ok` próprio conforme as regras enviadas.
- `details` passa a incluir `soft_hits` e `soft_total`.

## 3. Setups alternativos passam a ser operáveis

Linha 1420, trocar:

```text
const setupAllowed = setupInfo.name === "trend_pullback" && setupInfo.ok;
```

por:

```text
const setupAllowed = setupInfo.name !== "no_valid_setup" && setupInfo.ok;
```

## Fora de escopo

Nenhuma alteração em ponte MT5, ingestão de ticks, thresholds de score/confiança/votos, stops, gains, contratos, horários ou UI. Os arquivos enviados servem apenas de referência; as edições são aplicadas nos arquivos do projeto.
