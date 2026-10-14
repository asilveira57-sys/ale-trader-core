# Testeiras do cockpit — somente apresentação, sem publicação

## Controles independentes
- O botão global recolhe/expande somente as grades de robôs, preservando todas as testeiras e faixas de pregões.
- Cada modalidade mantém seu próprio botão para os robôs; cada ativo mantém seu botão separado para esconder modalidades.
- Botões com borda, texto, contraste e altura mínima de 44 px, no canto direito das testeiras.

## Picos nos pregões
- Acrescentar pico em cada dia e um cartão após “Total · 5 pregões”, com maior pico e média dos cinco pregões anteriores, sem incluir hoje.
- Ler `b3_robot_daily_score.pico_margem_brl`, respeitando os filtros atuais: somar robôs dentro de cada dia e recorte; depois obter máximo e média entre dias. Ausência de medição aparece como “sem dados”, sem inventar pico zero.
- Preservar integralmente as consultas e contas atuais de resultado.

## Preço durante o pregão
- Linha recolhida por padrão dentro da testeira do ativo, com passo inicial de 30 minutos e opções 5, 10, 15, 30 e 60.
- Ler somente `b3_m1_candles_hist`, agregando na leitura; mostrar abertura, caminho, amplitude e eficiência direcional.
- Usar o mesmo cálculo puro de eficiência no gráfico e em `geometriaPA`, substituindo apenas a expressão equivalente no motor, sem mudar constantes, portões ou comportamento.
- Não interpolar ausências; dias sem registros mostram “sem dados”. Data selecionável nesse acompanhamento, independente dos resultados do cockpit.

## Detalhes técnicos e validação
- Leituras autenticadas, paginadas em blocos de até 1.000 quando necessário, sem escritas no banco ou chamadas externas.
- Testes do cálculo compartilhado e das agregações; conferência dos três controles e da apresentação em computador e celular.
- Registrar a separação estrutural em `AGENTS.md` e conferir a compilação automática.
- Não alterar resultados, freios, limiares, dimensionamento, autorizações ou demais subsistemas; **não publicar**.