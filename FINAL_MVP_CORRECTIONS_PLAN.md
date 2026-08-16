# ComunicacaoAI — Correções finais para o MVP

## 1. Contexto e objetivo

Executar esta rodada sobre a branch `development`, tomando como baseline o commit `cf79a035703200cc53685deda5745bba2f093f58` ou o `origin/development` mais recente caso já contenha esse commit.

O objetivo é fechar as lacunas funcionais e de UX encontradas após a implementação do plano integrado de Apps, agentes, setores e andares. Preservar tudo que já funciona, especialmente:

- movimento e simulação física dos personagens;
- pose/animação de telefone;
- os 18 balões operacionais e assets locais importados do Design System;
- página do agente em largura total e Zona de perigo em Avançado;
- fluxo vertical do setor;
- execução real de setores;
- coordenação do andar, núcleo do setor e comunicação entre andares;
- histórico, logs, migrações e compatibilidade dos dados existentes.

Não fazer merge, deploy, alteração de DNS/Coolify ou leitura/impressão de `.env`. Trabalhar somente na `development`. Não apagar dados existentes.

## 2. Corrigir ativação e navegação dos Apps

### 2.1 WhatsApp não pode criar conexão vazia

O App WhatsApp usa hoje o formulário genérico com `auth.fields: []`, permitindo criar uma instalação `connected` sem número ou provedor válido.

- Introduzir no manifesto uma estratégia explícita de ativação, por exemplo `activation: 'instant' | 'oauth' | 'credentials' | 'managed_channel'`.
- Chat Web pode usar ativação instantânea e idempotente.
- WhatsApp deve usar `managed_channel`: o CTA **Conectar** abre `/apps/whatsapp/channels` e inicia o fluxo real já existente do provider/número.
- Considerar o WhatsApp ativo somente quando houver ao menos um canal válido da conta.
- Não duplicar credenciais nem providers. Continuar usando o storage criptografado atual dos canais.
- Detectar instalações vazias antigas criadas pelo fluxo genérico e revogá-las/marcá-las inválidas de forma idempotente, sem apagar conversas, números ou histórico.
- O teste da conexão deve validar o canal/provider real; nunca retornar sucesso apenas porque o manifesto não possui campos obrigatórios.

### 2.2 Guardar as superfícies de Apps

`resolveSurface()` existe no backend, mas ainda não protege as páginas reais.

- Criar um guard reutilizável para cada rota compilada de App.
- Validar App conhecido, surface conhecida e ao menos uma instalação realmente utilizável (`status === 'connected'`).
- `needs_reauth` e `error` devem abrir uma tela segura com CTA para reconectar/corrigir, não a página operacional.
- App inativo acessado por URL direta deve redirecionar para `/apps` com uma mensagem clara.
- Aplicar a mesma regra aos endpoints específicos quando expuserem dados exclusivos da surface.
- Pin nunca pode servir como autorização.

### 2.3 Status, pins e navegação

- Somente instalação `connected` é utilizável e fixável. `error`, `needs_reauth` e `revoked` não são `ready`.
- Mostrar erro ao usuário quando fixar/desafixar falhar; não engolir a exceção.
- Disponibilizar **Fixar no menu** também no modal de detalhes do App após ativação.
- No mobile, renderizar um item-pai por App, expansível, com suas subpáginas; não achatar todas as páginas como links independentes.
- Criar as surfaces reais de **Visão geral** para Chat Web e WhatsApp, com métricas e atalhos obtidos do backend. Não declarar rota sem componente e endpoint reais.
- Ajustar textos de Apps sem actions: canais como Chat Web/WhatsApp não devem ser descritos genericamente como “entregas de rotinas”.

## 3. Tornar o editor de permissões do agente confiável

O `AgentAppGrantsEditor` envia um PATCH da lista inteira a cada checkbox e a cada caractere digitado. Respostas fora de ordem podem sobrescrever a configuração mais recente.

- Manter um draft local e um botão explícito **Salvar permissões**, preferencialmente.
- Alternativamente, usar debounce com fila serial e versionamento, garantindo que somente a revisão mais recente seja persistida.
- Não enviar requisição por caractere.
- Exibir estado sujo, salvando, sucesso e erro.
- Bloquear submissão duplicada e restaurar o estado confirmado pelo servidor quando houver recusa.
- Manter a validação atômica da lista completa no backend.
- Testar alterações rápidas, falha de rede, resposta fora de ordem, remoção de action e remoção automática da autorização autônoma correspondente.

