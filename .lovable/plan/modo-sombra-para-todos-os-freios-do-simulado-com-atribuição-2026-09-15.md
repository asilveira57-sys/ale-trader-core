# Modo sombra para todos os freios do simulado, com atribuição por freio

Hoje só o freio de grupo está em sombra. Os outros três (pico, pós-meta e stop diário
por robô) continuam travando o simulado — e por isso não sabemos se travar acertou.
A entrega estende a sombra a eles e passa a registrar **qual** freio teria barrado cada
entrada, para que a medição diária mostre poupança e custo separados por freio.

No real nada muda: todos os freios continuam bloqueando dinheiro de verdade.

## 1. Banco (uma migração)

- `b3_simulation_orders`: nova coluna `freios_na_sombra text[]` (padrão `{}`), com os
  freios que teriam barrado aquela entrada: `grupo`, `pico`, `pos_meta`, `stop_diario`.
  `bloqueado_na_sombra` fica como está e passa a ser verdadeiro quando o vetor não está
  vazio (mesmo valor que hoje quando só o grupo age).
- `b3_grupo_sombra_dia`: nova coluna `sombra_por_freio jsonb` (padrão `{}`), com um bloco
  por freio: resultado sombra, entradas na sombra e diferença contra o livre.
- Índice parcial em `freios_na_sombra` não é necessário — a consolidação já filtra por
  dia/execução.
- Nada de recalcular histórico: as colunas nascem vazias e valem daqui para frente.

## 2. Motor do simulado (`src/lib/b3-simulation.functions.ts`)

- Um único vetor `freiosSombra` por robô/tique, montado a partir do que já é decidido
  neste tique: grupo (regra atual, inalterada) e o estado da proteção diária
  (`blocked_peak_giveback` → `pico`, `blocked_post_target_loss` → `pos_meta`,
  `blocked_stop` → `stop_diario`).
- Quando o bloqueio da proteção é um desses três, a entrada **sai** no simulado em vez de
  ser descartada: registro de status próprio (`sombra_pico`, `sombra_pos_meta`,
  `sombra_stop_diario`), linha no log de decisão e ordem marcada com o freio no vetor.
  Os demais bloqueios da proteção (falha operacional, volatilidade extrema, drawdown)
  **continuam bloqueando** — não são freios de resultado e não fazem parte do pedido.
- Tamanho da entrada em sombra sai no tamanho do robô (o multiplicador zerado da proteção
  não é aplicado), do mesmo jeito que já vale para o freio de grupo — senão livre e sombra
  não são comparáveis.
- Posição aberta: o freio de pico deixa de encerrar a posição simulada, pela mesma razão
  documentada em 09/09 para o grupo (fechar no pior instante enviesa a sombra a favor do
  freio). No real o fechamento continua sendo enfileirado uma vez por posição, com chave
  idempotente `close-pico-<id>`, auditoria em `b3_simulation_block_events` e
  `system_logs`. Stop/alvo/trailing/zeragem seguem ativos.
- Espelho real: a recusa de abertura passa a valer para qualquer freio em sombra, com o
  motivo do freio no registro `b3_espelho_nao_abriu` já existente.

## 3. Consolidação (`src/lib/b3-grupo-sombra.server.ts`)

- Passa a ler `freios_na_sombra` junto de `bloqueado_na_sombra`.
- Além de livre e sombra agregada, calcula o sombra **por freio**: o resultado que
  existiria se só aquele freio estivesse ativo (soma das ordens sem aquele freio no vetor).
- Grava tudo na mesma linha por robô e na linha do grupo, mantendo a regra de custo: no
  máximo uma gravação por minuto por grupo, `force` na zeragem, e nada é gravado quando a
  medição não mudou.

## 4. Tela e cópia

- `sombraLinhas` ganha uma companheira que formata a linha de um freio ("pouparia",
  "custaria", "não agiu hoje") com o nome em português: Freio de pico, Pós-meta,
  Stop diário, Freio de grupo.
- Card do robô no Cockpit: abaixo de "Operou" e "Com freio", uma linha por freio que
  **efetivamente agiu** na sombra. Freio que não agiu é omitido, para o card não crescer.
- Testeira do grupo: mesma informação em uma linha compacta.
- `src/lib/b3-cockpit-copy.ts`: o texto copiado passa a conter as linhas novas, na mesma
  ordem do card.

## O que não muda

Decisão de entrada (classificador, comitê, score, confiança); comportamento de qualquer
freio no real; freio de grupo no simulado; espelho, executor e livro (inclusive as
correções de hedge de 14/09); otimizações de banco de ontem; nenhum recálculo de histórico.
