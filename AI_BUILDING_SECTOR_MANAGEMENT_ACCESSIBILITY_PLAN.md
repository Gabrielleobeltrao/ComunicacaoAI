# ComunicacaoAI — Plano de gerenciamento acessível de setores, agentes e andares

## 1. Identificação

- Repositório: `Gabrielleobeltrao/ComunicacaoAI`
- Branch visual publicada auditada: `origin/main`
- Commit-base auditado: `5a88ff1` (`fix(responsive): mobile detail badges, full-width editor fields, wrapping create row`)
- `origin/development` continua antiga em `7ca6a81`; não iniciar esta implementação sobre ela.
- Objetivo: tornar o gerenciamento de setor acessível na própria página do setor e na página do agente, reutilizar a imagem viva do card no detalhe e permitir mover um setor entre andares com integridade de dados.
- Este plano inclui frontend, endpoints específicos e validações mínimas de backend necessárias para manter o domínio consistente.
- Não fazer deploy, não alterar DNS e não mexer no motor de automações, worker, filas, autenticação ou sprites.

---

## 2. Contrato de execução para o Claude Code

Antes de editar:

1. Ler este arquivo inteiro.
2. Executar `git status`, `git branch -vv`, `git fetch --all --prune` e `git log --oneline --decorate -25 origin/main`.
3. Confirmar que a base contém `5a88ff1` ou um descendente.
4. Preservar qualquer modificação local do usuário.
5. Criar uma branch de trabalho a partir da `main` atual, por exemplo `feat/sector-management-accessibility`.
6. Não usar `reset --hard`, não apagar dados, não sobrescrever `.env`, não fazer force push e não fazer deploy.
7. Executar as fases na ordem; não começar a UI de movimentação antes de corrigir as invariantes do backend.
8. Reutilizar os componentes e tokens atuais. Não reconstruir as páginas nem desfazer o visual publicado.
9. Manter a experiência desktop e mobile alinhada.
10. Encerrar apenas ao cumprir todos os critérios de aceite ou encontrar um bloqueio real que exija decisão do usuário.

---

## 3. Diagnóstico confirmado no código atual

### 3.1 A edição de membros existe, mas está escondida

`SectorForm.tsx` já possui:

- seletor para adicionar agente;
- ação para remover agente;
- agente padrão;
- ordem de pipeline;
- descrições de roteamento;
- transições.

Porém, esse formulário só aparece quando a URL termina em `/configuracao`.

### 3.2 A navegação especial do setor não está acessível de forma uniforme

`Sidebar.tsx` troca a navegação desktop pelo `SectorNav` quando existe `sectorId`. O mobile usa o menu geral e não apresenta essas seções do setor de maneira clara. A página de detalhe também não possui uma navegação interna evidente.

Resultado: no telefone — e até no desktop sem descobrir a barra — o usuário abre o setor, vê a visão geral, mas não encontra facilmente onde adicionar ou remover agentes.

### 3.3 O formulário impede algumas remoções

`SectorForm.tsx` bloqueia o salvamento quando existem menos de dois membros. O backend não possui a mesma exigência e aceita zero ou um membro. Isso impede:

- montar o setor aos poucos;
- remover temporariamente um agente;
- deixar um setor vazio enquanto ele é reorganizado;
- corrigir uma equipe sem excluir o setor.

É preciso estabelecer uma regra única de “prontidão operacional”, em vez de proibir toda configuração incompleta.

### 3.4 A página do agente não permite trocar seu setor

`AgentDetail.tsx` mostra “Onde é usado” com etiquetas dos setores, mas não possui:

- seletor de setor;
- ação “Trocar de setor”;
- ação “Remover do setor”;
- feedback informando de qual setor ele saiu.

O relacionamento é armazenado em `Sector.members`, não no documento do agente. Portanto, essa função deve usar um endpoint próprio, não apenas enviar `sectorId` no PATCH genérico do agente.

### 3.5 O card visual não foi reaproveitado na página do setor

`SectorManager.tsx` já usa `SectorMapCrop`, que desenha:

- a sala real;
- mesas e cadeiras;
- decoração determinística;
- personagens corretos;
- a mesma simulação do mapa, confinada à sala.

`SectorDetail.tsx` não utiliza esse componente. O detalhe perde a referência visual que levou o usuário até ele.

### 3.6 O backend ainda não permite mover setor de andar

O setor usa `officeId` como andar físico. O PATCH atual aceita somente:

- `name`;
- `color`;
- `mode`;
- `members`.

Ele não aceita mudança controlada de `officeId`/`floorId`.

### 3.7 Existe uma falha de integridade entre setor e andar

`resolveSectorMembers()` valida que cada agente pertence ao usuário, mas não verifica se o `agent.officeId` é igual ao `sector.officeId`.

