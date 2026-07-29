## Diagnóstico encontrado

O problema atual de login não parece ser senha, tela de login ou permissão do usuário.

Evidências verificadas:
- A tentativa de login está falhando em `POST /auth/v1/token?grant_type=password` com **504 upstream request timeout**.
- Os logs recentes de Auth mostram repetidamente falhas como **context deadline exceeded** e falha de conexão do serviço de autenticação com o banco.
- O backend aparece “respondendo”, mas a checagem de métricas do banco também deu timeout, indicando instabilidade/intermitência no backend, não só no frontend.
- As queries mais pesadas neste momento vêm do fluxo B3/MT5: ingestão de ticks, leitura do último tick e inserts de auditoria/simulação. Há consulta lenta buscando `b3_mt5sim_quotes` ordenando por `tick_ts desc`, mas o índice existente é em `received_at desc`, ou seja: parte do fluxo está consultando por um campo diferente do índice.
- A tela `/auth` ainda tenta login direto por email/senha; quando o backend de Auth demora, ela apenas repete e mostra toast, mas não oferece um caminho robusto de recuperação da sessão.

Resumo da causa provável:

```text
Backend Auth está dando timeout ao acessar o banco
+ fluxo B3/MT5 gera leituras/escritas frequentes
+ algumas consultas críticas não estão indexadas do jeito que são usadas
+ frontend refaz serverFns constantemente
= Auth fica instável, login falha com 504 e sessão cai/parece cair
```

## Plano de correção

### 1. Recuperação imediata do backend
- Solicitar/aplicar restart controlado do backend Lovable Cloud.
- Depois do restart, confirmar:
  - login por email/senha;
  - `/auth/v1/token` sem 504;
  - dashboard protegido carregando sem tela branca;
  - Simulação MT5 aberta sem redirecionar para `/auth`.

### 2. Corrigir gargalos de banco sem mexer na ponte MT5
Criar uma migração pequena apenas com índices, sem alterar endpoint de ingestão nem estratégia:
- Índice para último tick MT5 por usuário/símbolo/servidor usando `tick_ts desc`.
- Índice para último tick por `received_at desc`, preservando o fluxo existente.
- Índices compostos para ordens abertas/rodadas ativas usadas pelos painéis.
- Índices para auditorias/bloqueios por `user_id`, `simulation_run_id`, `mode` e data.

Objetivo: reduzir a pressão do banco para que Auth não concorra com consultas lentas do motor B3/MT5.

### 3. Reduzir polling protegido enquanto a sessão/Cloud estiver instável
Ajustar somente o comportamento de tela:
- Em páginas protegidas com polling, não disparar novos `serverFns` se a aba estiver oculta.
- Se uma chamada protegida retornar 401/timeout, pausar temporariamente o polling e tentar recuperar sessão antes de continuar.
- Evitar que múltiplas queries simultâneas derrubem a experiência quando o backend está lento.

### 4. Endurecer o login sem mascarar erro real
Atualizar `/auth` para:
- Separar claramente erro de credencial vs timeout do backend.
- Não fazer loops agressivos de login.
- Em caso de 504, mostrar estado de “backend demorando” e botão de nova tentativa manual.
- Após login bem-sucedido, validar sessão uma vez e navegar para `/dashboard`.
- Se existir sessão local válida, não forçar logout antes de tentar recuperar.

### 5. Centralizar tratamento de Auth em um único fluxo
Revisar `__root.tsx`, `_authenticated/route.tsx` e `start.ts` para manter:
- um único listener `onAuthStateChange`;
- bearer token em todos os serverFns;
- refresh de sessão controlado;
- limpeza de cache somente quando a sessão realmente estiver inválida, não em timeout transitório.

### 6. Verificação final obrigatória
Testar e registrar:
- login real funcionando;
- ausência de 504 no login durante teste;
- backend saudável após restart;
- queries lentas reduzidas para o fluxo B3/MT5;
- tela da Simulação MT5 permanecendo aberta;
- serverFns protegidas recebendo `Authorization` corretamente;
- sem ordens reais enviadas.

## O que não será alterado
- Não vou alterar a ponte MT5.
- Não vou alterar o endpoint de ingestão.
- Não vou alterar estratégia, stops, gain, contratos ou execução dos robôs.
- Não vou reconstruir o módulo B3/MT5.

## Resultado esperado

O login deixa de depender de tentativas repetidas contra um backend congestionado, o backend reduz a carga do fluxo MT5, e a sessão passa a se recuperar de falhas transitórias sem jogar você para fora do sistema.