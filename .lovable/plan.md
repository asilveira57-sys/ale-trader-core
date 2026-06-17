# Fase 7 — Produção Automática Controlada

Evolução da Fase 6. O robô passa a executar ordens reais automaticamente, mas apenas após passar por um **supervisor independente**, gates de elegibilidade, gestão dinâmica de capital e múltiplos circuit breakers. Todas as travas da Fase 6 permanecem ativas.

## 1. Banco de dados (1 migration)

Novas tabelas (todas com `is_owner()` RLS + GRANTs):

- **automated_trades** — `id, request_id (fk real_trade_requests), session_id, asset_id, side, qty, entry_price, stop_loss, take_profit, risk_amount, automation_level (1|2|3), score, consensus, supervisor_decision, status (open|closed|blocked), exit_price, exit_reason, pnl, pnl_pct, opened_at, closed_at`.
- **automated_trade_audits** — `id, automated_trade_id, phase (entry|monitor|exit), summary, content, decision_chain (jsonb), created_at`.
- **supervisor_reviews** — `id, request_id, automated_trade_id, verdict (approved|blocked|warning), checks (jsonb com cada validação), anomalies (jsonb), data_quality_score, justification, created_at`.
- **robot_confidence** — `id, score (0-100), accuracy_component, performance_component, drawdown_component, agents_precision_component, data_quality_component, computed_at`.
- **capital_management_history** — `id, balance, suggested_size, volatility, recent_performance, current_drawdown, confidence, final_size, reason, created_at`.
- **dynamic_agent_weights** — `id, agent_id, previous_weight, new_weight, reason, performance_window, created_at`.
- **governance_settings** — singleton: `automation_enabled, automation_level (1|2|3), min_confidence_score, min_score_for_auto, min_consensus_for_auto, min_risk_reward, max_consecutive_losses, max_daily_losses, max_weekly_losses, max_drawdown_pct, supervisor_enabled, kill_switch_active, kill_switch_activated_at, kill_switch_reason, eligibility_min_days, eligibility_min_trades, eligibility_min_profit_factor`.
- **risk_incidents** — `id, kind (drawdown|loss_streak|comm_failure|data_anomaly|market_shock|openai_failure|binance_failure|kill_switch), severity, message, data (jsonb), resolved_at, created_at`.
- **daily_reports** — `id, report_date, total_trades, wins, losses, drawdown, net_pnl, alerts (jsonb), recommendations (text), content`.
- **weekly_reports** — `id, week_start, week_end, performance (jsonb), agent_ranking (jsonb), top_assets (jsonb), problem_assets (jsonb), suggested_adjustments (text), content`.

Estender `robot_settings` com `auto_production_eligibility_checked_at` (apenas leitura/cache).

## 2. Server-side

### `src/lib/supervisor.server.ts`
- `runSupervisor(request)` — valida decisão do conselho: coerência score×consenso, presença de stop/alvo, R:R mínimo, qualidade de dados (gap de candles, idade da cotação), detecção de anomalia (preço fora de range histórico, volatilidade extrema).
- Grava `supervisor_reviews`. Pode emitir verdict `blocked` que abortará a ordem mesmo com conselho aprovado.

### `src/lib/auto-trading.server.ts`
- `checkAutoEligibility()` — verifica os pré-requisitos: ≥60 dias assistido, ≥200 trades auditados, profit factor mínimo, drawdown abaixo do limite, circuit breaker validado, agente de risco ativo. Retorna `{eligible, failedChecks[]}`.
- `computePositionSize({balance, volatility, recentPerf, drawdown, confidence, level})` — Kelly-cap modulado pela confiança e drawdown, limitado ao % máximo do nível.
- `runAutoCycle(sessionId)` — orquestra: gera consenso (reusa Fase 5) → cria `real_trade_requests` → supervisor → se aprovado, calcula posição → executa via `binance-real` com flag `automated=true` → registra `automated_trades` + auditoria.
- `monitorAutoPositions()` — verifica stop/alvo, encerra automaticamente, registra `exit_reason`.
- `assertAutoCircuitBreaker()` — checa drawdown, sequência de perdas, falhas de comunicação, anomalias; abre `risk_incidents` e desativa `automation_enabled` quando necessário.
- `activateKillSwitch(reason)` / `deactivateKillSwitch()` — seta flag global, cancela ordens pendentes Binance (sem fechar posições), grava incidente crítico.

### `src/lib/confidence.server.ts`
- `computeConfidence()` — calcula índice 0–100 (média ponderada dos componentes), grava em `robot_confidence`. Usado como gate.

### `src/lib/reputation.server.ts` (extensão)
- `evolveAgentWeights(windowDays)` — recalcula pesos dos agentes a partir de hit-rate recente; grava `dynamic_agent_weights`. Nunca remove agentes, apenas ajusta peso entre `min_weight` e `max_weight`.

