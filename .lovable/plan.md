# Simulação do disjuntor e capital exposto — WIN

## Entrega
- Distinguir “pico de lucro no dia” e “pico de capital exposto” em telas, cópias e exportações afetadas. Capital exposto mostra margem crua, contratos, hora e data; reserva aparece separada como “reservar”. Conferir os cards com as frases já encurtadas.
- Refazer a tela existente de simulação com WIN fixo, um dia (último pregão por padrão) ou intervalo, modalidades múltiplas, todos os robôs, limiares 15/25/40/50/75/100% (25% marcado) e capital opcional vazio. Usar os resultados e frases da função pronta, uma linha por dia e limiar, com totais por limiar e cópia completa.
- Mostrar na testeira WIN, ao vivo, o cenário de 25%: horário, motivo e resultado travado, ou “disjuntor não teria armado”. Somente leitura.
- Calcular o piso percentual ao ler a configuração e o stop global atual, sem usar o absoluto armazenado como fonte e sem mudar 0,5 ou 0,35.

## Limites e validação
- Não modificar a função SQL fornecida, b3-simulation.functions.ts, decisões de entrada/saída ou outros limiares; não ler b3_robot_daily_score.
- Conferir pela tela autenticada os três resultados de 23/10 com base automática R$ 4.030; testar intervalo, cópia, celular e controles de 44 px.
- Publicar este pedido e as entregas anteriores pendentes autorizadas; relatar qualquer impedimento real do serviço de publicação.

## Detalhes técnicos
- Leitor autenticado separado chama b3_disjuntor_simulado dia por dia; opções e último pregão vêm de leituras WIN. Sem recálculo local dos cenários.
- O item D é a exceção explícita ao escopo de apresentação: substituir apenas a fonte do piso na leitura pelo percentual × computeGlobalRealStop, mantendo o avaliador e seus percentuais.
- Testes concretos para base automática, seleção de limiares, soma de totais por limiar e piso 0,5 × 192 = 96, acompanhando alterações do stop.