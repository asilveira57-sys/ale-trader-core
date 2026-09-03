# Item 2 — saídas de stop tardias: diagnóstico antes de qualquer código

## Conclusão que contradiz o pedido (topo, como você pediu)

**"Avaliar o stop no tique" não resolve o problema, porque o motor já avalia no tique.** O laço de saída em `src/lib/b3-simulation.functions.ts` (linhas 3174-3218) inclui o candle do minuto **corrente** na verificação de toque — só o *marcador* `last_eval_minute_ts` ignora o minuto incompleto. E os candles M1 são montados pela função `b3_m1_candles` diretamente do fluxo bruto de tiques (`b3_mt5sim_quotes`), não de um provedor de candles fechados. Ou seja: a máxima/mínima do minuto em curso já entra na decisão, com resolução de ~1 s.

O que atrasa a saída não é a granularidade do dado — é **quantas vezes por pregão o motor olha a posição** e **em qual preço ele executa**. Ganhar diagnóstico por tique sem mudar isso não devolve nenhum dos R$ 1.460,09.

## 1. Frequência real de avaliação de posições abertas

- Não existe caminho próprio para posições abertas. A gestão da posição roda **dentro do mesmo laço do tique de entrada**: `runB3SimulationTick` (chamado por `src/routes/api/public/hooks/b3-simulation-tick.ts`) percorre execuções, e para cada modo avalia primeiro a posição aberta e só depois procura entrada. Herda a cadência do tique, sem exceção.
- O disparo é `public.b3_disparar_tique()` no pg_cron, que faz `net.http_post` no hook. O comentário dentro da função diz que o agendamento passou a ser "18 seconds" em 01/09. **Não consegui ler `cron.job`** (permissão negada no schema `cron`), então não posso confirmar o agendamento pelo banco.
- **Reconciliação com a sua medição:** os dados de 02/09 concordam com **você**, não com o comentário. O atraso máximo entre o primeiro tique que cruzou o stop e o fechamento efetivo foi de **45,6 s** no BITU26, com média de 25,0 s — exatamente o formato de uma cadência de ~45 s (atraso médio ≈ metade do período). Se o período fosse 18 s, o teto observado seria ~18 s. Trato **45 s** como a frequência real; o comentário no código está desatualizado e será corrigido junto com a implementação.
- Somam-se ao período: ~5 s de processamento das 37 execuções e o intervalo do fluxo de tiques (maior gap medido dentro das ordens ruins: 1,8 s no WIN, 4,3 s no BIT, 5,6 s no WDO — o conector não é o gargalo).

## 2. As saídas tardias são explicadas pela latência? Sim — e dá para separar

Os tiques brutos de 02/09 estão no banco, então a separação é **medida**, não estimada. Para cada ordem com excesso, comparei o fator de perda **no primeiro tique que cruzou o stop** com o fator **no preço efetivamente executado**:

| Ativo | Ordens | Fator no cruzamento | Fator na saída | Maior gap de tique |
|---|---|---|---|---|
| BITU26 | 20 | 1,05× | 1,29× | 5,3 s |
| WDOV26 | 9 | 1,03× | 1,29× | 5,6 s |
| WINV26 | 4 | 1,08× | 1,66× | 2,9 s |

Leitura: no instante em que o mercado tocou o stop, a perda era de 3% a 8% acima do contratado — dentro do esperado para tique discreto. Todo o resto do excesso apareceu **entre o toque e a execução**.

Repartição do excesso de R$ 1.460,09: **movimento genuíno até o toque ≈ 10% a 17% (~R$ 200)**; **latência de avaliação/execução ≈ 83% a 90% (~R$ 1.260)**. Isso responde também ao padrão que mais te incrimina: todos os modos do mesmo ativo saem no mesmo minuto e no mesmo preço porque a saída é executada no **Bid/Ask corrente do tique em que o motor acordou** — quando ele acorda, todos os stops (863 a 1.036 pts) já foram atravessados pelo mesmo movimento, e todos recebem o mesmo preço. Não é coincidência: é assinatura de latência.

Dois casos de WDO fogem do padrão (atraso de 422 s). Esses não são explicados por cadência de 45 s e serão investigados à parte — suspeita: a execução ficou sem avaliação por bloqueio de frescor de cotação (`price_source_guard`) ou por erro de modo, não por latência de cron.

## 3. Opções para reduzir a latência, com custo

**A. Aumentar a frequência do cron atual (45 s → 10-15 s).** Reduz o atraso médio proporcionalmente (25 s → ~6 s). Custo: multiplica por 3-4,5 **todo** o tique — classificadores, leitura de indicadores, snapshots, 37 execuções × 8 modos. É exatamente a carga que derrubou a aplicação por 46 minutos em 02/09. **Não recomendo, e é decisão sua — está na seção de perguntas.**

**B. Caminho separado só para posições abertas (recomendado).** Um segundo hook (`.../hooks/b3-posicoes-abertas`) que faz apenas: ler ordens `status='open'`, ler o último tique de cada símbolo envolvido, verificar stop / alvo / trailing / breakeven, fechar quem cruzou. Sem classificadores, sem comitê, sem snapshot, sem busca de entrada. Custo por passada: ~1 leitura de ordens abertas + 1 leitura de cotação por símbolo (7 a 11 símbolos, já com cache) + escrita **só** quando fecha — ordem de grandeza inferior ao tique completo, que hoje gasta 5 s. O tique de entradas permanece em 45 s, intocado. Ainda assim, rodar esse caminho a cada 10 s é aumento de frequência de *algo* — logo, também depende do seu aval.