## 4. Ligar o gate único de colaboração ao runtime

`collaborationGate.ts` foi criado, mas `checkCollaboration()` ainda não é usado pelo código de produção. O runtime continua combinando `checkDelegation()` e validações manuais, enquanto discovery e preview podem oferecer alvos que depois serão recusados.

- Tornar `checkCollaboration()` a única decisão final para agente→agente e agente→setor.
- Resolver previamente, de forma owner-scoped, building, andares, configuração de comunicação, política do chamador, política de entrada do alvo, proteção por setor, profundidade, ancestry, orçamento e cancelamento; passar esses fatos ao gate puro.
- Usar exatamente o mesmo gate em:
  - `delegate_to_agent`;
  - `delegate_to_sector`;
  - descoberta/listagem de colaboradores;
  - preview/readiness do coordenador do andar;
  - qualquer endpoint legado ou playground capaz de delegar.
- Remover ou transformar `checkDelegation()` em wrapper do gate para não manter duas regras concorrentes.
- Discovery deve esconder alvos recusados pelo gate. Preview e runtime precisam produzir o mesmo resultado.
- Preservar o grant temporário e restrito do coordenador dentro do próprio setor.
- Cobrir direção A→B/B→A, isolamento, links selecionados, `sector_only`, membros expostos, caller policy, ciclos, profundidade e orçamento.

## 5. Completar a raiz de execução e corrigir analytics

Hoje `startExecutionRoot()` é chamado apenas por rotinas/automações. Portanto, métricas do prédio e do andar podem ignorar execuções manuais, canais e delegações.

- Criar/reutilizar uma `ExecutionRoot` determinística para toda execução real:
  - schedule;
  - webhook/event trigger;
  - Chat Web;
  - WhatsApp/outro canal;
  - execução manual;
  - delegação direta;
  - execução de setor.
- Playground/teste deve usar `environment: 'test'` e continuar excluído das métricas de produção por padrão.
- Propagar o `_id` da raiz pelo contexto; `agent_execution_events`, delegações e `sector_executions` devem apontar para a mesma raiz.
- Não usar somente uma string de correlação quando o campo espera `ObjectId`.
- Garantir idempotência em redelivery/retry e primeiro estado terminal vencedor.
- Separar claramente nas métricas de andar:
  - execuções originadas no andar;
  - execuções das quais o andar participou.
- Não combinar contador de roots originados no andar com tokens de participações recebidas de outros andares no mesmo KPI/denominador.
- Prédio conta cada root uma vez. Setor conta cada execução de setor uma vez. Agente conta roots distintos em que participou.
- Atualizar breakdowns, gargalos, período, telemetria parcial e timelines.
- Adicionar testes com uma única execução cruzando dois andares, um setor e vários agentes, provando ausência de dupla contagem.

## 6. Finalizar Apps privados de ponta a ponta

O CRUD/import/export existe, e o runtime consegue resolver um manifesto privado, mas o fluxo normal ainda usa apenas `SYSTEM_APPS` em catálogo, instalações e validação de grants.

- Criar um resolvedor owner-scoped único: Apps do sistema + Apps privados do proprietário.
- Usá-lo no catálogo, detalhes, criação/edição/teste de instalação, validação de grants e runtime.
- Exibir Apps privados na aba adequada da página Apps, com criar, importar JSON, editar, exportar e arquivar/excluir.
- Permitir conectar credenciais do App privado usando os campos declarados e armazenamento criptografado existente.
- Permitir conceder suas actions no `AgentAppGrantsEditor` com os mesmos controles de risco/autonomia.
- Nunca aceitar surfaces, código, HTML/JS ou domínio fora do manifesto validado.
- Não permitir exclusão destrutiva enquanto houver instalações ou grants ativos. Oferecer impacto e fluxo explícito de desativação/revogação.
- Mudança incompatível de actions/domínios exige nova versão e revisão das instalações/grants.
- Testar isolamento entre owners e import sem credencial/permissão automática.

## 7. Corrigir configurações do prédio e seletor

### 7.1 UX do sidebar

