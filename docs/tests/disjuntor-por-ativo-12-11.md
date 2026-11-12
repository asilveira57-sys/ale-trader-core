# Conferência disjuntor por ativo — 12/11/2026

Pendências A1 a A5 (`claude/pendencias.md` do projeto Trade). Nenhum dado nem função do banco foi alterado; só registro, teste e apresentação.

## A1 — migration 0029 (commit `aa17f3f`)
`drizzle/migrations/0029_disjuntor_por_ativo_piso_pct.sql` + entrada `idx 29` em `meta/_journal.json`.
Corpo copiado com `pg_get_functiondef` e comparado byte a byte pelo md5:

| Função | md5 no banco | md5 do arquivo |
|---|---|---|
| `b3_disjuntor_simulado(uuid,date,numeric[],numeric,numeric,numeric,numeric,text[],text[],boolean,text[])` | `31e0ec7fd5fe0a977bad9de141500879` | igual |
| `b3_cockpit_disjuntor_niveis(uuid,date,date,text[],text[],text[])` | `cc0db799ccb38ab0ca5b53662faaa9ae` | igual |

Permissões da migration = `proacl` atual (`b3_disjuntor_simulado`: anon, authenticated, service_role; `b3_cockpit_disjuntor_niveis`: authenticated, service_role). A migration não foi aplicada: é `CREATE OR REPLACE` idêntico ao que está no banco.

## A2 — teste de integração (commit `d57e3b6`)
Valores de 10/11, com freio + disjuntor 25%, conferidos por SQL chamando `b3_disjuntor_simulado` por ativo e `b3_cockpit_disjuntor_niveis` com a identidade do dono (só leitura):

| Recorte | Total (cockpit) | Soma dos ativos | Esperado |
|---|---|---|---|
| WIN | 10.413,00 | 10.413,00 | 10.413 |
| WIN+WDO | −7.207,00 | −7.207,00 | −7.207 |
| WIN+WDO+BIT | −3.382,60 | −3.382,60 | −3.382,60 |
| sem filtro (12 ativos, 9 zerados) | −3.382,60 | −3.382,60 | −3.382,60 |

Por ativo: WIN +10.413 (devolução de pico 12:05 BRT) · WDO −17.620 (teto de perda 09:47) · BIT +3.824,40 (devolução de pico 13:32).
`disjuntor_atribuicao` do total = "soma dos disjuntores por ativo" e `por_ativo` com 1, 2, 3 e 12 ativos.
Modalidade+modo (WIN+WDO, `range`, `agressivo`): cada nível bate com a chamada direta (−530 em cada ativo e modalidade) e o total −1.060 = soma das chamadas por ativo.

`bunx vitest run src/lib/b3-disjuntor-scope.integration.test.ts`: sem `B3_RPC_TEST=1` e sem a sessão do dono o arquivo fica em skip (9 testes). Rodar na máquina do dono com `B3_RPC_TEST=1`.

## A3 — cockpit (commit `f2f25b5`)
`ThreeReadings.tsx`, `DisjuntorEvidence.tsx`, `DisjuntorHypothesis.tsx`, tipo em `b3-three-readings.ts`. Só apresentação dos campos do banco (`disjuntor_atribuicao`, `disparou`, `por_ativo`); nenhuma soma no TypeScript.
- `bunx tsc --noEmit -p .`: sem erro.
- `bunx vitest run` de `b3-three-readings`, `b3-disjuntor-view`, `b3-sim-disjuntor`: 16 passaram.
- Renderização no servidor com o formato real do total: "disjuntor: soma dos disjuntores por ativo", e a lista "BIT disparou: devolução de pico às 13:32 R$ 3.824,40 / WDO disparou: teto de perda às 09:47 −R$ 17.620,00 / ETR não disparou R$ 0,00".
- ESLint: só formatação (prettier) no estilo de linha única que esses arquivos já usavam e 2 avisos `react-refresh/only-export-components` do mesmo tipo do já existente.

## A4 — publicação
Lovable sincronizado em `f2f25b5`; `deploy_project` (deployment `e270ed82-3bd9-4b99-8766-4b748870bd8f`). Inclui o `a60df1d` de 11/11.

## A5 — registro
Marco 12/11 em `b3_marco_mudanca`; livreto 132 criado; livretos 124 e 86 atualizados citando o 132.

## Ficou em aberto
- `AGENTS.md` ainda diz que só dias podem ser somados no disjuntor; contradiz o total = soma dos ativos.
- `readDisjuntorScenarios` (selo do WIN) passa `p_piso_pico_brl` derivado do stop global do real: ali o piso não é o % do cenário.
- Conferência visual na tela publicada depende do login do dono.

## Segunda rodada (12/11, 09:51–10:00 BRT)

### A7 — piso do selo do WIN e /b3-sim-disjuntor (commit `824a40c`)
`readDisjuntorScenarios` passa `p_piso_pico_brl: null`: o banco aplica `peak_min_pct_of_global` × limite de perda do cenário, igual à grade. O total da tela `/b3-sim-disjuntor` (só WIN) passa a ser o WIN, não mais uma curva única com todos os ativos.
Medido por SQL, WIN, com freio, perda 25%, piso R$ 96 (antigo) contra % do cenário:

| Pregão | WIN ativo piso 96 | WIN ativo % cenário |
|---|---|---|
| 03/11 | −4.053 | −4.053 |
| 04/11 | −2.105 | −2.105 |
| 05/11 | +208 (devolução) | −975 |
| 06/11 | +859 (devolução) | −742 |
| 09/11 | −2.083 | −2.083 |
| 10/11 | +1.457 (devolução) | +10.413 (devolução 12:05) |
| 11/11 | −3.788 | −3.788 |
| soma | −9.505 | −3.333 |

Devolução de pico disparou 11 vezes em 21 cenários (WIN ativo, price_action, rompimento) com piso 96 e 3 com o % do cenário.
`bunx tsc --noEmit -p .` limpo; `b3-disjuntor-view` e `b3-sim-disjuntor`: 14 testes passaram.

### A6 — AGENTS.md (commit `cf66df3`)
Três regras reescritas: disjuntor por ativo, total = soma SQL dos ativos, modalidades não somam o ativo, piso sem override nas telas simuladas.

### A8 — tela publicada
Deploy `e5fb9240`. O navegador do app abriu `/b3-sim-disjuntor` e caiu em `/auth` (sem sessão). Conferência visual pendente do login do dono. Teste de integração com `B3_RPC_TEST=1` continua dependendo da sessão dele.
md5 das duas funções conferido de novo: igual à migration 0029.
