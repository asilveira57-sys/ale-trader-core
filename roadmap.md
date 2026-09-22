# Fila de trabalho

## Em andamento
- [ ] Redução de VOLUME do banco (votos só nas aprovadas, resumo diário do diário de decisões, retenção 48h) — **só depois das 18:00**, exige migração em tabela grande.


## Concluído
- [x] Exportação noturna (22/09): CSV de bloqueios agregados, dossiê de ordens + votos e decisões agregadas gravados no arquivo `b3-arquivo` (AAAA/MM), montados dentro do banco, disparados por cron 18:30–18:50 e registrados em `system_logs`. Retenção saiu do fim da curadoria e virou cron próprio às 19:00. Backfill rodado à mão: 16 a 22/09 salvos, incluindo 17 e 18/09.
- [x] Apresentação do efeito diário dos freios no Cockpit: valores crus, conta explícita e resumos por robô/modalidade/ativo — somente leitura.
- [x] Freios de grupo/stop diário e fechamento por pico separados por conta (21/09): decisões do espelho usam somente resultados reais; sem atividade real não bloqueiam; sombra simulada permanece intacta e logs identificam a origem.
- [x] Nenhum freio bloqueia entrada no simulado (16/09): o veto do agente Risco por perda/meta diárias saiu (era o bloqueio invisível que calava os robôs em `blocked_stop`), `stop_diario` entra em `freios_na_sombra`, e o card mostra "FREIOS ACIONADOS (sombra)" com horário de cada freio. **Só passa a valer no motor após publicar (mercado fechado).**
- [x] Liberação manual de freio para o REAL (16/09): por grupo e por robô, senha mestra para liberar, travar de volta sem senha, cai no pânico e no fim do pregão, registro em `system_logs` (`liberacao_manual` / `liberacao_manual_fim`), comando e ordem real marcados com `liberacao_manual`, simulado e medição da sombra intocados.
- [x] Contraste do botão do menu no celular (retangular, fundo branco, letra preta).
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
