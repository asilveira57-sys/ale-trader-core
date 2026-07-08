
# Simulação Local MT5 XP — WINQ26 (módulo B3)

Modo novo, isolado, que roda todos os robôs B3 sobre o WINQ26 usando **cotação real do MetaTrader 5 (XPMT5-PRD)** mas **sem enviar nenhuma ordem real**. Serve para comparar entradas, saídas, travas, PnL teórico, drawdown e conflitos entre robôs antes de qualquer execução real.

## Escopo e isolamento

- Tudo novo com prefixo `b3_mt5sim_*` (tabelas, rotas, arquivos, componentes).
- **Não altero**: qualquer módulo Binance, `pipeline-runner`, `committee`, `binance-*`, `b3-protection`, `b3-simulation-*` já existentes, `atrader.functions.ts`, `b3.functions.ts`.
- O B3 clássico e a Flexibilização de Bloqueios continuam funcionando como estão.

## Banco de dados (uma migration)

Todas as tabelas em `public`, com GRANT, RLS por `user_id` (`auth.uid()`), `service_role` full, `updated_at` trigger onde aplicável.

- `b3_mt5sim_settings` — 1 linha por user: `market` (WIN), `mt5_symbol` (WINQ26), `server` (XPMT5-PRD), `tick_size` (5), `tick_value` (1.00), `point_value` (0.20), `default_volume` (1), `price_source` (`last`|`bid_ask`|`bid_ask_slip`), `slippage_ticks`, `fee_per_contract_brl`, `use_spread`, `poll_interval_ms`, `session_start`, `session_end`, `kill_switch_real` (default true), `allow_long`, `allow_short`, `allow_reverse`, promotion criteria (`min_trades_per_robot`, `min_days`, `max_price_divergence_pts`, `max_drawdown_brl`, `min_hit_rate`, `min_net_pnl`).
- `b3_mt5sim_robots` — 1 linha por robô participante (`profile` enum: conservador|moderado|equilibrado|semi_agressivo|agressivo), com travas independentes: `daily_loss_limit_brl`, `daily_gain_limit_brl`, `max_trades_day`, `max_drawdown_brl`, `max_consec_losses`, `min_score`, `signal_ttl_s`, `max_spread_ticks`, `volatility_block_atr`, `enabled`, `initial_balance_brl`.
- `b3_mt5sim_wallet_daily` — carteira simulada por robô/dia: saldo inicial, PnL bruto, PnL líquido, taxas, trades, wins/losses, hit_rate, best/worst, drawdown, points_net, current_position_side/qty/avg, status.
- `b3_mt5sim_quotes` — ticks capturados (bid, ask, last, spread, ts, volume, symbol_status, mt5_connected, server, account_masked).
- `b3_mt5sim_signals` — sinais gerados por robô (side, price_signal, score, motivo, ts, expires_at, status).
- `b3_mt5sim_trades` — operações simuladas completas com todos os campos de auditoria do prompt (simulation_id, robot_id, signal_id, símbolo lógico/MT5, side, volume, price_signal, price_entry_sim, price_exit_sim, ts_signal/entry/exit, spread, slippage_ticks, fee_brl, points_result, gross_brl, net_brl, entry_reason, exit_reason, locks_triggered jsonb, status, observations).
- `b3_mt5sim_blocks` — sinais bloqueados por travas (robot, lock_kind, observed, limit, signal_id, motivo, ts).
- `b3_mt5sim_conflicts` — snapshots de conflito entre robôs (ts, robots jsonb, sides, prices, outcome_delta).
- `b3_mt5sim_order_attempts` — log de qualquer tentativa (interna) de enviar ordem real enquanto o modo está ativo (erro crítico).

## Ponte MT5 (cotação real, sem ordens)

Não há SDK do MT5 no Worker. Uso um **puller local** externo (script Python no PC do usuário rodando junto com o MT5 XP) que faz POST periódico de ticks para um endpoint público protegido por HMAC. Não escrevo o script agora; entrego o endpoint e a documentação inline.

- `src/routes/api/public/hooks/b3-mt5sim-tick-ingest.ts` — POST `{symbol, bid, ask, last, spread, ts, volume, symbol_status, server, account_masked}` assinado com `B3_MT5SIM_INGEST_SECRET` (HMAC-SHA256 do corpo, header `x-mt5-signature`, timing-safe). Grava em `b3_mt5sim_quotes` via `supabaseAdmin`. Rejeita se `symbol != settings.mt5_symbol` do owner-alvo (pass user_id no payload ou via secret dedicado por user na v1: um user apenas).
- `src/routes/api/public/hooks/b3-mt5sim-tick.ts` — cron a cada minuto durante pregão: para cada `b3_mt5sim_runs` ativa chama `runMt5SimTick`.
- Secret: peço `B3_MT5SIM_INGEST_SECRET` via `generate_secret` na fase de execução.

