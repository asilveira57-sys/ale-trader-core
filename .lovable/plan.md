# Limites proporcionais (capital e stop) — com proposta de conversão antes de valer

## Objetivo
Os limites em reais deixam de ser números fixos. Eles passam a ser um percentual, e o valor em reais é calculado na hora da decisão:
- **Pelo capital:** piso do freio de pico, meta de ganho do dia, perda diária e número de contratos.
- **Pelo stop daquela entrada:** ativação e devolução do trailing, ativação e folga do breakeven.

A lógica dos freios fica igual. Só muda de onde vem o número que eles comparam.

## Etapa 1 — Campos novos, que nascem inativos
- Cada robô do simulado ganha os percentuais e uma chave "modelo proporcional", que começa **desligada** em todos.
- Com a chave desligada, o robô usa os valores fixos de hoje, como sempre. Nada muda até o Alexandre confirmar.
- Quando a chave é ligada, o motor calcula `valor = percentual × base`, com a base do momento.

## Etapa 2 — De onde vem o capital (sem misturar)
- **Simulado:** a base é o capital da própria carteira simulada do robô: capital inicial mais o resultado acumulado. Nunca a conta real.
- **Real:** a base é o capital líquido lido do MetaTrader, com uma trava:
  - Se a leitura variar mais de 30% em relação à anterior, fica um erro registrado e o sistema mantém o valor anterior.
  - O valor novo só é aceito depois de três leituras seguidas estáveis.
  - O capital que foi aceito fica guardado junto com o último capital lido.
- **Na tela:** "Capital usado no cálculo: R$ X", ao lado dos limites. No real aparece também o valor bruto lido quando ele estiver em quarentena, para o erro de R$ 2.192 contra R$ 469,58 aparecer na hora.

## Etapa 3 — Contratos
- Contratos = capital ÷ capital por contrato (um percentual configurável), arredondado para baixo, com mínimo de 1.
- Quando houver autorização de produção, o teto dela é respeitado. A autorização é só lida, nunca alterada.

## Etapa 4 — Proposta de conversão (não aplica nada)
Uma tela nova no menu lateral, **Limites proporcionais**, com uma linha por robô:
- o valor fixo de hoje;
- o capital de referência, que pode ser editado. O padrão é o capital atual da carteira simulada daquele robô;
- o percentual equivalente, que é o valor fixo ÷ o capital de referência (ou ÷ o stop, para os campos em pontos);
- o valor em reais que o percentual daria com o capital atual.

Em cada linha dá para escolher outro capital de referência ou digitar o percentual direto. Há um botão "Confirmar" por robô e um "Confirmar selecionados", que só funciona depois de marcar os robôs e mostra a lista completa antes de executar. Ao confirmar, os percentuais são gravados, a chave do robô é ligada e fica um registro com os valores anteriores. Também há um "Desfazer", que devolve o modelo fixo.

## Escopo do real
Pela regra do projeto, o real não recebe escrita agora e as autorizações de produção ficam intactas. Nesta entrega o real ganha só:
- a trava de 30% no capital lido;
- a exibição do capital usado no cálculo.

O uso dos percentuais nos limites do real fica para uma decisão sua mais adiante.

## Não mexer
Motor de entrada, confirmação de entrada, os freios em si, a calibração semanal, as autorizações de produção e os commits listados.

## Conferência
- Teste automático com capital de R$ 469,58: o piso do pico calculado tem que ficar menor que o capital.
- Teste com o capital mudando: todos os limites em reais e os contratos acompanham sozinhos.
- Teste da trava: um salto de 469 para 2.192 mantém 469 até três leituras estáveis.
- Com todas as chaves desligadas, um pregão simulado tem o mesmo resultado de antes.

## Detalhes técnicos
- Migração em `b3_simulation_mode_settings`:
  - `limites_proporcionais bool default false`;
  - `peak_lock_min_profit_pct`, `daily_gain_target_pct`, `daily_loss_limit_pct`, `capital_por_contrato_pct`;
  - `trailing_activation_pct_stop`, `trailing_giveback_pct_stop`, `breakeven_ativa_pct_stop`, `breakeven_folga_pct_stop`.
- Migração em `b3_mt5_account_state`:
  - `capital_aceito`, `capital_pendente`, `capital_pendente_leituras`.
- Módulo puro `src/lib/b3-proporcional.ts` (`resolverLimites(cfg, capital, stopPts)`, `aceitarCapital(prev, lido)`), com testes vitest.
- O motor chama `resolverLimites` no ponto em que hoje lê os campos fixos, só quando a chave está ligada.
- O hook `b3-mt5-estado-real` aplica `aceitarCapital`.