Isso torna possível, por API, adicionar a um setor de um andar um agente de outro andar. A UI normalmente filtra listas, mas o backend precisa ser a autoridade.

Essa falha deve ser corrigida antes de criar ações de troca e movimentação.

### 3.8 O detalhe do setor carrega agentes de todos os andares

`SectorDetail.tsx` chama `/api/agents` sem `?floorId=`. Isso:

- permite mostrar candidatos de outros andares;
- aumenta o risco da inconsistência acima;
- impede uma seleção coerente durante a edição.

### 3.9 O modelo de frontend omite `floorId`

O backend serializa `floorId` em setores e na listagem de agentes, mas `SectorSummary` e `AgentSummary` não declaram esse campo. Para as novas telas, o andar precisa ser explícito e tipado.

---

## 4. Resultado de produto esperado

### 4.1 Na página do setor

Ao abrir um setor, o usuário deve ver imediatamente:

1. a mesma imagem viva usada no card;
2. nome do setor;
3. andar atual;
4. modo de operação;
5. quantidade de agentes;
6. estado de prontidão;
7. botões claros:
   - `Gerenciar agentes`;
   - `Editar setor`;
   - `Mover de andar`;
8. lista dos agentes com ações para abrir e remover;
9. ação para adicionar um ou vários agentes.

Não exigir que o usuário descubra uma rota escondida para realizar a tarefa principal.

### 4.2 Na página do agente

O usuário deve conseguir:

- ver o andar do agente;
- ver o setor atual ou “Sem setor”;
- escolher outro setor do mesmo andar;
- remover o agente do setor;
- abrir o setor atual;
- receber aviso quando a troca o retirar de outro setor;
- entender quando a entrada em pipeline exige configurar etapa/ordem.

### 4.3 Ao mover um setor

O usuário deve conseguir selecionar um andar de destino e confirmar a operação com impacto claro.

Regra deste plano:

- mover o setor não move automaticamente os agentes;
- agentes atuais permanecem no andar original;
- o wizard permite selecionar agentes do andar de destino para formar a nova equipe;
- nome, cor, modo, ID, histórico analítico e vínculos com canais do setor são preservados;
- o backend atualiza `officeId` e `members` do setor em uma única operação documental;
- o sistema nunca deixa agentes de um andar dentro de setor de outro andar.

Mover agentes entre andares automaticamente fica fora do escopo porque esses agentes podem ser referenciados por automações do andar de origem.

---

## 5. Hierarquia e navegação do detalhe

### 5.1 Rotas canônicas preservadas

Continuar usando:

```text
/floors/:floorId/sectors/:sectorId
/floors/:floorId/sectors/:sectorId/configuracao
/floors/:floorId/sectors/:sectorId/testar
```

Adicionar somente se necessário:

```text
/floors/:floorId/sectors/:sectorId/agentes
```

Preferência: manter “Gerenciar agentes” como dialog/sheet acessível a partir da visão geral e da configuração, evitando criar uma rota extra se não houver benefício real.

### 5.2 Navegação interna visível

Criar uma barra de navegação do próprio setor dentro de `SectorDetail`, visível no desktop e mobile:

- `Visão geral`;
- `Configurações`;
- `Testar`.

Requisitos:

- links canônicos com `floorId`;
- estado ativo pela URL;
- rolagem horizontal no mobile sem overflow da página;
- alvo de toque de pelo menos 44 px;
- indicador/fade quando houver conteúdo lateral;
- não depender do `SectorNav` da sidebar para descobrir as seções.

O `SectorNav` desktop pode permanecer como atalho, mas deve usar `floorSector()` e nunca rotas globais `/setores/:id` no fluxo V2.

---

## 6. Novo cabeçalho visual da página do setor

### 6.1 Reutilizar o componente existente

Usar exatamente `SectorMapCrop` como fonte visual. Não criar uma ilustração duplicada e não copiar manualmente o código do crop.

### 6.2 Estrutura do hero

Criar um `SectorHero` ou composição equivalente:

- painel com borda e accent na cor do setor;
- área visual com `SectorMapCrop`;
- altura aproximada:
  - 180–210 px no mobile;
  - 240–300 px no desktop;
- nome, modo, andar e prontidão abaixo ou ao lado;
- ações responsivas.

Desktop pode usar duas colunas. Mobile deve empilhar imagem, metadados e ações.

### 6.3 Resolver personagens de forma estável

- carregar apenas os agentes do andar do setor;
- construir `buildCharacterResolver` com o mesmo conjunto e regra usados nos cards/mapa;
- evitar trocar rosto/personagem ao navegar entre lista e detalhe;
- após adicionar/remover, atualizar o crop sem refresh manual;
- não executar duas simulações sobrepostas quando a aba/página estiver invisível.

