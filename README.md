# AleTrader AI Dashboard

Prompt de Desenvolvimento — AleTrader AI

Fase 1 — Fundação Segura, Binance em Leitura e Painel Privado

Crie uma plataforma privada chamada AleTrader AI.

O sistema será de uso exclusivo do proprietário, sem SaaS, sem cadastro público e sem venda para terceiros.

O objetivo inicial é construir a base técnica para um robô/agente de análise de criptomoedas, com integração segura à Binance, leitura de dados de mercado, leitura de saldo, painel privado, logs e estrutura preparada para agentes de decisão.

Nesta fase, o sistema NÃO deve executar compras ou vendas reais.

Stack desejada

Utilizar:

React

TypeScript

Supabase

Edge Functions

PostgreSQL

OpenAI API

Binance API

Telegram Bot opcional

n8n opcional para automações futuras

Regras obrigatórias de segurança

Nunca expor chave da Binance no frontend.

As chaves da Binance devem ser salvas somente em variáveis de ambiente seguras no backend.

Nesta fase, usar somente permissões de leitura.

Não permitir saque.

Não permitir trade real.

Criar uma camada backend responsável por intermediar qualquer chamada à Binance.

Toda chamada à Binance deve ser registrada em log.

Criar botão de emergência chamado “Pausar Robô”.

Quando pausado, o sistema deve interromper qualquer rotina automática.

Módulos da Fase 1

1. Autenticação privada

Criar login privado para o proprietário.

Não permitir cadastro público.

Apenas usuários previamente autorizados podem acessar o painel.

2. Painel principal

Criar dashboard com:

Status da conexão com Binance

Status da API OpenAI

Status do robô: ativo, pausado ou erro

Saldo total da conta

Lista de ativos monitorados

Últimos alertas

Últimos logs

Botão Pausar Robô

Botão Reativar Robô

3. Integração Binance — modo leitura

Criar conexão com Binance API para consultar:

Preço atual dos ativos

Candles

Volume

Saldo da carteira

Histórico básico de ordens

Status da conta

Nesta fase, bloquear qualquer endpoint de compra, venda, margem, futuros ou saque.

4. Ativos monitorados

Criar tela para cadastrar ativos monitorados, por exemplo:

BTCUSDT

ETHUSDT

SOLUSDT

XRPUSDT

BNBUSDT

Cada ativo deve ter:

Nome

Par

Status ativo/inativo

Timeframes monitorados

Observações

Timeframes iniciais:

15 minutos

1 hora

4 horas

1 dia

5. Coleta de dados

Criar rotina para buscar periodicamente:

Preço atual

Variação percentual

Volume

Candles

Máxima e mínima do período

Salvar os dados no banco para histórico e futura análise.

6. Indicadores iniciais

Calcular indicadores básicos:

Média móvel curta

Média móvel longa

RSI

MACD

Volume médio

Variação percentual em 24h

Nesta fase, os indicadores servem apenas para observação.

7. Logs

Criar tabela de logs com:

Data

Hora

Tipo de evento

Origem

Mensagem

Severidade

Dados técnicos

Tipos de evento:

API Binance

API OpenAI

Coleta de dados

Erro

Alerta

Segurança

Sistema

8. Estrutura inicial dos agentes

Criar a base para agentes especialistas, mas sem decisão automática ainda.

Tabela de agentes:

Nome do agente

Perfil

Peso

Status ativo/inativo

Regras principais

Poder de veto

Descrição da estratégia

Agentes iniciais:

Agente de Tendência

Agente de Volume

Agente Técnico

Agente de Momentum

Agente de Sentimento

Agente Conservador

Agente Agressivo

Agente Longo Prazo

Agente Anti-Euforia

Agente de Risco

9. Tela dos agentes

Criar uma tela para listar os agentes.

Cada agente deve exibir:

Nome

Estratégia

Peso

Status

Última análise

Último voto

Confiança

Justificativa

Nesta fase, o voto pode ser simulado.

10. Alertas

Criar sistema inicial de alertas internos.

Alertas possíveis:

Forte queda

Forte alta

Volume anormal

RSI sobrecomprado

RSI sobrevendido

Cruzamento de médias

Erro na API

Robô pausado

Robô reativado

Exibir alertas no dashboard.

Preparar estrutura para envio por Telegram ou WhatsApp futuramente.

Banco de dados

Criar tabelas para:

users_private_access

binance_connection_status

monitored_assets

market_snapshots

candles

indicators

agents

agent_votes

alerts

system_logs

robot_settings

Configurações gerais

Criar tela de configurações com:

Robô ativo ou pausado

Frequência de coleta

Ativos monitorados

Timeframes ativos

Limite de chamadas por minuto

Modo atual: leitura, simulação, testnet ou real

Nesta fase, deixar o modo fixo como “leitura”.

Critérios de conclusão da Fase 1

A fase será considerada concluída quando:

O login privado estiver funcionando

O painel carregar corretamente

A conexão Binance em leitura estiver funcionando

O saldo for exibido

Os preços forem exibidos

Os candles forem salvos

Os indicadores básicos forem calculados

Os agentes forem cadastrados

Os logs forem registrados

O botão Pausar Robô funcionar

Nenhuma compra ou venda real estiver disponível

Proibição nesta fase

Não criar execução de ordem real.

Não criar ordem de compra.

Não criar ordem de venda.

Não criar operação em futuros.

Não criar operação com margem.

Não criar saque.

Não deixar chave API no frontend.

Não permitir cadastro público.

Não criar promessa de lucro.

Resultado esperado

Ao final da Fase 1, o AleTrader AI deve ser um painel privado e seguro, conectado à Binance somente em modo leitura, capaz de monitorar ativos, salvar dados históricos, calcular indicadores básicos, exibir alertas e preparar a estrutura para agentes inteligentes nas próximas fases.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://ale-trader-core.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/d7946518-67dd-4c85-bfb5-fad9472b09e3).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
