## Diagnóstico

O Bid/Ask exibido no topo já vem corretamente da ponte MT5 XP DEMO. O problema está abaixo, na camada de simulação/histórico do B3:

1. A tabela de “Últimas operações simuladas” ainda mostra operações antigas/legadas do `b3_simulation_orders` com `quote_source` nulo/desconhecido.
2. Ao ativar MT5, o código atual cancela principalmente posições abertas legadas, mas não remove/quarentena operações já fechadas ou registros antigos da run ativa.
3. O painel de diagnóstico ignora esses registros para “última entrada/saída”, mas a tabela continua exibindo-os; por isso o topo mostra MT5 real e a tabela mostra 129.xxx/131.xxx.
4. Falta uma trava definitiva em múltiplas camadas para impedir qualquer inserção futura em modo MT5 se o preço não vier explicitamente do `B3QuoteProvider` com `quote_source = MT5 XP DEMO`.

## Objetivo da correção

Quando a fonte estiver em `MT5 XP DEMO`, o módulo B3 Day Trade WIN deve ficar em modo estrito:

- Entrada BUY sempre pelo Ask MT5.
- Entrada SELL sempre pelo Bid MT5.
- Fechamento de BUY sempre pelo Bid MT5.
- Fechamento de SELL sempre pelo Ask MT5.
- Nenhum preço 128.xxx/129.xxx/130.xxx/131.xxx pode aparecer como nova operação em modo MT5.
- Operações legadas não devem aparecer misturadas como se fossem operações atuais MT5.
- Ordem real enviada continua sempre zero.

## Plano de implementação

### 1. Criar uma barreira única de execução MT5 no backend

Adicionar um helper server-side específico para execução B3 em modo MT5 estrito:

```text
resolveB3StrictExecutionPrice(side, action)
  -> lê B3QuoteProvider
  -> exige fonte mt5_xp_demo
  -> exige quote_source MT5 XP DEMO
  -> exige server XPMT5-DEMO
  -> exige symbol WINQ26
  -> exige tick <= 5s
  -> calcula preço por bid/ask
  -> rejeita qualquer preço fora da banda do tick MT5
```

Esse helper será usado por:

- abertura automática da Simulação 3 Modos;
- fechamento automático por stop/gain/zeragem;
- marcação a mercado;
- ordem manual simulada;
- fechamento manual simulado;
- comitê B3 quando gerar contexto de decisão.

### 2. Blindar a run ativa ao entrar em MT5

Quando o usuário selecionar MT5 XP DEMO ou quando o tick da simulação rodar com MT5 ativo:

- localizar ordens da run ativa com `quote_source` diferente de `MT5 XP DEMO`;
- marcar essas ordens como `cancelled` ou `legacy_invalidated`, sem recalcular resultado;
- registrar evento de bloqueio/auditoria explicando:

```text
Operação legada ocultada/invalida — modo MT5 XP DEMO exige preço B3QuoteProvider
```

Isso elimina a mistura visual e operacional entre CSV antigo e MT5.

### 3. Filtrar a tela de “Últimas operações simuladas” em modo MT5

Na aba Simulação 3 Modos, quando a fonte ativa for MT5:

- exibir por padrão somente operações com `quote_source = MT5 XP DEMO`;
- mostrar um aviso se houver registros legados ocultados;
- opcionalmente listar esses registros em uma seção separada “Legado invalidado”, sem entrar no ranking/resultado atual.

Assim, a tabela principal nunca mais mostrará 129.xxx como operação válida MT5.

### 4. Corrigir ranking, score e resultado para ignorarem legado em MT5

Em modo MT5, todos os cálculos de:

- PnL;
- ranking;
- score;
- modo sugerido;
- estatísticas;
- últimas operações;
- relatório;

devem considerar somente ordens com auditoria MT5 válida.

Regra:

```text
Se price_source = mt5_xp_demo:
  aceitar apenas quote_source = MT5 XP DEMO e provider_name = B3QuoteProvider
```

### 5. Adicionar trava de banco para impedir novas escritas inválidas

Criar uma validação no banco para `b3_simulation_orders` e `b3_orders`:

- se o usuário estiver com `b3_trading_settings.price_source = mt5_xp_demo`;
- e a linha nova/alterada for uma ordem B3;
- então exigir:
  - `quote_source = 'MT5 XP DEMO'`;
  - `provider_name = 'B3QuoteProvider'`;
  - `quote_server = 'XPMT5-DEMO'`;
  - `quote_symbol = 'WINQ26'`;
  - `legacy_price_detected = false`.

Se algum caminho antigo tentar gravar preço legado, a gravação falha imediatamente.

### 6. Auditoria explícita de tentativa bloqueada

Quando qualquer rotina tentar abrir/fechar com preço não-MT5 em modo MT5, registrar em `b3_simulation_block_events`:

```text
Tentativa de preço legado bloqueada — modo MT5 XP DEMO ativo
```

Com payload contendo:

- função que tentou executar;
- preço rejeitado;
- último Bid/Ask/Last MT5;
- fonte esperada;
- fonte recebida;
- run/mode/side/action.

### 7. Ajustar o painel de diagnóstico

No card “Diagnóstico de Fonte do Motor B3”, deixar explícito:

- Fonte ativa: MT5 XP DEMO;
- Provider usado: B3QuoteProvider;
- Chamadas MT5: maior que zero;
- Chamadas legado: zero;
- Operações MT5 válidas: quantidade;
- Operações legadas ocultadas/invalidadas: quantidade;
- Última entrada/saída válida MT5.

### 8. Validação final

Depois da implementação, validar com uma run ativa:

- se Bid/Ask estão em torno de 177.xxx;
- uma nova compra abre próxima do Ask;
- uma nova venda abre próxima do Bid;
- fechamento usa lado oposto do book;
- a tabela não mostra mais operações 128.xxx/129.xxx/130.xxx/131.xxx como válidas em MT5;
- se uma rotina tentar gravar legado, ela é bloqueada e auditada;
- ordens reais enviadas permanecem zero.

## Resultado esperado

O B3 Day Trade WIN continuará sendo o cérebro dos robôs, mas em modo MT5 XP DEMO toda execução, fechamento, resultado e exibição operacional passarão obrigatoriamente por preço real da ponte MT5. O histórico legado será separado/invalidationado e não contaminará mais a simulação atual.