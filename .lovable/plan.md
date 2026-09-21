# Mostrar o efeito diário dos freios com os valores de origem

## Escopo

Mudança somente de leitura e apresentação no Cockpit do simulado. Não alterar motor, freios, limites, espelho real, comandos, consolidação nem tabelas.

## Tela

1. Substituir em cada robô as linhas genéricas “Operou / Com freio” por um bloco curto **Efeito no dia** para cada freio que realmente apareceu nas ordens:
   - nome do freio e horário de acionamento já disponível; no grupo, manter também o nível;
   - **no acionamento**: resultado das entradas abertas sem aquele freio em `freios_na_sombra`;
   - **fim do dia**: resultado completo em sombra;
   - **teria custado** ou **teria poupado**, escolhendo somente o texto coerente com a diferença;
   - **teria barrado X de Y entradas**.

2. Acrescentar o mesmo quadro no subtotal de cada modalidade, usando o consolidado diário já existente para a modalidade.

3. Acrescentar no cabeçalho de cada ativo um quadro consolidado:
   - uma linha para cada freio, somando os consolidados das modalidades visíveis;
   - uma linha **todos os freios valendo**, usando apenas entradas abertas sem nenhum freio ativo;
   - quando restarem zero entradas, mostrar **não teria operado**, nunca “R$ 0,00”.

4. Atualizar a ação de copiar para reproduzir os mesmos valores e rótulos mostrados nos cards, sem a linha antiga “com freio 0 entradas”.

## Regra de cálculo exibida

Usar exclusivamente os agregados de leitura já derivados de `b3_simulation_orders`:

- `resultado_livre_brl` = fim do dia em sombra;
- por freio, `resultado_sombra_brl` = resultado das entradas abertas antes daquele freio;
- `ops_barradas` e `ops_livre` = “teria barrado X de Y”;
- `resultado_sombra_brl` / `ops_sombra` do consolidado geral = “todos os freios valendo”.

No ativo, somar esses mesmos campos das modalidades; não recalcular nem gravar nada no motor.

## Verificação

- Conferir o caso WIN / price_action / arrojado: −R$ 295 no acionamento, +R$ 870 no fim e R$ 1.165 de custo.
- Conferir que ativo e modalidade podem mostrar conclusões opostas sem esconder a diferença.
- Conferir “não teria operado” quando nenhuma entrada abriu sem freio.
- Validar a tela em desktop e celular e confirmar que nenhuma função de decisão ou escrita foi modificada.
