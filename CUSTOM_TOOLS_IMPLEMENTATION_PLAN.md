# Custom Tools Genéricos — Implementation Plan

Analise primeiro a branch `development` atual do ComunicacaoAI e implemente esta evolução SEM nichar a plataforma para trading ou qualquer outro setor.

## Objetivo
Transformar o sistema atual em uma plataforma genérica onde agentes possam receber e executar Custom Tools configuráveis pelo usuário, permitindo integrar qualquer API/serviço sem hardcode no core. Reutilize ao máximo agents, automations, runs, steps, worker, BullMQ, secrets e UI existentes. Não crie sistemas paralelos se já existir infraestrutura equivalente.

## 1. Custom Tools
Criar gerenciamento de Tools reutilizáveis com:
- name e description (a descrição ensina ao agente quando usar)
- HTTP method: GET/POST/PUT/PATCH/DELETE
- URL, headers, query params e body template
- timeout e response type
- input schema e output schema opcional
- auth: none, Bearer, API Key/header, Basic Auth e custom headers

Credenciais/secrets nunca podem aparecer para LLM, logs ou frontend após salvas. Reutilize o sistema seguro de secrets existente. Permita testar a Tool manualmente e mostrar request/response sanitizados.

## 2. JSON Schema / Structured Output
Adicionar suporte genérico real a JSON Schema para parâmetros das Tools: types, required, enum, description etc. Validar argumentos antes da execução.
Permitir também Structured Output configurável para agents/steps, validado contra JSON Schema.
NÃO criar schemas específicos de domínio.

## 3. Tools por Agent
Na configuração do Agent, adicionar seleção de Tools permitidas.
Durante execução, o modelo recebe somente nome, descrição e schema/parâmetros necessários; nunca secrets.

Fluxo:
Agent -> tool call -> backend verifica permissão -> valida argumentos -> injeta secrets server-side -> executa -> sanitiza resultado -> retorna ao Agent -> Agent continua.

Usar function/tool calling nativo do provider/model quando disponível. Suportar múltiplas tool calls com limite configurável para impedir loops.

## 4. Tool Execution Engine
Criar um executor genérico central, reutilizado por chat, automations e executeAgentTask:
- permission check
- schema validation
- secret injection
- HTTP execution
- timeout
- retries seguros
- response parsing
- sanitização
- logs/errors

Não duplicar execução entre módulos. Reutilizar proteção SSRF existente, validar redirects e bloquear redes internas. POST/PUT/PATCH/DELETE não devem receber retry automático indiscriminado.

## 5. Permissions e segurança
Cada Agent executa somente Tools explicitamente atribuídas.
Suportar enabled/disabled, allowed agents, allowed domains, limite de chamadas por run, tamanho máximo de response e timeout.
Secrets sempre server-side.

## 6. Workflows / Automations
Integrar à arquitetura atual sem criar workflow engine paralelo. Agents usados por automations devem conseguir usar suas Tools normalmente. Se encaixar naturalmente na arquitetura existente, permitir Tool como step genérico.

Modelo conceitual:
Trigger -> Agent -> Tool -> Condition -> Agent -> Tool -> Output

Tudo deve continuar genérico/configurável.

## 7. Observabilidade
Registrar via Run/StepRun ou estrutura existente:
- agent/tool
- timestamp/duração
- success/error
- argumentos sanitizados
- resposta sanitizada

UI deve permitir entender eventos como “Agent X called Tool Y”, “Tool completed”, “Agent continued”. Nunca registrar secrets.

## 8. UI
Criar área Tools para criar, editar, duplicar, testar, ativar/desativar, excluir e visualizar onde cada Tool é usada.
Na configuração do Agent: Tools -> selecionar ferramentas disponíveis.
Manter design atual e PT-BR/EN via i18n; nenhuma string nova hardcoded.

## Regra principal
NÃO implementar Trading Tool, Broker Adapter, Market Data Adapter, Stripe/Shopify/CRM específicos ou qualquer integração de domínio no core.
Corretora, Stripe, Shopify, ESP32, CRM ou qualquer REST API devem ser conectáveis depois apenas configurando Custom Tools, sem alterar o core.

Antes de implementar, revise o código atual e aproveite tudo que já existir. Preserve compatibilidade e evite overengineering.

Ao finalizar:
1. rode lint/typecheck/tests/build disponíveis;
2. teste Tool -> Agent -> Tool Result -> Agent end-to-end;
3. valide schema inválido, permission denied, timeout, SSRF, loops e secret sanitization;
4. documente brevemente a arquitetura;
5. informe arquivos alterados e limitações restantes.

Prioridade: simples, genérico, seguro e realmente funcional para o MVP.