### 6.4 Acessibilidade

O crop é uma representação visual complementar. Fornecer texto adjacente como:

`Sala do setor Marketing com 4 agentes no andar Vendas.`

Não depender da imagem para comunicar membros ou estado.

---

## 7. Gerenciamento de agentes dentro do setor

### 7.1 Ação principal

Adicionar botão `Gerenciar agentes` na visão geral e na configuração.

Abrir dialog no desktop e bottom sheet/quase fullscreen no mobile.

### 7.2 Lista de membros atuais

Cada linha deve mostrar:

- avatar/personagem do agente;
- nome;
- objetivo/cargo curto;
- indicação `Padrão`, quando aplicável;
- área interna, se houver;
- posição da etapa, em pipeline;
- botão `Abrir agente`;
- botão `Remover`.

Não confundir o campo legado `member.sector` com o próprio setor. Na UI, renomear esse rótulo para `Área interna` ou `Especialidade`, sem migrar o campo físico neste plano.

### 7.3 Adicionar agentes

- listar somente agentes do mesmo andar;
- excluir os que já pertencem ao setor;
- indicar quando o agente está em outro setor;
- permitir seleção múltipla;
- mostrar texto: “Ao adicionar, este agente sairá do setor X”; 
- exigir confirmação quando houver transferência;
- respeitar o máximo atual de 10 membros;
- em modo adaptativo, novos membros entram com descrição vazia e podem ser configurados em seguida;
- em pipeline, novos membros entram no final e a UI solicita descrição/condição antes de considerar o fluxo pronto.

### 7.4 Remover agentes

- permitir remover mesmo que reste um ou nenhum membro;
- se o removido for padrão, promover de forma determinística o primeiro membro restante;
- limpar transições de pipeline que apontem ao membro removido;
- mostrar confirmação com nome do agente e setor;
- se a remoção tornar o setor operacionalmente incompleto, explicar a consequência;
- atualizar hero, lista, badges e mapa imediatamente após sucesso.

### 7.5 Prontidão operacional

Derivar estado, sem introduzir uma nova coleção:

| Modo | Pronto | Incompleto |
|---|---|---|
| Adaptativo | 1 ou mais membros e um padrão válido | 0 membros |
| Pipeline | 2 ou mais membros, padrão e etapas válidas | menos de 2 ou configuração inválida |

Mostrar badge:

- `Pronto`;
- `Configuração incompleta`.

Um setor incompleto pode ser salvo para permitir reorganização, mas não deve falhar silenciosamente quando estiver ligado a canais.

### 7.6 Setores ligados a canais

Se uma alteração tornar o setor incompleto e houver widget/WhatsApp vinculado:

- backend retorna conflito estruturado ou exige confirmação explícita;
- UI lista os canais afetados;
- usuário pode cancelar e reorganizar primeiro;
- não deixar um canal ativo sem atendente por acidente.

Não apagar nem desvincular canais automaticamente.

---

## 8. Troca de setor na página do agente

### 8.1 Componente de atribuição

Criar `AgentSectorAssignment` dentro da página do agente, preferencialmente no card “Onde é usado” e também acessível na aba Ajustes.

Exibir:

- `Andar: <nome>` como informação somente leitura;
- `Setor: <nome>` ou `Sem setor`;
- botão/seletor `Trocar de setor`;
- ação `Remover do setor`;
- link `Abrir setor` quando houver setor atual.

### 8.2 Opções permitidas

O seletor mostra somente:

- `Sem setor`;
- setores ativos do mesmo andar do agente.

Não mostrar setores de outros andares como opção desabilitada; isso polui e induz à ação errada. Para mudar de andar, o usuário deve usar o fluxo específico do setor ou uma futura função de movimentação de agente.

### 8.3 Efeito da troca

Como um agente pertence a no máximo um setor:

- selecionar setor B remove o agente do setor A;
- adicionar ao setor B em seguida;
- normalizar o padrão do setor A;
- colocar o agente no final do setor B;
- retornar `previousSector` e `currentSector` na resposta;
- mostrar toast claro:
  - `Ana foi movida de Suporte para Marketing.`;
  - `Ana foi removida de Marketing.`;

### 8.4 Pipeline

Ao colocar um agente em setor pipeline:

- adicionar como última etapa;
- marcar a configuração como incompleta;
- mostrar ação `Configurar etapa` que abre a configuração do setor;
- não inventar condição de avanço automaticamente;
- não publicar/considerar pronto até a validação existente ou nova regra de prontidão passar.

### 8.5 Dados do overview do agente

Modificar o overview para retornar de forma explícita:

```ts
{
  agent: { ..., floorId: string },
  currentSector: { id: string, name: string, floorId: string, mode: 'adaptive' | 'pipeline' } | null,
  linkedSectors: [...],
  ...
}
```

