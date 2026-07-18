## Correção do motor MT5 XP DEMO — Fase 1 (crítica) + Fases 2 e 3

Escopo isolado ao módulo **Simulação Local MT5 XP** (`b3_mt5sim_*`). Não toca B3 Day Trade, Binance, ponte MT5, endpoint de ingestão nem tabelas existentes fora do módulo.

---

### Fase 1 — Entrega imediata (o que a resposta final vai instruir a implantar primeiro)

Corrige exatamente as 3 causas apontadas: matemática ruim, posição sem watchdog, sinais duplicados.

**1.1 Validação R:R antes da entrada** (`b3-mt5sim.server.ts` → `openTrade`)
- Novo cálculo por trade: `risco_bruto = stop_pts × R$/pt`, `custo = fee + spread_ticks × R$/tick + slippage_ticks × R$/tick`, `risco_liquido = risco_bruto + custo`, `ganho_liquido = alvo_pts × R$/pt − custo`.
- Bloqueia se `ganho_liquido < min_rr × risco_liquido`.
- Novos campos em `b3_mt5sim_settings`: `min_risk_reward numeric default 1.2`, `max_tick_age_seconds int default 5`, `max_tick_jump_pts int default 500`, `slippage_ticks_entry`, `slippage_ticks_exit`.
- Registra `b3_mt5sim_blocks` com motivo `risk_reward_below_threshold` e payload `{risk_net, reward_net, rr}`.

**1.2 Watchdog independente de saída** (`runMt5SimTick`)
- Refatorado em 2 fases sequenciais por tick:
  1. **manageOpenPositions()** — sempre roda, mesmo se tick antigo ou entradas bloqueadas. Checa stop/alvo/trailing/tempo/horário e atualiza MFE/MAE. Se posição ficou > 60s sem atualização → grava `position_management_alert` em `b3_mt5sim_blocks`.
  2. **evaluateNewEntries()** — só roda se watchdog aprovar o tick.
- Try/catch isola cada fase: falha em entrada nunca impede saída.

**1.3 Proteção de tick antigo e gap** (novo helper `assessTick`)
- Grava `last_tick_at` em `b3_mt5sim_runs`.
- Se `age > max_tick_age_seconds` → bloqueia entradas (mantém gestão).
- Se `|price_new − price_prev| > max_tick_jump_pts` → marca `gap_detected`, não executa entrada no tick do gap, mas permite gestão usando último preço conhecido conservador.
- Loga `{prev_price, new_price, gap_pts, interval_ms, rule}` em `b3_mt5sim_blocks`.

**1.4 Deduplicação de sinais entre perfis** (`evaluateNewEntries`)
- Cada sinal recebe `signal_id = hash(symbol|side|bucket_1min|context_key)`.
- Se ≥2 perfis geram mesmo `signal_id` no mesmo tick → escolhe o de maior `score`; demais entram em `b3_mt5sim_blocks` com motivo `duplicate_signal` e `winning_profile`.
- Adiciona coluna `signal_id text` em `b3_mt5sim_signals` (nullable).

**1.5 Telemetria mínima** (para viabilizar Fase 3)
- Adiciona colunas em `b3_mt5sim_trades`: `mfe_pts, mae_pts, mfe_brl, mae_brl, best_price, worst_price, duration_s, initial_risk_brl, initial_target_brl, max_open_profit_brl, exit_reason_detail, tick_age_entry_s, tick_age_exit_s, spread_entry_ticks, spread_exit_ticks`.
- `manageOpenPositions()` atualiza MFE/MAE/best/worst a cada tick.
- `closeSimTrade` preenche o restante.

---

### Fase 2 — Gestão de saída configurável (entrega em seguida)
- Novo bloco em `b3_mt5sim_robots`: `exit_mode` (`fixed | breakeven | trailing | loss_of_momentum | time_based | session_close`), `breakeven_trigger_pts`, `trailing_start_pts`, `trailing_step_pts`, `max_duration_s`.
- Implementa cada modo dentro de `manageOpenPositions()`. `force_close` fica só como proteção final por horário/erro.

---

### Fase 3 — Painel de expectativa matemática e diferenciação por perfil
- Server fn `getMt5SimExpectancy` agrega por robô: ganho médio, perda média, payoff, breakeven hit-rate, expectancy, profit factor, drawdown, resultado por saída/horário/direção.
- Aba nova "Expectativa" em `/b3-mt5sim` (usa componentes existentes de tabela/card).
- Diferenciação real por perfil: cada `profile` ganha filtros próprios de volatilidade mínima, confirmação (n candles), duração máxima e trailing — expostos no dialog de configuração do robô já existente.
- Trava de promoção: server fn `evaluatePromotionReadiness` exige amostra mínima + expectancy > 0 + profit factor ≥ 1.3 + drawdown ≤ limite + estabilidade por período (não só lucro total).

---

### Preservação garantida
- Nenhum `DROP`, nenhum rename de tabela, histórico intacto.
- Ponte MT5 e endpoint `/api/public/hooks/b3-mt5sim-tick-ingest` não são tocados.
- Guard `assertNoRealOrderIfSimActive` permanece; contador de ordens reais continua zero.
- Zero mudança em B3 Day Trade WIN, Binance ou cripto.

---

### Ordem de implementação e arquivos
1. **Migração**: colunas novas em `b3_mt5sim_settings`, `b3_mt5sim_trades`, `b3_mt5sim_signals`, `b3_mt5sim_runs`.
2. **`src/lib/b3-mt5sim.server.ts`**: refatora `runMt5SimTick` em `assessTick` + `manageOpenPositions` + `evaluateNewEntries`; adiciona R:R gate, dedup, telemetria MFE/MAE.
3. **`src/lib/b3-mt5sim.functions.ts`**: expõe novos campos de settings em `settingsSchema` e `robotSchema`.
4. **Fase 2**: modos de saída no watchdog + campos por robô.
5. **Fase 3**: `getMt5SimExpectancy`, `evaluatePromotionReadiness`, aba nova no painel.

Ao final da Fase 1 entrego relatório curto com: arquivos alterados, colunas novas, comportamentos antes/depois e validação (compila + smoke test de dedup + R:R).

Confirma que sigo por essa ordem (Fase 1 agora, depois Fase 2 e 3)?