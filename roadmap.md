# Fila de trabalho

## Em andamento
- [ ] A2: paginar as duas leituras do cockpit simulado e conferir faixa WIN/período de 30 dias; listar outros limites sem alterar.
- [ ] B: recolhimento independente por modalidade — condicionado a crédito diário restante.
- [ ] Redução de VOLUME do banco (votos só nas aprovadas, resumo diário do diário de decisões, retenção 48h) — **só depois das 18:00**, exige migração em tabela grande.


## Concluído
- [x] Confirmação de entrada, EM SOMBRA (23/09): cada ordem simulada grava limiar (% do stop do próprio robô), janela, se teria confirmado, quando, a que preço e onde stop/alvo ficariam com a entrada no preço de confirmação. Configuração por robô (ativo × modalidade × modo) **desligada em todos os 767**, pré-preenchida com 50% e 180 s. Card do robô e cópia mostram "Com confirmação" / "Sem confirmação" em reais. A regra não bloqueia, não atrasa e não reduz nada — nem no simulado, nem no real. **Só passa a gravar no motor após publicar.**
- [x] Emenda (23/09) — regra LIGADA: quando o robô tiver a confirmação ligada, o sinal espera; confirmou → abre no preço da confirmação (stop e alvo medidos desse preço, mesma distância em pontos); não confirmou na janela → entrada descartada com linha em `b3_entry_decision_log` (`estagio='confirmacao_nao_atingida'`, exigido/andou/janela/preço do sinal/lado). O sinal em espera mora em `b3_simulation_modes.confirmacao_pendente`. A regra decide SE abre; nunca fecha posição aberta. Continua desligada em todos.
- [x] Segunda emenda (23/09) — DUAS chaves independentes por robô (`confirmacao_ativa_simulado`, `confirmacao_ativa_real`; percentual e janela compartilhados; a chave única saiu). Quatro combinações: nenhuma ligada = sombra pura; simulado ligado = só o simulado espera e o comando real sai no instante do sinal; real ligado = o simulado abre na hora e o comando real só é enfileirado na confirmação (preços de entrada diferentes, esperado); as duas ligadas = espelho fiel. Descarte sempre com `lado` ('simulado' | 'real' | 'ambos') no motivo e no detalhe; uma linha só quando as duas esperam. Tela do robô com dois interruptores e aviso quando os lados divergem. Entrega com as duas desligadas nos 767 robôs.
- [x] Testeira e comparativos de freio (22/09): todos os resultados passaram a mostrar os pares “Com freio” e “Sem freio”, sem linguagem de diferença — somente apresentação.
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

## Correção estrutural (24/09/2026) — gatilho do real
- O comando real nasce do SINAL APROVADO, não da ordem simulada: `confirmacao_ativa_simulado` e `confirmacao_ativa_real` decidem lados independentes (OFF/OFF e ON/OFF enfileiram o real no instante do sinal; OFF/ON e ON/ON esperam a confirmação).
- Motivo de `confirmacao_nao_atingida` mede o avanço DENTRO da janela; excursão total em `andou_pts_total`.
- [x] Cockpit: destacar cabeçalhos por ativo e modalidade; mostrar Com freio/Sem freio nos últimos cinco pregões e total de cinco dias nos dois níveis.

- [x] Visão por datas do cockpit com as mesmas testeiras coloridas por ativo/modalidade do dia, com somatórios do período (26/09)

## Limites proporcionais (29/09)
- [x] Percentuais por robô (chave desligada), contratos = piso(capital×risco_pct/margem do ativo), margem por ativo em branco
- [x] Trava de capital real assimétrica (queda imediata, alta >30% quarentena 3 leituras)
- [x] Tela de proposta de conversão + confirmar/lote/desfazer + capital na tela
