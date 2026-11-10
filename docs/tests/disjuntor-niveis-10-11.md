# Conferência de leitura — disjuntor simulado, 10/11/2026

## Causa e alcance
- `drizzle/migrations/0017_cockpit_corte_disjuntor_consistente.sql`, função `b3_cockpit_tres_leituras`: CTE `scenarios` executava somente modalidade; `rows` e `daily` somavam essas modalidades para ativo e TOTAL.
- Consumidores: `/b3-cockpit`, resultado superior, testeiras de ativos e tabela de pregões através de `readThreeReadings` e `ThreeReadings`/`ThreePeriodRows`.
- `src/lib/b3-disjuntor-view.ts`, `disjuntorTotals`: somava linhas de modalidades. Consumidor `/b3-sim-disjuntor`, função `Page`, incluindo cópia e período.
- `src/components/b3/DisjuntorHypothesis.tsx`, `DisjuntorHypothesis`: mesmo helper para selo agregado. Componente importado no cockpit, sem montagem atual localizada. Corrigido preventivamente.
- Nenhum outro consumidor com essa soma localizado na busca do código-fonte. A RPC antiga continua intacta; a nova leitura mantém suas métricas não financeiras do disjuntor e substitui somente os agregados de disjuntor. Robôs mantêm parcelas atribuídas ao cenário de sua modalidade, identificadas como parcelas; não representam disjuntores individuais.

## Contrato
- Modalidade: `p_symbols=[ativo]`, `p_variants=[modalidade]`.
- Ativo: `p_symbols=[ativo]`, `p_variants=NULL`.
- TOTAL global: `p_symbols=NULL`, `p_variants=NULL`, mesmo com filtros de apresentação. Nunca fingir que TOTAL global é WIN.
- Selecionar somente WIN mostra o readout do ativo WIN no topo e na tabela de pregões, inclusive cópias.
- Só dias são somados, com cenários distintos por limiar. Helper recusa duplicidade de dia/limiar TOTAL.
- Leitura cockpit mantém defaults da chamada antiga; simulação conserva o piso percentual do stop global que já usava. Esses pisos diferentes são exibidos, não foram modificados para forçar coincidência de modalidades.

## Verificação autenticada, sem escrita operacional
- Banco e UI: WIN 10/11, 25%, ganho 80%: resultado com disjuntor **R$1.457**, devolução de pico **10:30**.
- Primeira leitura: sem disjuntor **R$9.658**, **136** evitadas de **184** ordens. Última leitura: novas ordens durante o pregão levaram o sem disjuntor para **R$9.105**, **137** evitadas de **185**; corte continuou R$1.457.
- TOTAL todos os ativos: **−R$16** com os defaults da função, contra **−R$7.360** no adaptador antigo. Há ordens de outros ativos: TOTAL global não é WIN.
- Cada linha agregada da nova RPC foi comparada a uma chamada direta com seus filtros próprios. Todos os campos antigos exceto `com_freio_disjuntor` e `disparos` comparados e preservados.
- 22/10, 23/10, 30/10, 03/11, 04/11 e 09/11: chamada WIN não dispara, dois resultados idênticos, diferença zero.
- UI: sessão do dono, cópia inteira, detalhes do topo, WIN selecionado, dez pregões e TOTAL, celular 390×844 sem overflow externo; zero erros de página.
- 16 testes locais: `b3-disjuntor-view.test.ts`, `b3-three-readings.test.ts`, `b3-session-window.test.ts`.
- Hashes das funções antes/depois iguais: `b3_disjuntor_simulado` = `2b4f65a4ed1e5aee095b8b1b208e653f`; `b3_disjuntor_capacidade` = `5a3002a76f10e88275a3558db41e1751`.
- Motor, freios, carteira, portão de setup, conta real e funções reais não editados. Nenhum comando de operação executado. Não publicado.