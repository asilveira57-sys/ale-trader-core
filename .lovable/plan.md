# Tirar o estado do motor da tabela de snapshots

Concordo com as três chaves e com o diagnóstico. Nenhuma delas é registro de mercado. Vou tirar as três — não discordo de nenhuma.

Há um ponto onde "o cockpit só mostra a última linha" não vale, e é a única decisão de projeto do pedido: as telas de **Diagnóstico do Motor** e **Funil** contam ao longo do tempo (ciclos, ticks válidos, sinais, comitê, categorias de bloqueio) percorrendo os últimos 400 snapshots e as últimas N horas. Se eu simplesmente mover tudo para uma linha corrente, esses contadores param de existir. Então a proposta tem duas partes.

## Parte 1 — estado corrente vai para tabela própria

Tabela nova `b3_engine_state`, **uma linha por (user_id, simulation_run_id)**, com `symbol` e `variant` para leitura direta, **atualizada** (upsert), nunca acrescentada:

- `engine_audit jsonb` — o objeto de auditoria do último tique (completo quando houve evento, enxuto quando não)
- `write_sigs jsonb` — as assinaturas de escrita, com o valor guardado como **hash curto** em vez do texto dos votos. A assinatura só serve para comparar igualdade; o texto dos votos já está inteiro em `b3_simulation_agent_votes`.
- `tick_guard jsonb` — a validação completa do tique, com rótulos e mensagens
- `counters jsonb` + `trade_date` — os acumuladores por robô do dia
- `updated_at`

Ela não cresce: 21 execuções ligadas = 21 linhas.

## Parte 2 — o que sobra no snapshot

`extra` fica com mercado e indicadores (os 883 bytes) mais **um resumo compacto por robô**, sem texto por extenso:

```
engine_digest: [{ m: "joao", k: "score", s: 41, c: 62, u: 2, b: 0, v: 0 }, ...]
```

`m` robô, `k` chave da etapa que barrou, `s` score, `c` confiança, `u` código do setup, `b`/`v` sinais. Cerca de 30 bytes por robô — **~240 bytes com 8 robôs**. Mais `guard_ok` e a chave do primeiro bloqueio do guarda (~40 bytes).

É isso que sustenta os contadores das telas de diagnóstico com a mesma janela de hoje, sem gravar nenhuma frase repetida.

## O número

| | Hoje | Depois |
|---|---:|---:|
| Bytes por linha | 13.943 | **~1.170** |
| Escrita por dia | ~260 MB | **~22 MB** |

**~92% menos escrita.** Fico ~290 bytes acima do seu alvo de 883, e é de propósito: é o preço de manter os contadores das duas telas de diagnóstico funcionando na mesma janela. Se preferir aceitar contadores só do dia corrente (lidos da linha de estado), corto o digest e chego nos 883.

## O que muda em cada leitor

| Leitor | Hoje | Depois |
|---|---|---|
| Diagnóstico do Motor (auditoria do último tique) | `extra.engine_audit` do último snapshot | `b3_engine_state.engine_audit` |
| Cockpit ("Setup técnico", "Horário permitido") | projeção JSON do último snapshot | `b3_engine_state.engine_audit.modes` |
| Pipeline (contadores por robô) | 400 snapshots | `engine_digest` dos mesmos 400 snapshots |
| Pipeline (histórico dos bloqueios com texto) | frases repetidas no snapshot | `b3_entry_decision_log`, que já grava motivo e detalhe a cada mudança |
| Funil por horas | 1.200 snapshots | `engine_digest` dos mesmos 1.200 |
| Painel de comparação e PDF de diagnóstico | `engine_audit` do snapshot | `b3_engine_state` |

## Fora de escopo, explicitamente

Não toco em: decisão de entrada, parâmetros dos modos, guardião de saída, disjuntor diário, ponte MT5, endpoint de ingestão. O tique continua persistindo no máximo 1 snapshot a cada 10 s.

## Passos

1. Migração: cria `b3_engine_state` com RLS e GRANTs, chave única (user_id, simulation_run_id).
2. Motor: monta o estado, faz upsert junto da persistência do snapshot, escreve `engine_digest` no `extra` e para de escrever as três chaves.
3. Recuperação da memória do isolate passa a ler `write_sigs` de `b3_engine_state` (hoje lê do último snapshot).
4. Adapta os seis leitores da tabela acima.
5. Verificação: typecheck, teste manual do tique, e conferência no banco de que o `extra` novo pesa o previsto e que as telas mostram o mesmo conteúdo.
6. Limpeza opcional, só com sua ordem: remover as três chaves das linhas antigas e rodar `VACUUM FULL`. Isso é o que libera os 698 MB de fato — sem isso a economia é só do que vier a partir de agora.
