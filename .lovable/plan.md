## Diagnóstico — por que parece "vendeu sem comprar"

Você está olhando o **mini-índice (WIN)**, que é um **contrato futuro**. Em futuros não existe "comprar para depois vender": cada operação é **uma posição inteira**, aberta e fechada na mesma linha da tabela.

Na linha do **Moderado** (líquido R$ 335):

- `Lado = SELL` → abriu uma posição **vendida** (short) em 130.400 às 10:10:02
- `Saída = 128.710` → fechou (recomprou) mais barato em 128.710
- `Pts = 1.690` × R$ 0,20/pt = R$ 338 bruto − R$ 3 de taxa = **R$ 335 líquido** ✓

Ou seja: na coluna `Entrada` está o preço de **abertura** e em `Saída` o preço de **fechamento**. Não há uma "compra" separada porque em futuros short=vender primeiro, fechar=comprar de volta — tudo na mesma ordem. A matemática confere com o saldo (10.000 → 10.335).

A linha aberta em 10:15 (Agressivo `status open`) já fechou depois com stop −R$ 136 (vi no banco), portanto a tabela "últimas 60" do painel ficou desatualizada na sua tela.

## O que vou implementar

Mudanças **só no front e em uma server fn nova de export** — não toco no robô, na lógica de simulação, na Binance, nem na B3 real.

### 1. Esclarecer a tabela "Últimas operações simuladas" (`SimComparePanel.tsx`)
- Renomear `Lado` → **Direção** com tooltip: "BUY = comprado (long) / SELL = vendido (short). Cada linha é uma operação completa: abertura + fechamento."
- Renomear `Entrada` → **Abertura** e `Saída` → **Fechamento** (com hora de abertura e hora de fechamento em tooltip).
- Adicionar coluna **Duração** (closed_at − created_at) e badge de **modo** já existente.
- Aumentar o limite visível de 60 → 200 e adicionar filtros simples (modo, status, lado, intervalo de datas).

### 2. Nova página `/_authenticated/b3-sim-history` — Histórico completo
- Lista paginada (50/pág) de **todas** as `b3_simulation_orders` do run selecionado (ou de todos os runs).
- Filtros: run, modo, status (open/closed), lado (buy/sell), close_reason, data inicial/final.
- Totais no rodapé: nº de trades, ganhos, perdas, taxa de acerto, PnL bruto, taxas, PnL líquido, drawdown.
- Botão "Voltar para Simulação 3 Modos".
- Link novo na aba Simulação: **"Ver histórico completo"**.

### 3. Exportar relatórios (PDF + XLSX)
Server fns novas em `src/lib/b3-sim-export.functions.ts`:
- `exportB3SimHistoryXlsx({ run_id, filters })` → planilha com 4 abas:
  1. **Resumo** — comparativo dos 3 modos (saldo, PnL, trades, acerto, DD, score)
  2. **Operações** — todas as ordens com Abertura, Fechamento, Pontos, Bruto, Taxas, Líquido, Motivo
  3. **Votos do comitê** — `b3_simulation_agent_votes` por operação
  4. **Evolução patrimonial** — saldo por modo ao longo do tempo (a partir das operações)
- `exportB3SimHistoryPdf({ run_id, filters })` → PDF com as mesmas seções + ranking final e modo sugerido.

Botões "Exportar XLSX" e "Exportar PDF" no topo da página de histórico e no painel principal.

### Técnico

- Coluna `closed_at` não existe hoje em `b3_simulation_orders` — vou usar `updated_at` quando `status='closed'` para calcular duração e ordenar fechamentos. **Sem migration nova.**
- Geração PDF via `pdf-lib` (puro JS, Worker-safe); XLSX via `exceljs` (idem). Se algum já estiver instalado, reuso.
- Tudo dentro do existente: nada na Binance, nada na B3 Day Trade real, sem mexer na lógica do comitê nem nos parâmetros.

### Arquivos

- editar `src/components/b3/SimComparePanel.tsx` (renomear colunas, tooltip, filtros básicos, link "Ver histórico", botões de export)
- criar `src/routes/_authenticated/b3-sim-history.tsx`
- criar `src/lib/b3-sim-export.functions.ts`
- adicionar libs `pdf-lib` e `exceljs` se necessário