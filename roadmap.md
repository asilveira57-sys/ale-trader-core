# Fila de trabalho

## Em andamento
- (nada)

## Concluído
- [x] Estado do motor fora de `b3_simulation_market_snapshots` (tabela `b3_engine_state` + resumo compacto no snapshot).
- [x] Disjuntor diário real de mão única: arma ao encostar na meta (`circuit_gain_latched`, irreversível no dia), dispara na primeira conta limpa com o realizado do momento; teto de perda irreversível; `system_logs` ao armar (`disjuntor_diario_meta_armada`) e ao disparar.

## Fila (ordem pedida em 06/09)

- [ ] 2. Tela do simulado:
  - [ ] a) selo/bola verde de robô ativo no real com quantidade de contratos (cruzar pela raiz do ativo)
  - [ ] b) percentual dentro da bolinha de devolução do pico (ou cor no texto), com rótulo "devolvido do pico do dia"
  - [ ] c) seleção múltipla em Ativo, Modalidade e Modo
  - [ ] d) filtro por data (hoje, ontem, 7, 30 dias, intervalo) com fonte `b3_cenario_horario` para períodos longos; "sem dado no período" em vez de zero; cabeçalho diferente quando o período não é hoje
- [ ] 3. Autorizações: editar contratos na linha com robô ligado, aplicar em lote por modalidade, somatório de capital exigido ao editar, ligar/desligar todos por modalidade, aviso quando a margem passar do caixa livre.

## Invariantes
- Não alterar decisão de entrada, parâmetros dos modos, guardião de saída, ponte MT5 nem endpoint de ingestão.
