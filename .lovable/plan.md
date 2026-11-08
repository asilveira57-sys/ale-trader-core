# Transferência de saldo — carteira fase A

## Conferência inicial
Os dados atuais do banco conferem com o pedido: WIN · Faixa (`range`), Enoir R$ 487 e 2 contratos, Alexandre R$ 197 e 0 contratos; modalidade R$ 1.722 e 2 contratos. A margem cadastrada é R$ 155, deixando máximo transferível de R$ 285,50.

## Entrega
- Criar o registro de transferência com todos os saldos e contratos antes/depois, acesso restrito ao dono e sem edição/exclusão.
- Separar transferência líquida de resultado próprio na função que atualiza a carteira, mantendo o gatilho de fechamento intacto.
- Transferir somente entre modos da mesma raiz/modalidade, em uma transação, com motivo obrigatório e reserva mínima de um contrato no doador.
- Inserir no cockpit, dentro de cada modalidade na visão atual, o painel com todos os robôs, apelidos, capacidade de doação e candidatos a receber. Não mostrar saldos atuais como se fossem históricos.
- Mostrar prévia antes da confirmação: saldos e contratos dos dois robôs, contratos totais antes/depois e capital total inalterado; avisar quando contratos totais caírem. Copiar lista e prévia; preservar paleta e controles de 44 px.

## Verificação e publicação
- Testar R$ 285 aceitos, R$ 300 recusados com máximo R$ 285,50, saldos R$ 202/R$ 482 e contratos 1/2, total R$ 1.722 e 3 contratos.
- Testar invariante, transferência líquida negativa no doador e resultado próprio intacto, usando transações revertidas: nenhuma transferência de teste permanece nas carteiras do dono.
- Conferir painel e prévia autenticados no computador e celular, sem clicar para persistir uma transferência real.
- Não tocar em motor, gatilho de ordem, disjuntor, conta real ou regras de entrada; não ler placar diário. Commitar e solicitar publicação após as conferências; informar se o serviço não confirmar a conclusão.

## Detalhes técnicos
- A assinatura de cinco argumentos terá `p_tipo DEFAULT 'resultado'`; preservar a assinatura antiga como delegação explícita de quatro argumentos para evitar ambiguidades de sobrecarga e manter os chamadores existentes funcionando. A implementação da escada continua centralizada em `b3_carteira_aplicar`.
- A função de transferência verifica identidade e papel do dono, bloqueia as carteiras em ordem estável, valida o máximo e registra os dois lados atomicamente. Não oferecer escrita direta na tabela.
- Prévia somente leitura usa a mesma margem e `b3_carteira_contratos` do banco; a confirmação refaz a validação e rejeita dados desatualizados. Se necessário, a nova função usa um parâmetro opcional de prévia sem quebrar a assinatura pedida; leituras não gravam nada.
- Os testes financeiros serão executados no banco dentro de transação revertida, além dos testes locais de regras e concorrência relevantes.