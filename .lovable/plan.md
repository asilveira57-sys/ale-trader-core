# Reduzir o volume guardado, não a taxa de escrita

Mercado fechado agora — janela correta. Nada será publicado com o pregão aberto.

## Antes de mais nada: a correção nº 5 de ontem entrou

`invalidateLegacyOrdersForMt5` **não** relê mais as ordens da execução inteira: a consulta hoje é filtrada no banco (índice parcial de ordens legadas), com teto de 500 linhas, e o recálculo de totais só acontece quando alguma ordem mudou. Aquele custo de ~880 s de CPU por dia saiu. Confirmado no código, sem alteração necessária.

## 1. Votos individuais só nas entradas aprovadas

Hoje, cada mudança de veredito do comitê grava 8 linhas — aprovada ou recusada. Passa a ser:

- **Aprovada** → uma linha por agente, exatamente como hoje (nome, voto, confiança, motivo, veto, ligação com a ordem). Ranking, reputação e peso dinâmico continuam lendo o mesmo dado.
- **Recusada / bloqueada** → **uma única linha de agregado**, usando as colunas que já existem: `agent_name = '__agregado'`, `vote` = veredito, `confidence` = confiança média, `score`, `side`, `reason` = justificativa do comitê, e no `market_data_snapshot` um objeto minúsculo `{ a_favor, contra, manter, aguardar, agentes }`.

Sem migração para essa parte — a tabela já tem todas as colunas.

Comentário no módulo registrando a ressalva: isso cria **viés de amostragem**. Um agente que discorda muito aparecerá menos, porque a discordância dele termina em recusa. O sistema hoje não mede "quem discorda bem"; quem for medir depois precisa saber que a amostra é só das aprovadas.

### Leitores ajustados para não mudar nenhum número

| Leitor | Hoje | Depois |
|---|---|---|
| Relatório por robô (aprovações/recusas/bloqueios do comitê) | conta linhas e divide por 8 | soma: linhas de agregado contam 1; linhas por agente seguem divididas por 8 |
| "Últimos votos" no painel ao vivo | 30 últimas linhas | mesma consulta, ignorando as linhas de agregado (não são voto de agente) |
| Votos de uma ordem | inalterado (ordem = entrada aprovada) | inalterado |

Efeito esperado: das ~16.800 avaliações diárias, 97% são recusas. As 216 mil linhas/dia caem para a ordem de **~20 mil**.

## 2. Agregar o diagnóstico antes de apagar

**Tabela nova `b3_entry_decision_resumo_dia`** — uma linha por dia × `(symbol, mode, entry_style, estagio, motivo)` com a contagem de ocorrências e o score/confiança médios. Minúscula, guardada por muito tempo (a retenção não a toca).

**Função `b3_agregar_entry_decision_dia(p_date)`** — lê o detalhe do dia e faz upsert do resumo; idempotente, pode rodar quantas vezes quiser.

**`b3_retencao_diaria` passa a agregar antes de apagar**: no início, agrega os últimos 10 dias de `b3_entry_decision_log`; só depois apaga o detalhe. Janelas novas:

| Tabela | Hoje | Depois |
|---|---:|---:|
| `b3_entry_decision_log` | 4 dias | **2 dias (48 h)** |
| `b3_simulation_market_snapshots` | 3 dias | **2 dias** |

O resumo diário sustenta a leitura de tendência por meses; o detalhe deixa de ser pago.

## O que não muda

Decisão de entrada (classificador, comitê, score, confiança), freios, modo sombra de hoje, espelho, executor, livro, e nenhum número do cockpit. Nada do que já está gravado é apagado por esta mudança — a regra nova vale daqui para frente e o histórico sai pela retenção normal.

## Passos

1. Migração: `b3_entry_decision_resumo_dia` (RLS + GRANTs), `b3_agregar_entry_decision_dia`, `b3_retencao_diaria` atualizada.
2. Motor: gravação de votos condicional ao veredito, com o comentário da ressalva.
3. Relatório e painel ao vivo adaptados às linhas de agregado.
4. Verificação de tipos e testes; conferência no banco de que o resumo é preenchido para hoje.
