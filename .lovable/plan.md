
## Objetivo

Resolver 3 problemas reportados:

1. Hoje, cada modo (conservador / moderado / agressivo) tem regras **fixas em código** (`committeeFor` e `modeProfile` em `src/lib/b3-simulation.functions.ts`). Você não consegue ajustar nada pela tela.
2. O **limite diário de perda** é calculado dentro do tick (`stop_pts * 0.20 * contratos * 5`). Quando o modo agressivo bate esse teto, ele para de operar até o fim do pregão — e não há como afrouxar sem pedir prompt.
3. O painel principal "B3 Day Trade — Mini Índice (WIN)" (cards Saldo / Resultado / Status do robô / janela 09:05–17:30) lê de `b3_trading_settings` e não enxerga nada que o simulador 3 modos faz. Ficou "engessado".

---

## Parte 1 — Configuração por modo (persistida)

### Mudança no banco

Nova tabela `public.b3_simulation_mode_settings` (1 linha por run × modo). Campos editáveis:

- `min_approve_votes` (int) — quantos agentes precisam aprovar
- `min_confidence` (int %) — confiança média mínima
- `min_score` (int) — score mínimo do comitê
- `max_contracts` (int) — tamanho da posição
- `stop_pts` (int) — stop em pontos do WIN
- `gain_pts` (int) — alvo em pontos do WIN
- `max_volatility_pct` (numeric) — volatilidade máxima para abrir
- `daily_loss_limit_brl` (numeric) — **teto de perda diária** (R$, editável livremente)
- `daily_gain_target_brl` (numeric) — meta diária
- `trading_start_time` (text "HH:MM")
- `entry_cutoff_time` (text "HH:MM") — última entrada
- `force_close_time` (text "HH:MM") — zeragem
- `enabled` (bool) — se este modo opera nesta run
- `notes` (text)

Defaults populados ao criar a run (mesmos valores hardcoded de hoje, para preservar comportamento). RLS por `user_id`, GRANTs ao `authenticated` e `service_role`.

### Mudança no engine

`src/lib/b3-simulation.functions.ts` (`runB3SimulationTick`):

- Carrega `b3_simulation_mode_settings` junto com `b3_simulation_modes`.
- Substitui `committeeFor(mode)` e `modeProfile(mode)` por leitura dos settings da run.
- Substitui o cálculo automático de `daily_loss_limit` por `settings.daily_loss_limit_brl` (e idem `daily_gain_target_brl`).
- Janela de horário (`startMin / cutoffMin / forceMin`) passa a ser **por modo**, não global da run.
- `enabled === false` → modo é pulado no tick (sem registrar bloqueio).

### Novos server fns

Em `src/lib/b3-simulation.functions.ts`:

- `listB3ModeSettings({ run_id })` → 3 linhas (uma por modo).
- `updateB3ModeSettings({ run_id, mode, patch })` → aceita qualquer subset dos campos acima e grava direto. Sem validação de "máximo permitido" — você define livremente (incluindo afrouxar perda de 10% para 30%).
- `resetB3ModeSettingsToDefault({ run_id, mode })` — restaura o profile original.

### Mudança na UI do simulador

Em `src/components/b3/SimComparePanel.tsx`, dentro de cada `ModeCard`:

- Botão **"Configurar"** abre um `Dialog` com formulário (todos os campos acima).
- Switch **"Operar este modo"** liga/desliga `enabled` sem precisar encerrar a run.
- Badge mostrando regras atuais resumidas ("min votos 5 · stop 150pts · perda diária R$ 300").
- Botão "Restaurar padrão".

---

## Parte 2 — Painel B3 Day Trade alimentado pelo simulador

O painel da aba **Painel** (a captura que você mandou) hoje só lê `b3_trading_settings`. Vou ligá-lo à run de simulação **ativa**:

### Novo server fn

`getB3PanelOverview()` em `src/lib/b3.functions.ts`:

- Busca a run com `status='running'` mais recente do usuário.
- Soma `current_balance`, `realized_pnl`, `total_fees`, `points_result`, `contracts_traded`, `total_trades` dos 3 modos (somente os `enabled`).
- Calcula `operações abertas` (`b3_simulation_orders` com `status='open'`) e `encerradas` (`closed` no dia).
- Retorna também: modo "vencedor parcial" (maior PnL), janela efetiva (menor `start` / maior `force_close` entre modos habilitados), totais de bloqueios.

### Mudanças visuais em `src/routes/_authenticated/b3.tsx` (aba Painel)

- Cards Saldo / Resultado bruto / Taxas / Líquido / Pontos / Contratos / Ops abertas / Ops encerradas passam a vir de `getB3PanelOverview()`.
- "Status do robô" mostra: run id resumido, modos ativos (chips com cor), janela efetiva, e link "Configurar modos" que abre a aba Simulação 3 Modos.
- Quando **não há run ativa**, exibir um CTA: "Nenhuma simulação rodando — Iniciar nova" (mesma ação do `StartForm`).

---

## Parte 3 — Esclarecimentos

- **Não vou** mexer no engine de execução (regras de stop/gain do tick continuam idênticas; só o **input** dos parâmetros mudou).
- **Não vou** ligar nada na operação real (Binance/B3 broker) — tudo continua sandbox.
- O `b3_trading_settings` antigo continua existindo para compatibilidade do cron `auto-tick`, mas o painel visual passa a refletir o simulador 3 modos, que é onde a ação realmente acontece hoje.

---

## Arquivos afetados

- **Nova migração**: cria `b3_simulation_mode_settings` + trigger updated_at + GRANTs + RLS + popula defaults para runs existentes em `running`/`paused`.
- `src/lib/b3-simulation.functions.ts` — usa settings da tabela; novos fns CRUD.
- `src/lib/b3.functions.ts` — `getB3PanelOverview`.
- `src/components/b3/SimComparePanel.tsx` — botão Configurar + Dialog por modo + switch enabled.
- `src/routes/_authenticated/b3.tsx` — aba Painel passa a usar overview do simulador.

Tudo isso em duas etapas (migração primeiro, código depois) porque as migrações exigem sua aprovação antes de rodar.

Posso seguir?
