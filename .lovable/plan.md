# Carteira e Cockpit Real — 09/11

## 1. Carteira em qualquer data
Mostrar sempre saldo atual e painel de transferência, inclusive nos períodos encerrados. Manter `vivo` para resultados, ordens e exposição do dia; a carteira permanece uma leitura atual, sem retrato histórico.

## 2. Igualar carteiras da modalidade
Adicionar o botão no painel existente, com prévia obrigatória dos oito robôs (saldos, contratos, lucro próprio e transferências líquidas) e totais antes/depois.

O banco determina `n = MIN(8, floor(total / degrau))` pela função canônica `b3_carteira_contratos(raiz,total,8)`. Recusar n=0. Como não foi indicada prioridade entre robôs, selecionar os n maiores saldos, desempate por modo; distribuir em centavos e atribuir o resíduo deterministicamente, preservando o total exato.

Confirmar em uma única transação, bloqueando as carteiras e revalidando a prévia. Reutilizar a transferência por par e seus registros; preservar lucro próprio e invariante. A transferência avulsa mantém o mínimo do doador; somente a equalização precisa permitir zerar os robôs não selecionados, por um caminho interno sem acesso direto do navegador.

## 3. Cockpit Real
Reprodução já aponta a formatação `hhmm` na lista de alertas. Identificar o valor e campo exatos antes de corrigir; tolerar datas ausentes/inválidas em todas as formatações da tela. Exibir dia sem ordens como estado normal e usar a proteção existente na rota e nos painéis.

## Conferência e limites
Testar regras concretas (R$1.368 → n=6 → R$228), recusa sem um degrau, soma zero e validação de prévia. Conferir carteira histórica, prévia real e Cockpit Real vazio em computador/celular. Não executar transferências, nem em testes revertidos. Não alterar motor, trailing, conta real, autorizações ou resultados financeiros.

Committar as alterações; não publicar neste turno. Publicação depende de nova interação após 18:30 Brasília.

## Detalhes técnicos
Nova RPC de equalização owner-scoped, com prévia somente leitura e confirmação atômica; adaptador autenticado e controles no painel existente. Transferência pública mantém assinatura e regra originais, delegando a aplicação a helper interno protegido quando necessário.