Durante compatibilidade, `linkedSectors` pode continuar existindo, mas `currentSector` é a fonte clara para a nova UI.

---

## 9. APIs e serviços de domínio

### 9.1 Centralizar operações de associação

Criar serviço, por exemplo `backend/src/sectorMembership.ts`, responsável por:

- validar ownership;
- validar mesmo andar;
- respeitar limite de membros;
- preservar um único setor por agente;
- normalizar padrão;
- limpar transições inválidas;
- retornar setores anterior/atual;
- compensar falha parcial quando mais de um documento for alterado.

Não espalhar `$push`/`$pull` diretamente por várias rotas.

### 9.2 Endpoint de atribuição pelo agente

Adicionar:

```http
PUT /api/agents/:agentId/sector
Content-Type: application/json

{ "sectorId": "..." }
```

Para remover:

```json
{ "sectorId": null }
```

Resposta sugerida:

```json
{
  "agentId": "...",
  "floorId": "...",
  "previousSector": { "id": "...", "name": "..." },
  "currentSector": { "id": "...", "name": "...", "mode": "adaptive" },
  "needsConfiguration": false
}
```

Erros estruturados:

- `400 INVALID_ID`;
- `404 AGENT_NOT_FOUND`;
- `404 SECTOR_NOT_FOUND`;
- `409 CROSS_FLOOR_ASSIGNMENT`;
- `409 SECTOR_MEMBER_LIMIT`;
- `409 CHANNEL_IMPACT_CONFIRMATION_REQUIRED` quando aplicável.

### 9.3 Endpoint dedicado para membros do setor

Pode reutilizar PATCH atual internamente, mas expor uma intenção clara é preferível:

```http
PUT /api/sectors/:sectorId/members
```

Body:

```json
{
  "members": [
    {
      "agentId": "...",
      "routingDescription": "...",
      "area": "...",
      "advanceWhen": "...",
      "transitions": [],
      "isDefault": true
    }
  ],
  "confirmChannelImpact": false
}
```

Manter compatibilidade com o campo físico `sector`; a API pode aceitar `area` e mapear, ou continuar usando `sector` internamente. Não realizar migração ampla sem necessidade.

### 9.4 Corrigir validação de andar

Alterar `resolveSectorMembers` para receber o andar esperado:

```ts
resolveSectorMembers(ownerId, rawMembers, expectedFloorId)
```

Validar `agent.officeId.equals(expectedFloorId)`.

Ordem correta:

- criação: resolver/validar andar primeiro, depois membros;
- edição: buscar setor primeiro, usar `sector.officeId`, depois validar membros;
- movimentação: validar membros contra o andar de destino.

Nunca confiar no `floorId` da URL ou body sem validar ownership no backend.

### 9.5 Serialização consistente

Criar/reutilizar serializers explícitos:

- setor sempre retorna `floorId` string;
- agente sempre retorna `floorId` string;
- não depender da serialização implícita de `ObjectId` dentro de documentos brutos;
- atualizar tipos frontend.

### 9.6 Concorrência e falhas parciais

Operações que modificam dois setores devem:

1. validar tudo antes de escrever;
2. guardar snapshot mínimo dos membros afetados;
3. aplicar atualização por serviço central;
4. usar transação Mongo quando o ambiente suportar;
5. ter compensação/rollback em código para ambiente local sem transações;
6. não retornar sucesso parcial.

Adicionar `updatedAt` ao setor nas escritas novas e atualizações. Não exigir migração destrutiva; documentos antigos podem não possuir o campo até serem editados.

---

## 10. Movimentação de setor entre andares

### 10.1 Não usar o PATCH genérico

Criar fluxo explícito para evitar mudança acidental:

```http
GET /api/sectors/:sectorId/move-impact?targetFloorId=...
POST /api/sectors/:sectorId/move
```

### 10.2 Preflight de impacto

O GET deve validar ownership e retornar:

```json
{
  "sector": { "id": "...", "name": "..." },
  "sourceFloor": { "id": "...", "name": "..." },
  "targetFloor": { "id": "...", "name": "..." },
  "currentMembers": [{ "id": "...", "name": "..." }],
  "linkedChannels": [{ "id": "...", "name": "...", "type": "web|whatsapp" }],
  "targetAgents": [{ "id": "...", "name": "...", "currentSector": null }],
  "analyticsPreserved": true,
  "agentsWillStayOnSourceFloor": true
}
```

Não retornar segredos/configurações dos canais.

### 10.3 Wizard de movimentação

Etapa 1 — destino:

- listar somente outros andares ativos do mesmo prédio/owner;
- não permitir o próprio andar;
- não permitir andar arquivado.

Etapa 2 — equipe do destino:

- explicar que membros atuais permanecem no andar original;
- selecionar zero a dez agentes do destino;
- indicar quando um candidato sairá de outro setor;
- em pipeline, permitir ordenar novos membros e inserir dados mínimos.

Etapa 3 — impacto:

- nome do setor e origem → destino;
- quantidade de agentes removidos da equipe atual;
- novos membros;
- canais vinculados que continuarão usando o setor;
- estado previsto `Pronto` ou `Incompleto`;
- confirmação digitada apenas se houver canal ativo e configuração incompleta, ou checkbox inequívoco.

Etapa 4 — conclusão:

- chamar endpoint uma vez;
- atualizar contextos/listas;
- navegar com `replace` para `/floors/:targetFloorId/sectors/:sectorId`;
- atualizar o andar ativo;
- mostrar toast `Setor Marketing movido para o andar Vendas`;
- não deixar a URL antiga aberta com dados do novo andar.

### 10.4 Commit da movimentação

Body sugerido:

```json
{
  "targetFloorId": "...",
  "members": [],
  "confirmChannelImpact": true
}
```

Backend deve:

1. buscar setor e destino com owner;
2. negar destino igual/arquivado/inexistente;
3. validar todos os novos membros no destino;
4. calcular impacto novamente no servidor;
5. exigir confirmação se necessário;
6. atualizar `officeId`, `members` e `updatedAt` no mesmo `findOneAndUpdate`;
7. remover novos membros de outros setores somente por serviço controlado;
8. retornar setor serializado, origem, destino e transferências de membros;
9. preservar `_id`, analytics e vínculos externos.

### 10.5 O que não acontece automaticamente

- agentes antigos não mudam de andar;
- automações não mudam de andar;
- canais não são apagados;
- analytics não são zerados;
- documentos dos agentes não são movidos;
- nenhum setor é duplicado;
- nenhum dado é excluído fora da lista de membros do próprio setor.

---

## 11. Cliente frontend e cache

### 11.1 Criar cliente de setor

Centralizar requests em `frontend/src/lib/sectors.ts`:

- `getSectorOverview`;
- `updateSector`;
- `replaceSectorMembers`;
- `assignAgentToSector`;
- `getSectorMoveImpact`;
- `moveSector`.

Usar parser comum de erro para exibir a mensagem real do backend. Não transformar falha em estado vazio.

### 11.2 Atualização após mutações

Após adicionar/remover/trocar:

- atualizar overview do setor;
- atualizar agentes do andar;
- atualizar setores do andar;
- atualizar overview do agente;
- reinicializar o crop somente quando os membros realmente mudarem;
- manter a aba/posição de navegação;
- evitar refresh completo da página.

### 11.3 Estado otimista

Preferência: não remover/adicionar visualmente antes da confirmação do backend, pois a operação pode transferir o agente de outro setor. Usar estado de loading por linha e atualizar após resposta.

Evitar duplo clique com botões desabilitados durante a mutação.

---

## 12. Estrutura recomendada da página do setor

```text
[ Voltar para Setores ]

[ Imagem viva da sala                       ]
[ Marketing · Andar Comercial · Adaptativo ]
[ Pronto · 4 agentes                       ]
[ Gerenciar agentes ] [ Editar ] [ ••• ]

[ Visão geral | Configurações | Testar ]

Agentes do setor                    [+ Adicionar]
[ avatar Ana · Padrão · ...        Abrir | Remover ]
[ avatar Leo · ...                 Abrir | Remover ]

Desempenho
[ métricas ]

Onde é usado
[ canais ]
```

No menu `•••` ou área de configuração:

- `Mover de andar`;
- `Excluir setor` na Danger Zone.

Não colocar excluir junto das ações diárias principais.

---

## 13. Estados e mensagens

### 13.1 Loading

- skeleton do hero;
- skeleton da lista;
- botão em estado `Salvando…`, `Movendo…` ou `Removendo…`.

### 13.2 Vazio

Setor sem membros:

`Este setor ainda não tem agentes. Adicione agentes deste andar para colocar a sala em operação.`

Ação: `Adicionar agentes`.

### 13.3 Erro

- manter dados anteriores, quando seguros;
- mensagem real e acionável;
- botão `Tentar novamente`;
- não mostrar “Nenhum agente” quando a API falhou.

### 13.4 Sucesso

Usar toast acessível com `aria-live`:

- `Agente adicionado ao setor.`;
- `Agente removido do setor.`;
- `Agente movido de X para Y.`;
- `Setor movido para o andar X.`.

---

## 14. Responsividade e acessibilidade

### 14.1 Mobile

