# Disjuntor simulado — filtros de recorte (11/11/2026)

Migration: `0028_disjuntor_recorte_symbols_variants_modes.sql`.

## Critérios executados com sessão autenticada do dono

Dia: 2026-11-10. RPC: `b3_cockpit_disjuntor_niveis`.

| p_symbols | Nível conferido | com_freio_disjuntor |
|---|---|---:|
| WIN | ativo WIN | 1457 |
| WIN, WDO | total | -10829 |
| WIN, WDO, BIT | total | -16 |
| NULL | total | -16 |

WIN+WDO: `não disparou` confirmado.

20 testes passaram, incluindo 6 regressões autenticadas somente leitura:
`B3_RPC_TEST=1 bunx vitest run src/lib/b3-disjuntor-scope.integration.test.ts src/lib/b3-disjuntor-view.test.ts src/lib/b3-sim-disjuntor.test.ts`.

O teste adicional WIN+WDO/range/agressivo verifica cada nível contra chamada direta do cenário e sua base contra a capacidade SQL filtrada. Sem freio/com freio conferidos idênticos à função original para o mesmo recorte.

## Escopo e compatibilidade

- Total mantém p_symbols/p_variants selecionados; ativo mantém p_variants; modalidade usa seu próprio ativo/variant. Todos recebem p_modes.
- Capacidade filtra s.mode; curva filtra o.mode, como as três leituras.
- Uma assinatura por função, com p_modes DEFAULT NULL ao final; chamadas antigas continuam válidas por argumento padrão.
- Chamadores SQL ativos: capacidade na função diária, cenários nas três leituras, adaptador de níveis. Atualizados pela migration, sem editar migrations antigas.
- Chamadores TS: `b3-disjuntor-read.functions.ts` explicita p_modes=NULL (essa tela não tem filtro de modo), e preserva p_variants no total/ativo. `readThreeReadings` já enviava os três filtros ao adaptador.
- Nenhum layout, percentual, gatilho, regra financeira, motor, freio, carteira, autorização real ou ordem foi alterado. Não publicado.
- A migration preserva grants anon/authenticated/service_role; não concede acesso adicional a roles gerenciados do sandbox nem a PUBLIC.