- Remover o avatar/círculo com a inicial do prédio do seletor.
- Manter o seletor de andar com nome do prédio/andar e chevron.
- Colocar um botão de engrenagem separado ao lado do seletor, abrindo `BuildingSettingsDialog`.
- Garantir a mesma estrutura no desktop e mobile, com alvos de toque adequados.
- Suportar `?buildingSettings=1` para abrir, reload, back e fechamento acessíveis.

### 7.2 Preview antes de salvar

Atualmente o `onChange` do modo chama preview e save simultaneamente. Isso altera a comunicação antes de mostrar o impacto.

- Manter `savedConfig` e `draftConfig` separados.
- Alterar modo/links somente no draft.
- O backend deve calcular impacto para o candidato completo — modo e links do draft — sem persistir.
- Se houver referências bloqueadas, exigir confirmação explícita antes do PATCH.
- Disponibilizar **Salvar alterações** e **Cancelar**.
- Não salvar automaticamente ao selecionar modo, adicionar ou remover link.
- Evitar requisições concorrentes e rollback visual inconsistente.

## 8. Consolidar os balões operacionais já implementados

Preservar os assets e o componente do commit `cf79a03`; não redesenhar nem voltar ao `⚙`.

- Tipar `opState` com `AgentBubbleState` em vez de `string` onde possível.
- Confirmar que pause/retorno à mesa afetam apenas a simulação física, não a telemetria operacional.
- Confirmar que a pose `phone` continua independente do balão.
- Usar ETag/`If-None-Match` ou `updatedSince` no polling para evitar payload completo sem mudança; cancelar requests ao trocar de andar/desmontar.
- Revisar quais estados têm uma transição real emitida. Hoje vários estão apenas no enum/manifesto. Instrumentar somente quando houver evento verificável para `researching`, `waiting_external`, `waiting_input`, `responding` e `generating_output`; nunca inferir pelo preset, agenda ou texto da LLM.
- Estado sem fonte real deve simplesmente não ser emitido até existir um evento correspondente.
- Validar simultaneidade, TTL, falha, cancelamento, troca rápida de estado, reduced motion, zoom/pan, fallback estático e ausência de sobreposição com nome.

## 9. Validação obrigatória

Executar antes de declarar concluído:

1. `npm ci` na raiz.
2. Typecheck de backend e frontend.
3. Build completo.
4. Testes backend e frontend.
5. Testes de integração com Mongo em fixture.
6. E2E de Apps, WhatsApp, permissões, navegação mobile, building settings, colaboração, métricas e balões.
7. `git diff --check`.
8. Revisão de logs para garantir ausência de credenciais, prompts, outputs, URLs privadas e erros crus.

Adicionar testes de regressão específicos para cada problema deste plano. Não enfraquecer/remover testes existentes para obter verde.

## 10. Critérios de aceite

- WhatsApp nunca aparece conectado sem canal/provider válido.
- URL direta não abre surface de App inativo ou quebrado.
- Pin é apenas navegação e só funciona para App conectado.
- Mobile mostra um App-pai expansível com subpáginas.
- Alterações rápidas de grants não se perdem nem chegam fora de ordem.
- Discovery, preview e runtime usam o mesmo gate e concordam sobre todos os alvos.
- Toda execução de produção possui uma raiz correlacionada, independentemente da origem.
- Métricas não omitem canais/manual/delegação e não contam uma execução várias vezes.
- App privado pode ser criado/importado, conectado, concedido e executado sem sair do fluxo normal.
- Configuração entre andares nunca é salva antes de exibir impacto e confirmação.
- Seletor não possui o avatar com inicial e apresenta engrenagem separada.
- Balões continuam vindo do runtime, sem interferir em caminhada, posição, telefone ou pause.
- Build, typecheck, testes e fixture ficam verdes.

## 11. Entrega esperada

Ao terminar, informar:

- commits criados por fase;
- arquivos alterados;
- migrações executadas e quantidade de documentos afetados, somente contagens;
- testes executados e resultados;
- problemas encontrados e decisões tomadas;
- pendências reais, se houver;
- confirmação explícita de que não houve merge nem deploy.

Não encerrar após apenas criar estruturas ou testes. Continuar fase por fase até todos os critérios de aceite estarem implementados e validados, ou registrar um bloqueio técnico concreto com evidência.
