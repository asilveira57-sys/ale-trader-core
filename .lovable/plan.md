
# Painel Interativo da Simulação B3 — Gráficos ao Vivo

Sim, dá pra montar. Vou adicionar um painel novo na página da simulação 3 Modos com gráficos interativos (Recharts, já usado no app) que mostram em tempo real o que está sendo ofertado, comprado e vendido pelos 3 modos (Conservador, Moderado, Agressivo).

## O que você vai ver

1. **Preço do WIN ao vivo** — linha do tempo do mini índice (último preço de cada tick) com marcadores de aberturas (▲ verde para BUY/Long, ▼ vermelho para SELL/Short) e fechamentos (○) dos 3 modos sobrepostos no mesmo gráfico. Hover mostra hora, preço, modo e PnL.

2. **Evolução do patrimônio (3 linhas)** — uma linha por modo (Conservador / Moderado / Agressivo) partindo de R$ 10.000, atualizada a cada ordem fechada. Permite comparar visualmente quem está performando melhor.

3. **PnL acumulado por modo (barras)** — barras com PnL líquido, bruto e taxas pagas, lado a lado para os 3 modos.

4. **Distribuição de operações (donut + barras)**:
   - Donut: % de BUY vs SELL por modo
   - Barras empilhadas: ganhos × perdas × stop loss × take profit × fechamento manual

5. **Heatmap de atividade** — quantas ordens foram abertas por hora do pregão (9h–18h), separadas por modo. Mostra em que momento do dia cada modo é mais ativo.

6. **Painel "ao vivo agora"** — cards no topo com:
   - Posições abertas em cada modo (com PnL parcial pulsante)
   - Último voto do comitê (qual agente votou o quê) com mini-barra de confiança
   - Próximo tick estimado (contador regressivo até o próximo minuto do cron)

## Onde fica

- Nova aba dentro da página `/b3` chamada **"Painel Ao Vivo"**, ao lado das abas já existentes (Comparativo, Histórico).
- Auto-refresh a cada 15s via TanStack Query (mesmo padrão das outras telas).
- Botão "Pausar atualização" para inspecionar um momento específico.
- Filtros: período (últimas 1h / 4h / hoje / desde o início da simulação) e modos visíveis (toggle por linha).

## Detalhes técnicos (para referência)

- **Novo server fn** `getB3SimLiveDashboard` em `src/lib/b3-sim-history.functions.ts` que retorna:
  - Snapshots de mercado (`b3_simulation_market_snapshots`) das últimas N horas
  - Ordens (`b3_simulation_orders`) com `created_at`, `updated_at`, `status`, `side`, `entry_price`, `exit_price`, `pnl_net`, `mode_id`
  - Estado atual dos 3 modos (`b3_simulation_modes`: equity, posição aberta)
  - Últimos 20 votos (`b3_simulation_agent_votes`) com agente, voto, confiança
- **Novo componente** `src/components/b3/SimLiveDashboard.tsx` com Recharts (LineChart, BarChart, PieChart) + cards de estado.
- **Integração** na página `src/routes/_authenticated/b3.tsx` (ou no `SimComparePanel.tsx` se preferir tudo numa aba só) usando o `Tabs` do shadcn.
- Nenhuma alteração no engine de simulação, no cron ou no histórico — somente leitura.

## Fora do escopo

- Não muda regras de operação, taxas, agentes ou cron.
- Não cria ordens — é só visualização.
- Não toca em Binance, Day Trade ou painéis reais.

Quer que eu já implemente assim, ou prefere ajustar algum gráfico antes (ex.: trocar heatmap por candlestick, adicionar profundidade de book — que não temos hoje, exigiria coleta nova)?
