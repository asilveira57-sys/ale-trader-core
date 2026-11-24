# Histórico permanente da confirmação de entrada — 24/11/2026

Pedido do dono: guardar o detalhe de cada sinal que esperou confirmação, para todos os robôs, e medir outro percentual (15%, 20%) e outra janela (100 s) com amostra de semanas. Livreto 152.

## O que mudou
- **Banco (migration 0052, aplicada direto no banco em 24/11):** tabela `b3_confirmacao_hist` (sem retenção) + gatilho `b3_confirmacao_hist_trg` em `b3_entry_decision_log` que copia os estágios `confirmacao_atingida`, `confirmacao_nao_atingida` e `confirmacao_atingida_sem_entrada`. Erro no gatilho nunca derruba o log do motor. Carga inicial: 1.813 linhas (WIN 702, WDO 461, BIT 650) de 23–24/11.
- **Motor (só medição):** `atualizarDegraus` em `b3-confirmacao-entrada.ts` carimba quando o melhor avanço dentro da janela cruzou 5, 10, 15, 20, 25, 30, 40 e 50% do stop. `avaliarPendente` devolve `degraus`; a pré-passada grava no pendente; o log de descarte e de confirmação passa a levar `degraus`, `stop_pts`, `gain_pts`, `sinal_em` (e `janela_s` na confirmação). Limiar, janela e decisões não mudaram.

## Conferência
- `bunx vitest run src/lib` → 30 arquivos, 193 testes passando (3 testes novos de degraus).
- `bunx tsc --noEmit` → sem erros.
- Gatilho testado com inserção desfeita: linha copiada com os degraus.

## Como usar
```sql
SELECT entry_style, estagio, count(*),
  count(*) FILTER (WHERE degraus ? '15') chegou_15,
  count(*) FILTER (WHERE (degraus->>'15')::timestamptz - sinal_em <= interval '100 s') chegou_15_em_100s
FROM b3_confirmacao_hist WHERE symbol LIKE 'WIN%' AND trade_date >= '2026-11-25' GROUP BY 1,2;
```
Precisão dos degraus = intervalo entre passadas do tique.
