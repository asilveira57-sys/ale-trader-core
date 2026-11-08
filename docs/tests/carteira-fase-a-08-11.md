# Conferência carteira fase A — 08/11/2026

## Dados e execução
WIN · Faixa (`range`): Enoir (`enoir`) R$487/2 contratos; Alexandre (`agressivo`) R$197/0; modalidade R$1.722/2. Margem da função existente: máximo por raiz de `b3_asset_profiles`, R$155; reserva R$201,50; máximo doável R$285,50.

Os testes de escrita foram executados via Lovable Cloud em blocos `BEGIN; DO ...; ROLLBACK;` com identidade do dono. Os blocos lançam exceção em qualquer divergência. Ambos concluíram sem exceção, e a leitura posterior confirmou saldos originais e zero transferências persistidas.

- R$300: recusado, máximo R$285,50.
- R$285: aceito; doador R$202/1, destino R$482/2; capital R$1.722 e contratos 3. Registro antes/depois confirmado na transação revertida.
- R$285,50: prévia mantém R$201,50/1 no doador.
- Lucro próprio inalterado; líquido recebido -285/+285; invariante conferida nos dois.
- Motivo vazio e destino `_sc` fora da modalidade: recusados.
- Snapshot divergente: recusado.
- Quatro argumentos na função de aplicação: continua contabilizando resultado, não transferência.
- Cenário de queda de contratos com saldo de teste R$403 no doador (alteração revertida): R$1 transferido reduz 2→1 e retorna aviso verdadeiro. Prévia não cria registro.
- `b3_carteira_trg_ordem` relido byte a byte, sem alteração em relação à definição inicial.

## Testes e tela
`bunx vitest run src/lib/b3-wallet-transfer.test.ts src/lib/b3-wallet-transfer.integration.test.ts src/lib/b3-wallet-view.test.ts`: 7 passaram; 7 testes de escrita ficam explicitamente suspensos na conexão `sandbox_exec`, sem ampliar seus privilégios. As mesmas regras foram executadas nos blocos revertidos acima. A suíte de escrita exige conexão privilegiada explícita e sempre desfaz suas alterações.

Navegador autenticado: lista dos 8 robôs; origem só Enoir; rejeição de R$300 com máximo; prévia R$285 com todos os valores exigidos; cancelamento sem escrita. Celular 390px sem overflow. Aplicação compilou sem erro. Motor, disjuntor, conta real e gatilho não alterados.

## Compatibilidade PostgreSQL
Duas sobrecargas com quinto argumento padrão geram ambiguidade nas chamadas de quatro argumentos. A assinatura antiga foi substituída pela única assinatura de cinco argumentos com padrão `resultado`, mantendo o corpo do gatilho e sua chamada de quatro argumentos intactos. Compatibilidade confirmada dentro da transação revertida.