## Objetivo
Corrigir o problema recorrente de login/Auth sem reconstruir módulos e sem alterar a ponte MT5, ingestão de ticks, estratégias, stops, gains, contratos ou execução.

## Diagnóstico confirmado até agora
- O login apresentou timeout `504` no endpoint de autenticação, exibindo: “Autenticação demorou para responder”.
- A verificação de saúde do backend retornou timeout antes do restart, e agora o backend ainda está subindo/aplicando mudanças.
- Há polling contínuo em várias telas protegidas, incluindo B3/MT5, dashboard, diagnóstico e painéis operacionais.
- No B3/MT5, há atualizações automáticas em intervalos curtos, como 2s, 3s, 4s e 8s, que continuam disputando recursos com Auth quando a tela fica aberta.

## Plano de correção

### 1. Esperar backend estabilizar antes de mexer no banco
- Reconsultar a saúde do Lovable Cloud até o backend voltar ao estado normal.
- Só aplicar migrações depois disso, para evitar falha parcial ou diagnóstico falso.

### 2. Otimizar consultas críticas do B3 MT5
Criar uma migração de índices para aliviar leituras frequentes, principalmente em:
- `b3_mt5sim_quotes`, priorizando busca por `user_id`, `symbol` e `tick_ts DESC`.
- Tabelas de auditoria/simulação usadas pelo diagnóstico e pelos painéis de 5 modos.

Critério: acelerar leitura do último tick, histórico recente e auditorias sem alterar a lógica de ticks nem o endpoint.

### 3. Reduzir carga automática no frontend
Ajustar apenas os painéis que fazem polling pesado:
- `src/routes/_authenticated/b3-mt5sim.tsx`
- `src/components/b3/SimComparePanel.tsx`
- `src/components/b3/PipelineAuditPanel.tsx`
- se necessário, painéis B3 relacionados em `src/routes/_authenticated/b3.tsx`

Mudanças previstas:
- Pausar polling quando a aba estiver oculta (`document.visibilityState !== "visible"`).
- Aumentar intervalos agressivos onde não há necessidade de atualização a cada 2–4 segundos.
- Manter atualização em tempo útil quando a tela estiver visível.
- Evitar invalidações globais desnecessárias.

### 4. Tornar Auth mais resiliente sem esconder erro real
Refinar o fluxo de autenticação em:
- `src/routes/auth.tsx`
- `src/routes/_authenticated/route.tsx`
- `src/routes/__root.tsx`, se necessário

Mudanças previstas:
- Não forçar logout em timeout transitório se ainda existir sessão local válida.
- Evitar múltiplas limpezas/invalidações simultâneas de cache.
- Distinguir erro definitivo de sessão expirada versus backend lento.
- Manter a tela atual quando houver recuperação possível.

### 5. Validar no runtime
Depois das mudanças:
- Testar login real no preview.
- Abrir B3/MT5 e deixar a tela parada para confirmar que não derruba sessão.
- Confirmar que os painéis continuam atualizando quando visíveis.
- Confirmar que o backend não retorna novo timeout em Auth durante uso normal.

## Critério de conclusão
- O usuário consegue logar.
- A sessão não cai ao deixar a Simulação/B3 MT5 aberta.
- Os painéis B3 continuam funcionando, mas sem polling excessivo em segundo plano.
- O Auth deixa de competir com consultas pesadas do motor e diagnóstico.