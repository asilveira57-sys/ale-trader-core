# Faixa: chegada forte à borda — 24/11/2026

Pedido do dono: confirmação de lateralidade para a faixa, valendo de 25/11. Livreto 155.

## Estudo (WIN, range_fade, 20/10–24/11, por 1 contrato, velas de 1 min)
- Sem filtro: 881 entradas, −5.879. Alvo de 1 stop antes do stop em 49% (nas duas metades): a entrada não tem vantagem.
- Tendência do dia, de 120 min e eficiência do dia: nenhum corte positivo nas duas metades.
- Chegada à borda (eficiência dos últimos 60 min contra a operação): lateral e moderada negativas nas duas metades; forte positiva nas duas.
  Limiar 0,4: +401 (A +567, B −166) · **0,5: 395 entradas, +1.377 (A +1.037, B +340)** · 0,6: +1.111 (A +936, B +175).
- Recente (10–24/11, entradas válidas): +94 → +1.171 com o filtro; 24/11: −416 → +86.
- Sem a confirmação de preço (23–24/11, todos os sinais): −2.251 contra −1.170 com confirmação. Confirmação mantida.

## Implementação
- `src/lib/b3-faixa-exaustao.ts` (`eficienciaContraOperacao`, só velas fechadas, mínimo 5) e bloqueio duro em `classifySetupRange` quando `range_exaustao_min` está preenchido.
- Migration 0055: colunas `range_exaustao_min` e `range_exaustao_janela_min`; WIN faixa 8 robôs = 0,5 / 60 min.

## Conferência
- `bunx vitest run src/lib` → 198 testes passando (5 novos).
- `bunx tsc --noEmit` → sem erros.
