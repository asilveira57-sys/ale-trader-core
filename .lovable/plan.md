# Cockpit em períodos: testeira, filtro Com/Sem freio e comparativo

Só apresentação. O motor, os freios, o espelho real e as autorizações não mudam.

## 1. Testeira também nos períodos (Ontem, 3, 7, 15, 30 dias, Entre datas)
- Os cartões do topo voltam a aparecer acima da lista, com os números somados no período escolhido.
- Os rótulos mudam conforme o período:
  - "Saldo do dia" vira "Saldo do período"
  - "Lucro bruto do dia" vira "Lucro bruto do período"
  - "Prejuízo bruto do dia" vira "Prejuízo bruto do período"
  - "Melhor robô do dia" e "Pior robô do dia" viram "Melhor robô do período" e "Pior robô do período"
  - Em "Ontem" os rótulos ficam "do dia", porque é um dia só.
- Cada cartão continua mostrando os dois valores, Com freio e Sem freio, um embaixo do outro.
- Fora de "Hoje", os cartões que só fazem sentido ao vivo somem: "Se fechasse agora", "Exposição atual", "Aberto positivo/negativo" e "Pico de exposição".

## 2. Seletor "Com freio / Sem freio" para a lista
- Um seletor com duas opções fica logo abaixo da barra de datas. "Com freio" vem marcado por padrão. Não existe opção "Todos".
- A lista do período (por pregão, por ativo, por modalidade e por robô) mostra só os números do lado escolhido: operações, ganhos, perdas e resultado.
- O lado escolhido aparece escrito no título, por exemplo: "Resultado de 27/09 a 03/10 — Com freio".

## 3. Comparativo Com freio x Sem freio
- Um bloco "Comparativo" fica abaixo da testeira, com uma linha por pregão e uma linha final com o total.
- Colunas: Com freio, Sem freio e Diferença, com verde ou vermelho conforme o sinal.
- Mais uma linha por ativo e por modalidade, nas mesmas três colunas, para ver onde o freio pesou.
- Sem porcentagem solta e sem as palavras proibidas ("custaria", "pouparia").

## Detalhes técnicos
- `getB3SimPeriodSummary` (b3-sim-period.functions.ts) passa a ler `freios_na_sombra` e a devolver cada agregado em pares `com_freio` / `sem_freio`, incluindo melhor e pior robô e lucro e prejuízo brutos. A regra é a mesma do dia: "com freio" conta só as ordens abertas com `freios_na_sombra` vazio.
- Em b3-cockpit.tsx, o painel da testeira recebe um `escopo` ("dia" ou "período") que troca os rótulos e esconde os cartões ao vivo. O seletor de lado é estado local, sempre "Com freio" ao abrir a tela.
- O Comparativo usa os mesmos pares e não faz consulta nova.

## Ordem de entrega, para caber nos 5 créditos do dia
1. Servidor com os pares no período, mais a testeira com os rótulos de período.
2. Seletor Com freio / Sem freio na lista.
3. Comparativo.

Se o crédito do dia acabar, paro ao fim da etapa em andamento e continuo amanhã, a partir da etapa seguinte.