- hero em uma coluna;
- crop com proporção estável;
- ações principais em grid/stack sem overflow;
- dialog de membros quase fullscreen ou bottom sheet;
- lista de candidatos com busca quando houver mais de oito agentes;
- área mínima de toque 44 × 44 px;
- footer de confirmação não fica atrás da bottom nav ou teclado;
- tabs com rolagem própria;
- remoção exige confirmação e não depende de hover.

### 14.2 Desktop

- preservar rail e design atual;
- hero pode ter crop à esquerda e dados à direita;
- ações não deslocam métricas;
- `SectorNav` continua funcional, mas não é a única forma de editar.

### 14.3 Teclado e leitor de tela

- dialogs com foco preso e retorno de foco;
- labels reais nos selects;
- botões de remover com nome do agente no `aria-label`;
- estado selecionado anunciado;
- confirmação de movimentação descreve origem/destino;
- badges não são a única representação de estado;
- respeitar `prefers-reduced-motion` no crop e dialogs.

---

## 15. Integridade e segurança

### 15.1 Regras obrigatórias de backend

- owner do agente, setor e andar deve ser o usuário autenticado;
- agente e setor precisam compartilhar `officeId`;
- setor sempre possui um andar válido;
- máximo de dez membros;
- um agente em no máximo um setor;
- transição de pipeline só aponta para membro atual;
- exatamente um padrão quando houver membros;
- zero membros significa nenhum padrão;
- mudança de andar não aceita andar arquivado;
- IDs recebidos nunca são confiados sem validação.

### 15.2 Auditoria de dados existentes

Criar script de diagnóstico dry-run, por exemplo:

```text
backend/src/scripts/auditSectorFloorIntegrity.ts
```

Ele deve listar, sem corrigir automaticamente:

- membros cujo agente não existe;
- membros de outro owner;
- membros de outro andar;
- agente presente em múltiplos setores;
- transições inválidas;
- setor sem `officeId`.

Não executar reparo destrutivo automaticamente na inicialização. Documentar achados no relatório.

### 15.3 Canais

Validar web widgets e WhatsApp ao calcular impacto. A API atual reúne ambos em estruturas relacionadas, mas o relatório deve provar que nenhum tipo foi esquecido.

---

## 16. Implementação por fases

### Fase 0 — Baseline

1. Confirmar a `main` e o commit-base.
2. Rodar status, typecheck, lint, testes e build existentes.
3. Capturar screenshots antes da mudança:
   - lista de setores;
   - detalhe do setor desktop/mobile;
   - configuração escondida;
   - página do agente/“Onde é usado”.
4. Registrar falhas preexistentes.

Gate: não editar domínio antes de entender baseline e dependências.

### Fase 1 — Invariantes e serializers

1. Tipar `floorId` em agentes/setores.
2. Criar serializers explícitos.
3. Validar mesmo andar em `resolveSectorMembers`.
4. Reordenar validação de criação/edição.
5. Centralizar normalização de membros.
6. Criar script dry-run de auditoria.
7. Testar cross-floor e ownership.

Gate: API rejeita qualquer associação cruzada e testes passam.

### Fase 2 — Serviço de membership

1. Criar serviço central.
2. Implementar endpoint do agente.
3. Implementar endpoint de membros do setor.
4. Tratar limite, padrão e transições.
5. Tratar impacto em canais.
6. Retornar respostas estruturadas.
7. Testar troca A → B, remoção e concorrência básica.

Gate: operações funcionam por API sem UI e nunca deixam membership duplicado.

### Fase 3 — Cliente e hooks

1. Criar `lib/sectors.ts`.
2. Atualizar tipos.
3. Fazer detalhe carregar agentes por `floorId`.
4. Adicionar estados de erro/retry.
5. Atualizar caches após mutação.

Gate: nenhum fetch de edição do setor carrega agentes globais.

### Fase 4 — Página visual do setor

1. Adicionar `SectorMapCrop` no hero.
2. Adicionar metadados e prontidão.
3. Adicionar tabs internas visíveis.
4. Adicionar ações principais.
5. Reutilizar resolver de personagens.
6. Preservar overview, analytics e canais.

Gate: detalhe reconhecível como o mesmo setor do card em desktop e mobile.

### Fase 5 — Gerenciador de agentes do setor

1. Criar dialog/sheet.
2. Listar e adicionar múltiplos agentes.
3. Remover com confirmação.
4. Mostrar transferências de outro setor.
5. Tratar pipeline.
6. Atualizar crop e badges.
7. Permitir setor incompleto com alertas controlados.

Gate: adicionar/remover é possível diretamente na visão geral sem descobrir `/configuracao`.

### Fase 6 — Atribuição na página do agente

1. Exibir andar e setor atual.
2. Adicionar seletor de setor do mesmo andar.
3. Adicionar remover/abrir setor.
4. Mostrar toast e configuração pendente de pipeline.
5. Atualizar overview e “Onde é usado”.

