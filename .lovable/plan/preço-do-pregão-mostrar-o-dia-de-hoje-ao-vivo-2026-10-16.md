# Preço do pregão: mostrar o dia de hoje ao vivo

## O que foi verificado
- O quadro "Preço do pregão" (passo de 5 a 60 min, abertura, amplitude, eficiência) **já existe** na testeira de cada ativo. Ele foi entregue no pedido da testeira de 14/10, não é a "Fase 2" do pedido de 15/10 (a Fase 2 de 15/10 é a tela de simulação de disjuntor, ainda não começada).
- Hoje (16/10) ele mostra "sem dados" porque lê só o histórico de velas de 1 minuto, que é gravado **uma vez por dia, depois do fechamento**. No banco existem velas até 15/10 (cerca de 430 a 510 por ativo); 16/10 ainda não existe. Escolhendo 15/10 ou 14/10 no campo de data, o quadro deve aparecer.
- Os dias 10 a 13/10 continuam sem dados (buraco conhecido, não volta).

## O que falta fazer
1. Para a data de hoje, ler as velas de 1 minuto do pregão em andamento a partir dos preços ao vivo que o sistema já recebe (leitura existente `b3_m1_candles`), em vez do histórico.
2. Para datas passadas, continuar lendo o histórico como está.
3. Mostrar ao lado do quadro de onde veio o dado: "ao vivo" ou "histórico".
4. Manter "sem dados" quando não houver velas, sem interpolar.

## O que não muda
Só leitura e apresentação. Nada no motor, nos freios, nos limites, no disjuntor ou nos resultados. Nada é gravado.

## Detalhes técnicos
- `getCockpitPricePath` (src/lib/b3-cockpit-measurements.functions.ts): quando `date` = hoje BRT, chamar `rpc("b3_m1_candles", { p_user_id, p_symbol, p_limit })` com o contrato vivo da raiz, filtrar à janela BRT do dia, mapear para `HistoryCandle` e passar pelo mesmo `candlePath` (mesma fórmula de eficiência compartilhada com o motor). Devolver `source: "live" | "hist"`.
- `AssetPricePath.tsx`: exibir o rótulo da fonte; o refetch de 60 s em "hoje" já existe.
- Teste: `candlePath` com velas ao vivo e com lista vazia ("sem dados").
- Não publicar durante o pregão.
