# Apuração real — 10/11/2026

## Contrato que falta no executor

O endpoint existente `b3-mt5-estado-real` já armazena `fechamentos`, mas o relatório observado trouxe `[]`.
Cada item deve representar uma saída integral confirmada pela corretora:

```json
{
  "ticket_posicao": "identidade da posição que corresponde ao broker_ticket_entry",
  "volume": 1,
  "preco": 130000,
  "fechado_em": "2026-11-11T13:30:00-03:00",
  "resultado_brl": -56,
  "motivo": "stop_loss"
}
```

Os números acima são exemplos de contrato, não negócios executados. `resultado_brl` deve ser o resultado líquido real informado, incluindo os custos efetivamente conhecidos; não calcular a partir de stop, cotação atual ou preço presumido. O horário precisa de fuso. `volume` deve corresponder à quantidade inteira da ordem. Saídas parciais/múltiplas ficam sem apuração até haver um agregado verificável, não se escolhe arbitrariamente um negócio. Magic não é identidade da posição.

A reconciliação preserva todas as entradas anteriores a 11/11/2026 00h BRT, inclusive os oito nulos de 10/11. Quando chegar evidência válida para uma nova ordem ausente do relatório, grava preço, horário, resultado líquido e evidência integral com quem fechou=corretora. Sem evidência não inventa preço/horário nem resultado; registra divergência e mantém o aviso de apuração pendente.

## Conferência

- 20 testes passaram: +202 apurado com sete nulos é desconhecido; todas as onze operações do exemplo somam −197; ticket exato, volume completo, preço/horário válidos; suspensão do disjuntor e preservação de trava anterior; gravação de uma perda em cliente falso isolado, sem banco real.
- Navegador autenticado: banco atual mostra +202 apurado, oito ordens sem apuração e zero posições no último relatório, que estava desatualizado. Cockpit e extrato exibem alerta e o disjuntor mostra vigilância suspensa. Conferência também mostra resultado desconhecido. Cópia do cockpit inclui os campos de apuração.
- Celular 390×844 sem transbordamento horizontal; telas conferidas visualmente. Compilação OK.
- Nenhuma ordem real foi fechada/testada com escrita no banco; histórico não foi corrigido. Nenhuma escrita em autorizações ou carteira real. Não publicado.

## Limitação

O retorno real de saída ainda não foi exercitado ponta a ponta: depende do executor, fora deste repositório, enviar `fechamentos` preenchido. Suspensão significa que não se cria uma nova trava financeira usando um resultado incompleto; não desfaz trava irreversível existente e não altera a base ou percentuais.