Gate: agente pode ir de sem setor → A → B → sem setor pela própria página.

### Fase 7 — Mover setor entre andares

1. Implementar preflight.
2. Implementar endpoint de commit.
3. Criar wizard de três etapas.
4. Mostrar canais e membros afetados.
5. Selecionar membros do destino.
6. Atualizar URL/contexto após sucesso.
7. Preservar ID, analytics e vínculos.

Gate: setor muda de andar sem membro cruzado e sem mover agentes automaticamente.

### Fase 8 — Responsividade e acessibilidade

1. Validar 320, 360, 390, 412, 768 e 1440 px.
2. Validar teclado virtual.
3. Validar foco de dialogs.
4. Validar tabs e ações.
5. Validar reduced motion.
6. Regressão do mapa e cards.

Gate: nenhuma função fica escondida ou depende de hover.

### Fase 9 — Testes e relatório

1. Executar suites.
2. Fazer E2E com dois andares, três setores e agentes distintos.
3. Capturar screenshots finais.
4. Criar `AI_BUILDING_SECTOR_MANAGEMENT_ACCESSIBILITY_REPORT.md`.

Gate: todos os critérios da seção 18 comprovados.

---

## 17. Estratégia de testes

### 17.1 Backend unitário/integração

Cobrir:

1. adicionar agente sem setor;
2. transferir setor A → B;
3. remover do setor;
4. normalizar padrão removido;
5. limpar transições para membro removido;
6. limite de dez;
7. agente/sector de owners diferentes;
8. agente/sector de andares diferentes;
9. setor inexistente;
10. andar arquivado;
11. movimentação para o mesmo andar;
12. mover setor sem membros;
13. mover setor com novos membros do destino;
14. preservar `_id` e analytics;
15. preservar vínculo de widget e WhatsApp;
16. exigir confirmação quando canal ficaria sem equipe pronta;
17. rollback/compensação de falha parcial.

### 17.2 Frontend unitário/componentes

Cobrir:

- cálculo de prontidão;
- opções filtradas pelo andar;
- texto de transferência;
- lista de membros;
- hero renderiza crop;
- tabs canônicas;
- dialog abre/fecha e restaura foco;
- remoção do padrão;
- wizard de movimentação;
- navegação para novo `floorId`.

### 17.3 Playwright

Seed recomendado:

- andar A: agentes Ana, Bruno; setores Marketing e Suporte;
- andar B: agentes Carla, Diego; setor Pesquisa;
- um widget e um WhatsApp vinculados a Marketing;
- uma automação do andar A referenciando Ana, para provar que ela não muda de andar com o setor.

Cenários:

1. abrir card de Marketing e ver o mesmo crop no detalhe;
2. abrir Gerenciar agentes na visão geral;
3. adicionar Bruno;
4. remover Bruno;
5. mover Ana de Marketing para Suporte pela página da Ana;
6. remover Ana de setor;
7. adicionar Ana novamente;
8. verificar agente padrão após remoção;
9. tentar associar Carla (andar B) via API e receber 409;
10. mover Marketing do andar A para B;
11. confirmar que Ana/Bruno ficaram no A;
12. confirmar Carla/Diego como membros selecionados no B;
13. confirmar que ID e canais foram preservados;
14. confirmar URL nova;
15. voltar/avançar e refresh profundo;
16. testar tudo em 390 × 844;
17. testar ausência de overflow em 320 px;
18. regressão desktop 1440 × 900;
19. mapa/card do setor ainda animam e confinam personagens.

### 17.4 Screenshots finais

Salvar em `docs/sector-management/screenshots/`:

- lista com card visual;
- novo hero desktop;
- novo hero mobile;
- gerenciador de agentes;
- agente com seletor de setor;
- aviso de transferência;
- wizard de mudança de andar;
- resumo de impacto;
- setor no novo andar;
- estado incompleto.

Screenshots devem corresponder ao commit final.

---

## 18. Critérios de aceite

