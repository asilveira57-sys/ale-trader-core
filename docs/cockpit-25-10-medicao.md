# Cockpit por data — medição de 25/10/2026

Leituras autenticadas no preview, sem executar motor ou comandos reais.

## Antes da apresentação nova
- 24/10 sem ordens: chamada 559 ms; render 0,2 ms.
- 21–23/10: chamada 1.981 ms; render do quadro antigo 75 ms.
- O caminho da data não chamava b3_cockpit_cinco_pregoes; seus pares vazios não explicam esta espera.

## Depois — chamadas individuais, sem otimização de desempenho
- WIN 21–23/10: resumo 2.646 ms; execuções 576 ms/105 linhas; catálogo 537 ms/720; cores 256 ms/374; ordens 364/346/348 ms com páginas de 1.000/1.000/619 linhas. Ordens continuam lidas sem filtro antes do recorte, comportamento anterior preservado.
- WIN picos/evidência: chamada 792 ms; realizado 241 ms/62 linhas, exposição 363 ms/124, efeito 587 ms/368.
- Sem filtro 21–23/10: resumo 2.959 ms; evidência 3.442 ms, exposição 3.221 ms, realizado 1.043 ms, efeito 620 ms.
- Sem filtro 30 dias: resumo 6.855 ms; 13.343 ordens em 14 páginas. Evidência 8.472 ms; exposição falhou em 8.233 ms, realizado 3.222 ms/428, efeito 516 ms/1.000.
- Render da hierarquia: WIN aproximadamente 60–103 ms; todos 189–273 ms; 30 dias 445 ms em outra amostra. React Profiler mede commits, não tempo de rede nem pintura integral do navegador.
- Zero chamadas periódicas em 12 segundos na visão por data; cópia e recolhimento conferidos; celular 390×844 sem rolagem horizontal da página.

## Limites relatados, não corrigidos
- b3_efeito_freio_dia alcançou 1.000 linhas sem paginação em 3 e 30 dias sem filtro: aviso de leitura possivelmente incompleta.
- Execuções (105), catálogo (720) e cores (374) também não paginam, mas ficaram abaixo de 1.000 nesta medição.
- Novas leituras de pico são chamadas RPC sem paginação; limites/falhas são expostos, sem alterar função SQL.
- b3_cockpit_cinco_pregoes não foi alterada. Nenhuma otimização SQL ou de volume foi feita.
- Visão de hoje mantém queries, chaves, intervalos e leitura de overview originais; visual conferido com 176 robôs após aguardar a chamada original. O quadro do freio muda apenas pelo item TOTAL solicitado.

## Referências conferidas
- WIN 21–23/10: com −1.326; sem −2.640; efeito +1.314; barradas 156; fechadas 319.
- WIN cinco pregões: faixa visível confirma com −3.944; sem −5.344; efeito +1.400.
- WIN pico exposição no período: 6.448 em 22/10; realizado: 790 em 22/10, ambos máximos diários da linha (ativo).
- 17 testes cobrem agregação, identidade única por robô, ausência de ordens e máximos diários.

## Publicação
Aguardando decisão do dono após exposição dos 13 alertas críticos preexistentes de acesso aos dados. Não solicitada neste turno.