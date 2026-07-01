# Flexibilização Inteligente dos Bloqueios Diários — B3

Escopo isolado 100% no módulo B3. Nenhum arquivo Binance (`binance-*`, `pipeline-runner.server.ts`, `committee.server.ts`, `binance-brain*`) é tocado.

## 1. Banco de dados (migration única)

**Novas colunas em `b3_simulation_mode_settings`** (parâmetros por modo, editáveis no painel):
- `minimum_trades_before_profit_lock` int default 15
- `minimum_operating_minutes` int default 90
- `profit_multiplier_before_lock` numeric default 2.0
- `post_target_allowed_retracement` numeric default 0.30
- `consecutive_loss_after_target` int default 2
- `post_target_size_reduction` numeric default 0.50 (redução automática do size em observação)

**Novas colunas em `b3_simulation_modes`** (estado runtime por modo/run):
- `protection_state` text default 'operating_normal' — enum livre: `operating_normal | target_reached_observing | profit_protected | blocked_stop | blocked_drawdown | blocked_volatility | blocked_ops_failure | blocked_post_target_loss`
- `target_reached_at` timestamptz
- `profit_at_target_brl` numeric
- `trades_at_target` int
- `peak_profit_after_target_brl` numeric default 0
- `profit_after_target_brl` numeric default 0
- `trades_after_target` int default 0
- `consecutive_losses_after_target` int default 0
- `block_reason` text

**Nova tabela `b3_daily_protection_history`** — snapshot diário (data, mode_id, user_id + colunas de auditoria pedidas: profit_at_target, profit_at_block, profit_at_close, extra_profit, given_back, trades, trades_after_target, target_time, block_time, reason, final_status). RLS por user_id; grants padrão.

Nenhuma tabela Binance é alterada.

## 2. Motor B3 — novo módulo isolado

Criar `src/lib/b3-protection.server.ts` com:
- `evaluateProtectionState(mode, settings, dayStats)` — decide transição de estado, retorna `{ state, block_reason?, size_multiplier }`.
- `applyPostTargetSizing(baseQty, state, settings)` — reduz size em observação.
- Regras:
  1. Se `realized_today <= -daily_loss_limit` → `blocked_stop` (soberano, imediato).
  2. Falha operacional / erro API / rejeição → `blocked_ops_failure`.
  3. Volatilidade extrema → `blocked_volatility`.
  4. Meta atingida (profit ≥ target) **E** trades ≥ min **E** minutos ≥ min → transição para `target_reached_observing` (não bloqueia).
  5. Se profit ≥ target × multiplier → `profit_protected` (continua operando com size reduzido).
  6. Em observação/protegido: bloquear se `(peak_after_target - current_after_target) / peak_after_target > retracement` → `blocked_post_target_loss`; ou `consecutive_losses ≥ N` → mesmo; ou drawdown máximo.

Integrar em `src/lib/b3-simulation.functions.ts` (`runB3SimulationTick`) substituindo o gate atual de "meta atingida = bloqueia": chamar `evaluateProtectionState`, aplicar `size_multiplier` no cálculo de qty, gravar estado + block_reason em `b3_simulation_modes`, e ao fim do dia snapshot para `b3_daily_protection_history`.

Log em `b3_simulation_block_events` já existente para cada transição (reaproveita infraestrutura B3 atual, sem tocar Binance).

## 3. UI (painel B3 apenas)

`src/components/b3/SimComparePanel.tsx`:
- Badge de estado com cores (verde operando, amarelo observando, azul protegido, vermelho bloqueado + motivo).
- Bloco "Proteção pós-meta" por modo: horário da meta, lucro na meta, lucro atual, extra, devolvido, trades pós-meta, drawdown pós-meta, tempo desde a meta.
- Modal de settings (engrenagem já existente) ganha os 6 novos campos configuráveis por modo.

`src/routes/_authenticated/b3.tsx` (aba Relatório): tabela lendo `b3_daily_protection_history` — colunas conforme "HISTÓRICO" do prompt, com filtro por data/modo e export CSV.

## 4. Server functions B3

`src/lib/b3-simulation.functions.ts`:
- Estender `updateModeSettings` para aceitar os 6 novos parâmetros.
- Novo `getProtectionHistory({ from, to, mode })` — lê `b3_daily_protection_history`.
- Novo `getProtectionState({ run_id })` — lê estado corrente por modo.

## 5. Compatibilidade

- Operação Real B3 (`b3.functions.ts`, `atrader.functions.ts`) recebe o mesmo helper `evaluateProtectionState` importado do novo `b3-protection.server.ts` — sem duplicação, mas 100% B3.
- Comparação Simulado × Real continua idêntica (mesmo shape de dados).
- Cron `b3-simulation-tick` inalterado.

## Detalhes técnicos

- Estado persistido em DB (não em memória) para sobreviver a reinícios.
- Reset diário: primeiro tick após 00:00 BRT zera `target_reached_at`, contadores pós-meta e `protection_state='operating_normal'` — antes disso grava snapshot do dia anterior.
- `size_multiplier` default: 1.0 operando, 0.5 observando, 0.35 protegido (via `post_target_size_reduction`).
- Stop diário mantém a lógica atual de `daily_loss_limit` — não flexibilizado.

## Fora de escopo (não tocar)

`binance-*.ts`, `pipeline-runner.server.ts`, `committee.server.ts`, `binance-brain*`, tabelas `binance_*`, rota `/binance-*`.