1. Implementação parte da `main` em `5a88ff1` ou descendente.
2. Alterações visuais/mobile publicadas anteriormente são preservadas.
3. A página do setor mostra o mesmo `SectorMapCrop` do card.
4. Nome, andar, modo, membros e prontidão ficam visíveis.
5. `Gerenciar agentes` está acessível na visão geral.
6. Usuário adiciona agentes sem abrir rota escondida.
7. Usuário remove agentes sem abrir rota escondida.
8. Setor pode ficar com zero/um membro, com estado incompleto claro.
9. Impacto em canais exige confirmação clara.
10. A configuração completa continua disponível.
11. Tabs internas funcionam no desktop e mobile.
12. `SectorNav` usa rotas canônicas por andar.
13. Página do agente mostra seu andar e setor atual.
14. Página do agente permite trocar setor.
15. Página do agente permite remover do setor.
16. Seletor do agente lista somente setores do mesmo andar.
17. Troca retorna e mostra setor anterior/atual.
18. Pipeline informa configuração pendente.
19. Backend rejeita associação entre andares.
20. Backend rejeita recursos de outro owner.
21. Um agente permanece em no máximo um setor.
22. Padrão e transições são normalizados.
23. Detalhe do setor carrega somente agentes do seu andar.
24. `floorId` está tipado e serializado explicitamente.
25. Usuário pode mover setor para outro andar ativo.
26. Mover setor não move agentes automaticamente.
27. Wizard permite escolher membros do andar de destino.
28. Setor movido preserva ID, nome, cor, modo, analytics e canais.
29. URL/contexto mudam para o andar de destino.
30. Nenhum membro cruzado permanece após movimentação.
31. Automação que referencia agente do andar antigo não é alterada.
32. Nenhum canal é apagado/desvinculado automaticamente.
33. Erros de API não aparecem como falso vazio.
34. UI atualiza sem refresh completo.
35. Hero, dialogs e listas não têm overflow em 320 px.
36. Ações têm alvo de toque mínimo e foco acessível.
37. Mapa, crop, sprites e simulação continuam funcionando.
38. Typecheck, lint, testes e build passam.
39. Regressão desktop e mobile passa.
40. Script de auditoria é dry-run e não altera dados.
41. Relatório final documenta arquivos, testes, screenshots e pendências.
42. Nenhum deploy foi feito.

---

## 19. Fora de escopo

- mover agentes automaticamente junto com o setor;
- mover automações entre andares;
- duplicar/clonar setor;
- copiar agente entre andares;
- múltiplos prédios por conta;
- novo motor de orquestração;
- novos tipos de automação;
- redesenhar o mapa ou criar sprites;
- alterar histórico de conversas;
- migrar/renomear fisicamente `officeId` no MongoDB;
- apagar analytics antigos;
- desvincular canais automaticamente;
- deploy/Coolify/DNS;
- reparo automático de inconsistências antigas.

---

## 20. Compatibilidade e rollback

- Preservar rotas legadas como redirects.
- Manter o shell V2 atrás das flags existentes.
- Não criar feature flag nova se a entrega puder ser atômica e testada; se o risco exigir flag, usar uma única flag pública documentada e com default seguro.
- Commits pequenos e reversíveis.
- Mudanças de schema devem ser aditivas.
- Documentos antigos sem `updatedAt` continuam legíveis.
- Rollback não pode depender de apagar dados.
- Relatório deve listar intervalo de commits para reversão.

---

## 21. Sugestão de commits

1. `test(sectors): capture management baseline`
2. `fix(sectors): enforce same-floor membership invariant`
3. `refactor(sectors): centralize membership operations and serializers`
4. `feat(api): assign an agent to a sector explicitly`
5. `feat(api): add sector move impact and commit endpoints`
6. `refactor(frontend): centralize sector API client and types`
7. `feat(sectors): add visual hero and in-page navigation`
8. `feat(sectors): manage agents from the sector overview`
9. `feat(agents): change sector from the agent page`
10. `feat(sectors): move a sector between floors safely`
11. `test(sectors): cover membership, movement and responsive flows`
12. `docs(sectors): add implementation report and screenshots`

---

## 22. Relatório final obrigatório

Criar na raiz:

```text
AI_BUILDING_SECTOR_MANAGEMENT_ACCESSIBILITY_REPORT.md
```

Incluir:

- commit inicial e final;
- branch usada;
- arquivos alterados;
- diagnóstico confirmado;
- APIs criadas;
- regra final de prontidão;
- regra final de movimentação;
- prova de que agentes não foram movidos de andar;
- prova de preservação de ID/analytics/canais;
- resultados do script dry-run;
- comandos de typecheck/lint/test/build;
- screenshots;
- pendências honestas;
- instrução de rollback;
- declaração explícita de que não houve deploy.

---

## 23. Definition of Done

O trabalho está pronto quando, pelo telefone ou computador, o usuário consegue:

1. abrir um card de setor e reconhecer a mesma sala no detalhe;
2. enxergar claramente o andar e o estado do setor;
3. adicionar e remover agentes diretamente nessa página;
4. acessar configurações e teste por tabs visíveis;
5. abrir um agente e trocar seu setor;
6. retirar o agente de qualquer setor;
7. mover o setor para outro andar com resumo de impacto;
8. escolher a equipe do andar de destino;
9. confirmar que os agentes antigos ficaram no andar original;
10. continuar usando mapa, cards, canais e automações sem regressões.

Somente depois disso, executar toda a validação, gerar o relatório e encerrar.
