# Auditoria & Reconciliação da Carteira Binance

## Objetivo
Descobrir por que a exposição caiu de 30–40% para ~15% e eliminar divergência entre saldo, capital alocado, equity e PnL — **sem tocar em nada de B3 / Mini Índice / Day Trade**.

## Escopo isolado (namespace `binance.*` / `crypto.*`)
Vou trabalhar APENAS em:
- `simulated_wallet`, `simulated_orders`, `simulated_positions` (lado cripto)
- `robot_settings`, `committee_settings` (apenas leitura para auditoria)
- Novos arquivos sob `src/lib/binance-wallet-audit.*` e nova rota `/_authenticated/binance-wallet-health`

**Não toco em:** `b3_*`, `b3-committee.server.ts`, `b3-simulation.*`, `b3.functions.ts`, qualquer rota `b3*`.

---

## Fase 1 — Auditoria de parâmetros de exposição
Função `auditBinanceExposureParams()` em `src/lib/binance-wallet-audit.functions.ts`:
- Lê `robot_settings` + `committee_settings` + `monitored_assets`
- Retorna lista `{ parameter, current_value, impact_on_exposure, module_source }`
- Inclui: `max_position_value`, `default_stop_pct`, `default_target_pct`, `min_favor_votes`, `min_confidence`, `min_score`, `binance_mock_mode`, `status`, `mode`, número de ativos ativos
- Calcula também o cap real usado em `executeSimulated`: `min(max_position_value, current_balance * 0.10)` — esse `* 0.10` hard-coded é o forte suspeito do "15%"

## Fase 2 — Auditoria de decisões (últimas 72h)
Nova tabela `binance_position_decision_audit`:
- `id, symbol, decision_type, requested_capital, approved_capital, committee_score, council_score, risk_score, reason, created_at`
- Backfill inicial a partir de `committee_decisions` + `simulated_orders` das últimas 72h
- Função `auditBinanceDecisions72h()` que cruza decisões aprovadas vs ordens executadas e identifica "dinheiro parado" (decisão buy_approved sem ordem)

## Fase 3 — Reconciliação financeira
Função `recalculateBinancePortfolioState()` (pura, sem cache):
- `saldo_calculado = saldo_inicial + Σ(vendas) − Σ(compras) − Σ(taxas)`
- `valor_mercado_posicoes = Σ(qty_aberta × preço_atual_mock)`
- `equity_calculado = saldo_calculado + valor_mercado_posicoes`
- Retorna comparação com `simulated_wallet.current_balance` / `equity`

## Fase 4 — Identificação de divergências
Nova tabela `binance_wallet_reconciliation_audit`:
- `id, divergence_type, affected_symbol, amount, root_cause, detected_at`
- Detectores: ordem duplicada (mesmo decision_id), venda sem compra prévia, compra `open` há >X horas sem fechamento, posição órfã (qty>0 sem buy open), soma de fills ≠ saldo

## Fase 5 — Rebuild
Função `rebuildBinanceWalletFromTrades()`:
- **Preserva** `simulated_orders` (histórico bruto)
- **Recalcula** `simulated_positions` e `simulated_wallet` a partir do zero, replayando ordens em ordem cronológica
- Requer confirmação explícita (botão "Reconstruir carteira") — nunca roda automaticamente

## Fase 6 — Validação matemática
Dentro de `recalculate...`, asserção:
```
|saldo_inicial + pnl_realizado + pnl_nao_realizado − taxas − equity_atual| ≤ 0.01
```
Se falhar → grava `system_logs` com severity=`critical` e popula `binance_wallet_reconciliation_audit`.

## Fase 7 — Painel "Saúde da Carteira Binance"
Nova rota `/_authenticated/binance-wallet-health`:
- Cards: saldo, capital alocado, PnL realizado, PnL não realizado, patrimônio, divergência
- Status 🟢🟡🔴
- Tabela de divergências detectadas
- Tabela de decisões 72h (Fase 2)
- Botões: "Rodar auditoria", "Reconstruir carteira" (com confirmação)

---

## Migração SQL necessária
1. `CREATE TABLE binance_position_decision_audit` + GRANTs + RLS (owner-only via `is_owner()`)
2. `CREATE TABLE binance_wallet_reconciliation_audit` + GRANTs + RLS (owner-only)

## Arquivos novos
- `src/lib/binance-wallet-audit.functions.ts` — server fns (auditoria, reconciliação, rebuild)
- `src/lib/binance-wallet-audit.server.ts` — helpers puros
- `src/routes/_authenticated/binance-wallet-health.tsx` — painel

## Arquivos NÃO tocados
Nenhum arquivo `b3*`, nenhum `pipeline-runner.server.ts`, nenhum `atrader.functions.ts`, nenhum `committee.server.ts` compartilhado. A análise é puramente leitura sobre tabelas existentes do lado cripto; o rebuild só roda quando o usuário clicar no botão.

## Hipótese inicial (a confirmar na Fase 1)
O cap por trade em `pipeline-runner.server.ts:executeSimulated` é:
```ts
Math.min(max_position_value, current_balance * 0.10)
```
Com 1 a 2 ativos elegíveis por ciclo, isso trava a exposição em ~10–20% — bate com os 15% observados. A auditoria vai confirmar e o painel vai expor isso para você decidir se quer subir o multiplicador (mudança futura, fora desta entrega).

## Entrega
Pode aprovar que eu sigo direto — migração primeiro, depois código + rota.