**C. Stream de tiques (avaliação no próprio ingest).** Avaliar a posição dentro de `b3-mt5sim-tick-ingest`, a cada tique recebido (~1 s). Latência quase zero. Custo: coloca trabalho de decisão no caminho crítico da ingestão — se a avaliação demorar ou falhar, você perde tique **e** perde a gestão de risco; e viola sua restrição original de não alterar a lógica de recebimento de tique. Descartada.

## 4. Preço de preenchimento e onde cada opção encosta na auditoria

Situação atual da auditoria (`b3_enforce_mt5_execution_audit`, lida no banco agora): o preço executado precisa ficar a **até meio tique** do Bid ou do Ask **gravados na própria linha da ordem**, e a até `price_deviation_limit` (2000) do `quote_last` gravado. A trigger **não** compara `quote_tick_ts` com `now()` — quem exige cotação fresca é a aplicação, em `assertFreshMt5Quote`.

- **A e B (aumentar frequência):** o preenchimento continua sendo o Bid/Ask corrente e fresco. **Nada na auditoria precisa mudar.** O ganho vem de acordar mais perto do toque, então o "corrente" já é um preço melhor.
- **Preencher no preço do tique de cruzamento** (a tentação óbvia): passaria pela trigger, desde que gravássemos o Bid/Ask **daquele** tique na linha. O que ela viola é o guarda de frescor da aplicação — e, mais importante, a honestidade do número: aquele preço já não estava disponível quando a ordem fechou. Isso maquiaria o prejuízo em vez de reduzi-lo. **Só esta opção exigiria afrouxar a auditoria, e a decisão é sua, não minha.**
- **C:** preencheria no tique corrente, sem tocar na auditoria — mas foi descartada pelo risco na ingestão.

## 5. Recomendação, com todas as letras

**Detecção por tique, sozinha, não vale o trabalho** — ela já existe. O que resolve é reduzir o intervalo entre avaliações da posição aberta, e a forma barata de fazer isso é a opção **B**: tirar a gestão de posição do tique pesado e dar a ela um caminho enxuto e mais frequente. Sem alguma redução de intervalo, qualquer trabalho no item 2 melhora relatório e não melhora resultado.

## Perguntas que preciso que você decida antes de eu escrever código

1. Autoriza o caminho separado da opção B, com cadência própria de **10 s** (tique de entradas permanece 45 s)? Se preferir 15 s ou 20 s, diga o número.
2. Preenchimento: manter **sempre** no Bid/Ask corrente fresco (auditoria intacta), correto? Confirmando isso, não encosto na auditoria.
3. Quer que eu inclua no mesmo trabalho a investigação dos 2 casos de WDO com 422 s de atraso, ou deixo para depois dos itens 3-5?

## Detalhes técnicos (referência)

- Gestão de posição: `src/lib/b3-simulation.functions.ts` — laço de saída em 3148-3420; toque intra-candle em 3174-3218; execução no `markAudit` em 3350-3364.
- Candles: RPC `b3_m1_candles`, agregando `b3_mt5sim_quotes` por minuto (não é feed externo).
- Disparo: `public.b3_disparar_tique()` → `POST /api/public/hooks/b3-simulation-tick`; guarda de horário 08:55-18:35 BRT, dias úteis; concorrência 12 no hook.
- Implementação prevista para B: extrair a avaliação de saída para um módulo compartilhado, reusado pelo tique completo e pelo hook novo, para não existirem duas lógicas de stop.

---

# Item 1 — riscos documentados da nova trigger (registro, sem reverter)

**Risco 1 — tolerância de meio tique.** Antes: `execution_price` tinha de ser **exatamente** igual ao Bid ou ao Ask arredondado. Agora: aceita qualquer preço a até `tick/2` de um dos dois. O que passa hoje e não passava antes: um preço **fora da grade do instrumento** — por exemplo, no ITUB4 (tick 0,01) com Bid 41,23, um `41.234` ou `41.226` é aceito; no ETRU26 (tick 0,1) com Bid 2421,7, aceita de 2421,65 a 2421,75. A janela também **une** Bid e Ask quando o spread é de um único tique: com Bid 22,32 e Ask 22,33 (tick 0,01), qualquer valor entre 22,325 e o Ask passa. Em dinheiro o desvio máximo tolerado é meio tique por operação (R$ 0,10 no WIN, R$ 5,00 no ETR por contrato) — pequeno, mas não é mais uma prova de que o preço saiu do book. A tolerância protege contra resíduo IEEE-754; ela **não** distingue resíduo de erro de cálculo da aplicação. Mitigação em vigor: a normalização ao tique é feita na aplicação (`roundToTick`) antes de persistir, então na prática nenhum preço deveria depender da tolerância.

**Risco 2 — símbolo não cadastrado e ativo em `b3_asset_profiles` derruba a ordem.** A trigger levanta exceção dura (`Simbolo % nao e ativo cadastrado em b3_asset_profiles`) quando não encontra linha com `active = true` para o `quote_symbol`. Consequência na rolagem mensal de contrato: se o motor começar a usar o código novo (ex.: WINZ26) antes de ele existir e estar ativo em `b3_asset_profiles`, **toda** operação daquele ativo falha na escrita — abertura **e fechamento**. O caso grave é o fechamento: uma posição aberta com o código antigo, cujo perfil seja desativado durante a rolagem, deixa de poder ser encerrada pelo motor, ficando aberta com risco vivo enquanto o erro se repete a cada tique. Regra de operação a partir daqui: **cadastrar e ativar o código novo em `b3_asset_profiles` antes de criar a execução com ele, e nunca desativar o perfil de um código que ainda tenha ordem aberta.**