### `src/lib/reports.server.ts`
- `generateDailyReport(date)` e `generateWeeklyReport(weekStart)` — agregam dados, usam Gemini (`ai-gateway.server`) para gerar texto PT-BR, salvam em `daily_reports`/`weekly_reports`.

### `src/lib/auto-trading.functions.ts`
CRUD/queries: status do robô, settings de governança, ativar/desativar automação, ativar/desativar kill switch, listar incidentes, listar trades automáticos, recalcular confiança, recalcular pesos, gerar relatórios sob demanda, ver elegibilidade.

### Hardening em `binance-real.server.ts`
- Verificar `governance_settings.kill_switch_active` antes de qualquer POST/DELETE. Verificar `automation_enabled` quando a ordem vem com `automated=true`. Hard-block continua para futures/margin/withdraw.

## 3. Cron (pg_cron + `/api/public/hooks/*`)

Rotas em `src/routes/api/public/hooks/`:
- `auto-tick.ts` — POST: roda `runAutoCycle` para sessões automáticas ativas (cada minuto).
- `auto-monitor.ts` — POST: roda `monitorAutoPositions` + `assertAutoCircuitBreaker` (cada minuto).
- `daily-report.ts` — POST: gera relatório do dia anterior (diário 00:05).
- `weekly-report.ts` — POST: gera relatório semanal (segunda 00:10).
- `confidence-recompute.ts` — POST: recalcula confiança e pesos dos agentes (hora em hora).

Todas autenticadas via header `apikey` (anon key) — padrão da knowledge `schedule-jobs-options`. SQL `cron.schedule` será aplicado via `supabase--insert`.

## 4. UI (rotas `_authenticated/`)

- **`governance.tsx`** — Centro de Governança. Sliders/inputs para todos os limites; toggle "Automação habilitada"; selector de nível (1/2/3); botões "Recalcular elegibilidade", "Recalcular confiança". Mostra checklist de pré-requisitos com ✓/✗.
- **`kill-switch.tsx`** — Botão grande vermelho "DESLIGAR ROBÔ". Confirmação por frase ("DESLIGAR"). Histórico de ativações. Botão para reativar (requer owner).
- **`auto-dashboard.tsx`** — Painel do modo automático: confiança atual, nível ativo, trades automáticos abertos, P&L do dia, próximo tick, status do supervisor.
- **`incidents.tsx`** — Lista de `risk_incidents` filtrável por tipo/severidade.
- **`reports.tsx`** + **`reports.$reportId.tsx`** — Relatórios diários e semanais com layout impressão (print-to-PDF via `window.print()`).
- **`supervisor.tsx`** — Histórico de `supervisor_reviews`, mostrando o que foi aprovado/bloqueado e por quê.

Atualizar `_authenticated/route.tsx` (sidebar): nova seção **"Automação"** (vermelha) com links acima da seção "Operação Real".

## 5. Segurança

- Toda função sensível: `requireSupabaseAuth` + `has_role(_, 'owner')`.
- `automation_enabled = true` exige `checkAutoEligibility().eligible === true`. Fail-closed.
- Kill switch tem precedência sobre tudo: enquanto ativo, `runAutoCycle` retorna imediatamente.
- Dupla validação obrigatória: conselho + supervisor. Se supervisor faltar (`supervisor_enabled=false`), automação é bloqueada.
- Nenhum endpoint expõe service role; `client.server` permanece carregado por `await import()` dentro de handlers.

## 6. Fora de escopo

- Trading de futuros/margem/saques (continuam hard-blocked).
- Notificações push/Telegram (relatórios ficam só na UI).
- Backtesting do supervisor (assumido baseado nas métricas históricas das fases anteriores).
- Tuning ML dos pesos (heurística simples por hit-rate).

## 7. Detalhes técnicos

- Stack: TanStack Start, `createServerFn` + `requireSupabaseAuth`, Lovable AI Gateway para textos dos relatórios.
- Modelo de IA: `google/gemini-3-flash-preview` (default) para relatórios; nada de chamadas a OpenAI no caminho crítico.
- Reuso máximo de `committee.server.ts`, `real-trading.server.ts`, `audit.server.ts`, `live.server.ts`, `binance-real.server.ts`.
- 1 migration consolidada criando todas as tabelas + GRANTs + RLS + 1 trigger `touch_updated_at` onde aplicável.
- Tipos Supabase serão regenerados após aprovação da migration.

## Perguntas

1. Manter os defaults de elegibilidade (60 dias, 200 trades, PF mín 1.3, DD máx 15%) ou outros valores?
2. Cron rodando a cada 1 min para auto-tick está bom, ou prefere 30s/5min?
3. Kill switch deve também **fechar posições abertas** em modo "pânico total", ou manter apenas "não abre mais" como descrito?