## Engine (`src/lib/b3-mt5sim.server.ts`)

Puro server, sem tocar em outros módulos:

- `getLatestQuote(userId)` — última linha de `b3_mt5sim_quotes` dentro do TTL; se stale → status `quote_stale`, pausa tick.
- `generateSignalsForRobots(userId, quote)` — chama estratégias locais leves por perfil (conservador→agressivo) usando janela recente de ticks/últimos preços. Implementação inicial: 5 estratégias determinísticas parametrizadas (SMA fast/slow + threshold + cooldown), suficiente para gerar sinais divergentes por perfil. Ganchos para plugar comitê B3 depois, mas **sem importar** `b3-committee` nesta fase.
- `evaluateRobotLocks(robot, wallet, signal, quote)` — aplica todas as travas do prompt; retorna `{allow, lock?}`. Bloqueios são gravados em `b3_mt5sim_blocks`.
- `openSimTrade` / `manageOpenTrades` / `closeSimTrade` — simulação de execução, stop, alvo, sinal contrário, zeragem por horário, fim de pregão, kill switch. Preço de entrada/saída por `price_source`. Cálculo: `points = (exit - entry) * sideSign / tick_size * tick_size`; `gross = points * point_value * volume`; `fee = fee_per_contract_brl * volume * 2`; `net = gross - fee - slippage_brl`.
- `recordConflicts(userId, ts)` — detecta robôs com posições/sinais opostos no mesmo minuto e persiste em `b3_mt5sim_conflicts`.
- `assertNoRealOrder(ctx)` — helper exportado: se alguém chamar rota real (`atrader`/`b3` real) enquanto `b3_mt5sim_runs.status='running'` e `kill_switch_real=true`, grava em `b3_mt5sim_order_attempts` e lança. **Não** conecto isso automaticamente em código Binance/B3 existente — apenas exponho para uso futuro (o kill switch real já bloqueia envio real por padrão via flag).

## Server functions (`src/lib/b3-mt5sim.functions.ts`)

Todas com `requireSupabaseAuth`:

- `getMt5SimDashboard` — settings, run atual, quote atual, wallets por robô, últimas trades, últimos blocks, últimos conflicts, ranking, contadores (ordens reais enviadas = 0 fixo).
- `updateMt5SimSettings`, `upsertMt5SimRobot`, `toggleMt5SimRobot`.
- `startMt5SimRun`, `stopMt5SimRun`, `resetMt5SimDay`.
- `listMt5SimTrades`, `listMt5SimBlocks`, `listMt5SimConflicts`, `getMt5SimRanking`, `getMt5SimPromotionStatus`.

## UI (rota nova)

`src/routes/_authenticated/b3-mt5sim.tsx` — painel único, sem tocar em telas B3 existentes:

- Header destacado: **"SIMULAÇÃO LOCAL — USANDO COTAÇÃO REAL DO PRD — SEM ENVIO DE ORDEM"**, servidor, símbolo, última cotação, robôs ativos, "Ordens reais enviadas: 0".
- Card **Configuração** (edita `b3_mt5sim_settings`).
- Grid **Robôs Participantes** (por perfil, com travas e volume).
- Grid **Carteira simulada por robô** (todas as métricas do prompt).
- **Ranking** dos robôs.
- Abas: Trades simuladas · Sinais bloqueados · Conflitos entre robôs · Auditoria.
- Bloco **Critério para próxima fase** com status ou "Execução real bloqueada — simulação ainda insuficiente".

Link no menu B3 (uma linha no layout B3 se existir, senão só via URL).

## Instruções ao usuário (no painel, texto)

Como o Worker não fala MT5 diretamente, o painel exibirá as credenciais do ingest endpoint e um snippet Python de ~40 linhas usando `MetaTrader5` para bombear ticks do WINQ26 para o endpoint. Sem esse puller local rodando, o painel mostra `Cotação inválida ou desatualizada — simulação pausada`.

## Fora de escopo

- Não implemento o script Python neste ciclo (só documento e mostro no painel).
- Não pluggo comitê B3 aqui; estratégias iniciais são locais e substituíveis.
- Não altero nada fora dos arquivos/tabelas `b3_mt5sim_*` + a nova rota.

## Ordem de execução

1. Migration (todas as tabelas + GRANT + RLS + triggers).
2. `generate_secret` `B3_MT5SIM_INGEST_SECRET`.
3. Engine + server functions + rotas API (ingest + tick cron).
4. Rota UI `b3-mt5sim.tsx`.
5. Verificação de build.

Confirma para eu executar?
