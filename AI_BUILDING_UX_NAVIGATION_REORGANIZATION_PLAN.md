# ComunicaçãoAI — Plano de Reorganização de UX, Navegação e Hierarquia do Prédio

> Plano de implementação para execução pelo Claude Code.
>
> Repositório: `Gabrielleobeltrao/ComunicacaoAI`
>
> Branch analisada: `development`
>
> Commit remoto analisado: `7ca6a81` — `test(pivot): add guarded automation E2E spec + report (phases 8 & 10)`
>
> Natureza desta etapa: reorganização da arquitetura da informação, experiência visual, navegação e escopo por andar. Preservar o motor do pivot já implementado.

---

## 1. Objetivo executivo

Corrigir a experiência do pivot para que o usuário entenda imediatamente a hierarquia:

```text
Dashboard geral
└── Andar selecionado
    ├── Visão do andar / mapa
    ├── Automações
    ├── Agentes
    ├── Setores
    ├── Execuções
    └── Entregáveis

Áreas gerais do sistema
├── Canais
├── Conversas
├── Integrações
└── Configurações
```

O conceito **Prédio** permanece no modelo de domínio e na narrativa da marca, mas não deve existir como uma página primária vazia nem como item concorrente do menu.

O usuário deve ter:

- um único Dashboard geral para visualizar todo o prédio;
- um seletor claro de andar na navegação;
- uma página principal para cada andar usando o mapa visual existente;
- Agentes, Setores, Automações, Execuções e Entregáveis filtrados pelo andar ativo;
- contexto visível em títulos, breadcrumbs, URLs e estados vazios;
- navegação desktop e mobile compreensível;
- acesso simples à identificação do prédio/empresa e aos seus andares.

Não criar um terceiro conceito entre prédio, andar e setor. Não apresentar “Prédio”, “Escritório” e “Andar” como três destinos paralelos.

---

## 2. Diagnóstico confirmado na branch `development`

Antes de editar, atualizar a branch remota e confirmar se o commit analisado ainda é o mais recente. Se houver novos commits, revisar o delta e adaptar o plano sem sobrescrever trabalho válido.

### 2.1 Rotas paralelas e conflitantes

Atualmente existem:

- `/building` → página “Prédio”;
- `/dashboard` → página antiga “Escritório”;
- `/floors/:floorId` → página “Andar”;
- `/automations` → página global visualmente, embora os dados tentem usar andar ativo;
- `/agents` e `/setores` → páginas globais sem filtro de andar.

Isso transforma uma hierarquia pai/filho em itens irmãos e obriga o usuário a adivinhar a diferença.

### 2.2 A página Prédio não é um dashboard útil

`Building.tsx` mostra:

- nome padrão “Meu prédio”;
- um `<select>` de andares;
- formulário de criação;
- cartões com nome e missão.

Não apresenta operação, agentes, próximas execuções, alertas, entregáveis nem caminhos claros. É percebida como uma página vazia.

### 2.3 O antigo Escritório ainda concentra a experiência real

`Dashboard.tsx` ainda possui:

- título “Escritório”;
- métricas conversacionais antigas;
- mapa visual completo;
- todos os agentes e setores retornados pela conta.

Ele não representa o Dashboard geral nem um andar específico. É a parte visual mais valiosa, mas está no nível errado da hierarquia.

### 2.4 A página de andar não contém o andar

`FloorView.tsx` atualmente mostra apenas:

- status;
- fuso;
- idioma;
- contagens;
- algumas métricas;
- botão de arquivar.

Ela não contém o mapa, os agentes, setores, automações recentes nem ações operacionais. Portanto, selecionar um andar não muda a experiência principal.

### 2.5 O andar ativo não é um contexto global

`useFloors()` é instanciado separadamente em diferentes páginas. Cada instância:

- busca prédio e andares novamente;
- mantém estado próprio;
- grava `localStorage`;
- não sincroniza a árvore React em tempo real;
- não usa a URL como fonte principal de verdade.

Selecionar um andar pode alterar somente uma instância/página e não deixa claro para o usuário se o restante da aplicação mudou.

### 2.6 Agentes e setores continuam misturados

`useAgentsAndWidgets()` chama:

- `GET /api/agents` sem `floorId`;
- `GET /api/sectors` sem `floorId`.

No backend:

- `listAgents(ownerId)` lista todos os agentes;
- `listSectors(ownerId)` lista todos os setores;
- a serialização pública não expõe claramente `floorId`;
- `POST /api/agents` ignora o andar selecionado e usa `ensureDefaultOffice()`;
- `POST /api/sectors` também usa sempre `ensureDefaultOffice()`.

Assim, mesmo que a interface pareça estar em Marketing, novos agentes/setores podem ir para o andar padrão e as listas continuam mostrando tudo junto.

### 2.7 O mapa não recebe o andar

`OfficeFloor` recebe apenas arrays de agentes e setores. Ele não recebe `floorId`.

`useAgentStates()` busca internamente o primeiro andar ativo, independentemente do andar que o usuário acredita estar vendo. Isso pode exibir estado operacional do andar errado.

### 2.8 Sidebar sem hierarquia

O menu atual lista no mesmo nível:

- Prédio;
- Escritório;
- Automações;
- Agentes;
- Setores;
- Canais;
- Conversas.

Não há:

- nome do prédio/empresa como contexto;
- seletor central de andar;
- agrupamento entre itens gerais e itens do andar;
- breadcrumb;
- indicação persistente do andar atual.

### 2.9 Mobile inviável com todos os itens

`MobileNav` renderiza todos os itens de `NAV` diretamente na barra inferior. Com as flags ligadas são muitos destinos, rótulos pequenos e baixa legibilidade.

### 2.10 E2E atual não valida compreensão nem escopo

O teste de pivot apenas verifica texto “Andar” em `/building` e a criação básica de uma automação. Ele não valida:

- navegação hierárquica;
- troca de andar;
- filtro de agentes/setores;
- criação no andar correto;
- mapa por andar;
- sidebar/popover;
- mobile;
- redirects legados;
- ausência de mistura entre andares.

---

## 3. Decisão final de arquitetura da informação

### 3.1 Hierarquia conceitual

| Nível | Conceito | Responsabilidade |
| --- | --- | --- |
| 1 | Dashboard geral | Visão agregada de todo o prédio |
| 2 | Andar | Contexto operacional persistente, com missão própria |
| 3 | Setor | Sala/equipe organizacional dentro do andar |
| 4 | Agente | Trabalhador pertencente a um andar e opcionalmente a um setor |
| Trabalho | Automação | Processo configurado dentro de um andar |
| Histórico | Execução | Uma ocorrência de uma automação |
| Resultado | Entregável | Saída produzida por uma execução |

### 3.2 Termos visíveis

Usar consistentemente:

- **Visão geral** ou **Dashboard** para a página inicial autenticada;
- **Andar** para o contexto atual;
- **Setor** para as salas/equipes;
- **Agente**;
- **Automação**;
- **Execução**, nunca “Run” na interface em português;
- **Entregável**, nunca “Artifact” na interface em português;
- **Canais** e **Conversas** para a camada de atendimento.

Remover da navegação primária:

- “Prédio” como nome de página;
- “Escritório” como destino separado;
- “Térreo” como página obrigatória.

“Prédio” pode aparecer em textos explicativos e em Configurações, porque continua sendo o workspace da conta.

### 3.3 Regra central

O Dashboard responde: **“O que está acontecendo em todo o meu prédio?”**

A visão do andar responde: **“Quem e o que existe neste andar?”**

As demais páginas respondem dentro do contexto: **“Quais automações/agentes/setores/execuções pertencem a este andar?”**

---

## 4. Nova estrutura de rotas

### 4.1 Rotas canônicas

```text
/dashboard

/floors/:floorId
/floors/:floorId/automations
/floors/:floorId/automations/:automationId
/floors/:floorId/agents
/floors/:floorId/agents/:agentId
/floors/:floorId/sectors
/floors/:floorId/sectors/:sectorId
/floors/:floorId/runs
/floors/:floorId/artifacts

/channels
/conversations
/settings
/settings/building
/settings/integrations
```

Se manter `/widgets` e `/chats` como URLs canônicas for mais seguro no curto prazo, os rótulos visíveis continuam “Canais” e “Conversas”. O importante é que sejam áreas globais e não confundidas com o andar.

### 4.2 Compatibilidade de URLs existentes

Não quebrar bookmarks, links enviados ou navegação interna existente.

- `/building` → redirect replace para `/dashboard`.
- `/automations` → resolver andar ativo válido e redirecionar para `/floors/:floorId/automations`.
- `/automations/:id` → buscar/usar o `floorId` da automação e redirecionar para a rota canônica.
- `/runs` → andar ativo ou visão global apenas se uma visão global real for implementada.
- `/agents` → andar ativo válido e redirect para `/floors/:floorId/agents`.
- `/agents/:agentId` → resolver o andar real do agente e redirect.
- `/setores` → andar ativo válido e redirect.
- `/setores/:sectorId` → resolver o andar real e redirect.
- `/widgets` e `/chats` podem permanecer com aliases para `/channels` e `/conversations` se forem renomeados.
- `/teams` continua redirecionando para o setor correto.

### 4.3 URL como fonte de verdade

Em toda rota com `:floorId`:

- o parâmetro da URL define o andar atual;
- validar formato e ownership;
- se inexistente/arquivado, mostrar estado claro ou redirecionar com aviso;
- persistir o último andar válido apenas como fallback;
- `localStorage` nunca deve sobrepor um `floorId` explícito da URL.

Isso torna links compartilháveis e elimina contexto invisível.

---

## 5. Shell autenticado e contexto global

### 5.1 Criar um único provider

Substituir instâncias soltas de `useFloors()` por um provider único, por exemplo:

```tsx
<ProtectedApp>
  <BuildingProvider>
    <AppShell />
  </BuildingProvider>
</ProtectedApp>
```

O provider deve expor:

```ts
interface BuildingContextValue {
  building: Building | null
  floors: Floor[]
  activeFloor: Floor | null
  activeFloorId: string | null
  loading: boolean
  error: AppError | null
  selectFloor: (floorId: string, options?: { preserveSection?: boolean }) => void
  reloadBuilding: () => Promise<void>
  reloadFloors: () => Promise<void>
}
```

### 5.2 Resolução do andar ativo

Ordem obrigatória:

1. `floorId` válido da rota atual;
2. último andar válido persistido;
3. primeiro andar ativo por `order`;
4. nenhum andar → estado de onboarding no Dashboard.

### 5.3 Sincronização

- Atualizar contexto ao navegar.
- Atualizar `localStorage` depois que ownership/estado forem validados.
- Sincronizar múltiplas abas com `storage` event, se simples e estável.
- Evitar refetch de building/floors em cada página.
- Invalidar cache após criar, editar, arquivar ou reordenar andar.

### 5.4 Estados de carregamento

O shell não deve piscar itens do andar errado.

- skeleton do seletor enquanto carrega;
- erro com retry;
- nenhum andar com CTA “Criar primeiro andar”;
- usuário ainda pode abrir Configurações e sair.

---

## 6. Sidebar desktop dinâmica

### 6.1 Comportamento geral

Substituir o rail dependente apenas de hover por uma sidebar legível e previsível:

- desktop largo: expandida, aproximadamente 240–264px;
- usuário pode recolher por botão;
- preferência persistida;
- recolhida: ícones com tooltips, seletor de andar ainda acessível;
- não expandir involuntariamente sobre conteúdo a cada movimento do mouse;
- tablet/mobile usam drawer.

Preservar tokens, cores, fontes e componentes existentes. Não redesenhar a identidade inteira.

### 6.2 Cabeçalho do prédio

No topo, exibir um `BuildingSwitcher`:

```text
[marca/avatar] Nome da empresa ou prédio
                Andar atual / quantidade
             [chevron]
```

Origem do nome:

1. `building.name` configurado pelo usuário;
2. se ainda for o default “Meu prédio”, apresentar fallback visual baseado no nome da conta, sem alterar o banco silenciosamente;
3. permitir editar em Configurações → Prédio.

Não confundir com o card do usuário no rodapé. Cabeçalho representa o workspace; rodapé representa a conta logada.

### 6.3 Popover do prédio/andares

Ao clicar no cabeçalho, abrir popover acessível:

```text
Nome do prédio
Visão geral

ANDAR ATUAL
● Marketing

OUTROS ANDARES
  Atendimento
  Pesquisa
  Financeiro

+ Criar andar
  Gerenciar andares
  Configurações do prédio
```

Requisitos:

- busca somente se houver muitos andares;
- indicar ativo por check/cor;
- arquivados ficam em “Gerenciar andares”, não na lista principal;
- teclado, foco, Escape e click-outside;
- clique em “Visão geral” navega `/dashboard`;
- clique em andar abre sua visão ou preserva a subseção quando apropriado;
- nunca apenas alterar `localStorage` sem navegação/feedback.

### 6.4 Grupos de navegação

Sidebar expandida:

```text
GERAL
  Visão geral

ANDAR · MARKETING
  Visão do andar
  Automações
  Agentes
  Setores
  Execuções
  Entregáveis

COMUNICAÇÃO
  Canais
  Conversas

RODAPÉ
  Configurações
  Conta / sair
```

Regras:

- Se não houver andar, esconder/desabilitar o grupo do andar com explicação.
- O label do grupo deve mostrar o nome real do andar.
- Destino ativo considera prefixo da rota, não igualdade exata apenas.
- Detalhes de agente/setor/automação mantêm o item pai ativo.
- Badges opcionais: falhas de execução, conversas aguardando humano.
- Não listar cada agente individualmente na sidebar nesta etapa; isso escala mal e aumenta ruído.

### 6.5 Troca preservando módulo

Quando o usuário está em uma área que existe em todos os andares:

- Marketing → Agentes;
- troca para Pesquisa;
- navegar para Pesquisa → Agentes.

Mapear seções preserváveis:

- overview;
- automations;
- agents;
- sectors;
- runs;
- artifacts.

Em detalhes específicos (`agentId`, `sectorId`, `automationId`), trocar de andar deve ir para a listagem correspondente, porque o ID atual não pertence ao novo andar.

---

## 7. Navegação mobile

### 7.1 Barra inferior

Não renderizar todos os itens de desktop.

Máximo recomendado de cinco destinos:

1. **Início** → `/dashboard`.
2. **Andar** → visão do andar ativo.
3. **Automações** → automações do andar ativo.
4. **Agentes** → agentes do andar ativo.
5. **Mais** → abre drawer.

Se não houver andar, os itens dependentes abrem onboarding/criação em vez de rota quebrada.

### 7.2 Drawer mobile

O drawer deve conter:

- nome do prédio;
- seletor de andar no topo;
- todos os grupos da navegação;
- Configurações;
- conta e sair.

Não duplicar listas divergentes entre desktop, drawer e bottom nav. Criar configuração de navegação com metadados de escopo e derivar as três superfícies.

### 7.3 Topbar mobile

Em páginas do andar:

- título mostra o módulo;
- subtítulo/breadcrumb curto mostra o andar;
- o nome do andar pode ser clicável para abrir o switcher;
- ações grandes vão para menu overflow quando necessário;
- respeitar safe areas e 44px de toque.

---

## 8. Dashboard geral — substituir Building + antigo Dashboard

### 8.1 Rota e identidade

`/dashboard` será a única visão geral.

Título:

- `building.name` quando significativo;
- subtítulo “Visão geral do seu prédio de IAs”.

Não usar título “Prédio” nem “Escritório”.

### 8.2 Conteúdo prioritário

Ordem sugerida:

1. alertas que exigem ação;
2. resumo operacional;
3. andares;
4. atividade recente;
5. próximas execuções;
6. entregáveis recentes;
7. resumo de comunicação, secundário.

### 8.3 KPIs gerais

Cards úteis:

- andares ativos;
- agentes totais;
- automações ativas;
- execuções em andamento;
- falhas recentes;
- entregáveis produzidos;
- uso de tokens/custo.

Conversas, leads e handoffs aparecem em seção “Comunicação”, sem dominar o dashboard operacional.

### 8.4 Cards de andar

Cada card deve mostrar:

- cor/ícone;
- nome;
- missão em até duas linhas;
- agentes;
- setores;
- automações ativas;
- execução em andamento/alerta;
- próxima execução, se houver;
- botão/área “Abrir andar”.

Evitar renderizar vários mapas completos no Dashboard. O mapa completo pertence à visão do andar.

### 8.5 Ações

- `+ Criar andar`;
- “Abrir último andar”;
- “Criar automação” somente após escolher/confirmar um andar;
- “Configurar prédio”.

### 8.6 Empty state

Se não houver andar:

```text
Monte seu primeiro andar
Cada andar reúne setores, agentes e automações para uma missão específica.
[Criar primeiro andar]
```

O formulário deve solicitar inicialmente apenas nome e missão. Configurações avançadas ficam depois.

### 8.7 Endpoint de overview

Evitar N+1 de chamadas por andar. Criar endpoint agregado, por exemplo:

`GET /api/building/overview`

Resposta mínima:

```ts
interface BuildingOverview {
  building: BuildingPublic
  totals: {
    floors: number
    agents: number
    sectors: number
    automationsActive: number
    runsActive: number
    failures24h: number
    artifacts24h: number
  }
  floors: Array<{
    floor: FloorPublic
    agentCount: number
    sectorCount: number
    automationsActive: number
    runsActive: number
    failures24h: number
    nextRunAt: string | null
  }>
  recentRuns: RunSummary[]
  recentArtifacts: ArtifactSummary[]
}
```

Aplicar ownership em todas as agregações.

---

## 9. Visão do andar — transformar no antigo escritório corretamente

### 9.1 Rota

`/floors/:floorId`

### 9.2 Cabeçalho

Exibir:

- breadcrumb `Visão geral / Marketing`;
- nome do andar;
- missão;
- status discreto;
- ações `Criar automação`, `Novo agente`, menu `Editar andar`.

Arquivar andar deve ficar em Configurações/ação perigosa, não como ação principal no corpo.

### 9.3 Mapa visual

Mover/integrar o `OfficeFloor` que hoje está no antigo Dashboard.

O mapa deve receber explicitamente:

```tsx
<OfficeFloor
  floorId={floor.id}
  agents={floorAgents}
  sectors={floorSectors}
/>
```

Requisitos:

- somente agentes com `officeId === floorId`;
- somente setores com `officeId === floorId`;
- preservar sprites, pathfinding, decoração, pausa, recall, labels e responsividade;
- links de agente usam rota canônica com `floorId`;
- `useAgentStates(enabled, floorId)` usa exatamente o andar visível;
- troca de andar desmonta/recria a simulação com segurança;
- nenhuma alteração no motor visual além da injeção correta de contexto.

### 9.4 Resumo ao redor do mapa

Antes ou depois do mapa, de forma compacta:

- automações ativas;
- execução atual;
- falhas;
- próxima execução;
- últimos entregáveis.

Não repetir uma parede de métricas. O mapa é o centro visual da página.

### 9.5 Subnavegação

Pode haver tabs/atalhos compactos acima do conteúdo:

- Visão;
- Automações;
- Agentes;
- Setores;
- Execuções;
- Entregáveis.

Se a sidebar já estiver expandida, essas tabs podem ser substituídas por links rápidos/cards no mobile. Não manter duas navegações igualmente fortes na mesma tela.

### 9.6 Endpoint de overview do andar

Criar `GET /api/floors/:floorId/overview` ou compor com endpoints paginados, retornando:

- dados do andar;
- contagens;
- agentes resumidos para o mapa;
- setores resumidos para o mapa;
- automações ativas/resumo;
- runs recentes;
- próxima execução;
- entregáveis recentes.

Se o payload do mapa for grande, separar agentes/setores, mas manter carregamento coordenado e skeleton consistente.

---

## 10. Escopo real de Agentes

### 10.1 Backend

Atualizar repositories/services/APIs:

- `listAgents(ownerId, floorId?)`.
- `GET /api/agents?floorId=...` valida o andar e filtra `{ ownerId, officeId: floorId }`.
- `POST /api/agents` aceita `floorId`.
- verificar que o floor pertence ao owner.
- criar com `officeId = floorId`.
- para clientes legacy sem `floorId`, manter fallback temporário para o andar padrão, mas registrar deprecation e garantir que a nova UI sempre envie.
- serializar `floorId: agent.officeId.toString()`.
- agent stats devem aceitar `floorId` ou IDs filtrados.
- overview/detail deve devolver `floorId`.

### 10.2 Frontend

- rota canônica inclui `floorId`;
- buscar apenas agentes do andar;
- título “Agentes” e subtítulo “Marketing”/nome do andar;
- CTA “Novo agente neste andar”;
- `AgentForm` recebe `floorId` explícito no modo criação;
- após criar, permanecer no mesmo andar;
- filtros de setor usam apenas setores do andar;
- cards podem priorizar métricas operacionais, mantendo conversacionais quando relevantes.

### 10.3 Detalhe

- breadcrumb `Marketing / Agentes / Nome`;
- se URL floor não corresponde ao agente, redirecionar para o floor real ou negar, sem renderizar dado incoerente;
- manter as subseções atuais;
- textos de atendimento ficam numa seção própria, sem voltar a centralizar o produto todo.

### 10.4 Duplicar/mover agente

Não implementar cópia de agente nem compartilhamento entre andares nesta etapa. Registrar como extensão futura.

O modelo atual define um andar principal por agente. No futuro:

- “Duplicar para outro andar” cria outro agente com novo ID e copia configurações selecionadas;
- knowledge/connections/secrets exigirão política explícita;
- automações não devem ser copiadas silenciosamente.

Não aumentar agora o risco do plano de UX com essa função.

---

## 11. Escopo real de Setores

### 11.1 Backend

- `listSectors(ownerId, floorId?)`.
- `GET /api/sectors?floorId=...` filtra por `officeId`.
- `POST /api/sectors` aceita/valida `floorId`.
- serializar `floorId`.
- validar que cada agente membro pertence ao mesmo andar do setor.
- impedir cross-floor membership acidental.
- overview/detail devolvem floorId.
- manter modos adaptive/pipeline e toda lógica conversacional existente.

### 11.2 Frontend

- rota `/floors/:floorId/sectors`;
- texto contextual: “Setores organizam os agentes deste andar em salas e especialidades.”;
- remover a descrição que apresenta todo setor apenas como atendimento ao visitante;
- manter uma explicação secundária de adaptive/pipeline quando o setor estiver ligado a canais conversacionais;
- formulário lista apenas agentes do andar;
- CTA “Criar setor neste andar”.

### 11.3 Mapa

Setores do andar continuam determinando as salas do `OfficeFloor`. Agentes sem setor permanecem no espaço apropriado do mesmo andar.

---

## 12. Automações, Execuções e Entregáveis por andar

### 12.1 Automações

- rota canônica `/floors/:floorId/automations`;
- remover o seletor `Elevator` isolado de dentro da página;
- usar o contexto global/sidebar;
- listagem sempre filtrada pelo `floorId` da rota;
- criação usa esse `floorId`;
- editor valida que automação pertence ao andar da URL;
- breadcrumbs e back navigation coerentes;
- status traduzidos: Rascunho, Ativa, Pausada, Arquivada.

### 12.2 Execuções

- rota `/floors/:floorId/runs`;
- sempre filtrar por andar;
- exibir nome da automação, não somente status/trigger;
- traduzir gatilhos: Manual, Agendada, Webhook;
- timeline legível com nome da etapa, duração e status;
- filtros por status, automação e período;
- ações Cancelar/Reexecutar com confirmação e feedback.

Uma futura visão global de execuções pode existir no Dashboard, mas não criar uma página global ambígua sem seletor e identificação.

### 12.3 Entregáveis

Se backend já possui artifacts mas frontend ainda não possui página completa:

- implementar listagem mínima e útil;
- rota `/floors/:floorId/artifacts`;
- nome, tipo, automação, execução, data, preview/download;
- empty state orienta a executar uma automação;
- não mostrar link de navegação para uma página inexistente/incompleta.

Se esta página não puder ser finalizada e testada nesta etapa, ocultar o item com feature flag até estar pronta, sem placeholder vazio.

---

## 13. Canais e Conversas

### 13.1 Escopo geral

Canais e Conversas podem permanecer no nível do prédio nesta etapa porque os modelos atuais de widget/WhatsApp não têm um `floorId` próprio; eles se ligam a agente ou setor.

### 13.2 Contexto visual

Nas listas:

- mostrar o andar derivado do agente/setor conectado;
- permitir filtro por andar;
- não fingir que um canal pertence diretamente ao andar antes de modelar isso;
- manter widget e WhatsApp funcionando.

### 13.3 Links

Ao abrir agente/setor vinculado, navegar para a rota canônica do andar real.

### 13.4 Conversas

Manter a experiência atual de inbox, realtime e handoff. Adicionar filtros por andar somente se o vínculo puder ser resolvido com segurança e sem piorar performance.

---

## 14. Configurações do prédio e dos andares

### 14.1 Prédio

Adicionar seção em Configurações:

- nome exibido na sidebar;
- descrição;
- timezone padrão;
- idioma padrão.

Usar `PATCH /api/building` existente. Exibir sucesso/erro e impedir nome vazio.

### 14.2 Gerenciar andares

Tela ou seção:

- criar;
- editar nome/missão/descrição/cor/ícone/fuso;
- reordenar;
- arquivar/restaurar;
- mostrar contagens antes de arquivar;
- impedir arquivar o último andar ativo sem orientação explícita.

Arquivar não pode apagar agentes, setores, automações ou histórico.

### 14.3 Nome padrão

Não mostrar eternamente “Meu prédio” como identidade final sem contexto. Durante onboarding ou em Configurações, incentivar:

> “Como você quer chamar seu espaço?”

Exemplos: nome da empresa, marca ou nome pessoal.

---

## 15. Componentes e organização de código

Componentes sugeridos:

- `BuildingProvider` / `useBuildingContext`;
- `AppShell`;
- `BuildingSwitcher`;
- `FloorSwitcherPopover`;
- `DesktopSidebar`;
- `MobileDrawer`;
- `MobileBottomNav`;
- `Breadcrumbs`;
- `FloorHeader`;
- `FloorNav`;
- `BuildingOverviewCards`;
- `FloorCard`;
- `OperationalSummary`;
- `RecentRuns`;
- `RecentArtifacts`.

### 15.1 Configuração única de navegação

Criar metadados:

```ts
type NavScope = 'global' | 'floor'

interface NavItem {
  key: string
  label: string
  icon: string
  scope: NavScope
  path: (ctx: { floorId?: string }) => string
  activePatterns: string[]
  mobilePrimary?: boolean
  featureFlag?: keyof FeatureFlags
}
```

Desktop, drawer e bottom nav devem derivar dessa fonte, com filtragem apropriada. Não usar o mesmo `NAV.map()` bruto para todas as superfícies.

### 15.2 Data hooks

Substituir `useAgentsAndWidgets()` nas páginas de andar por hooks focados:

- `useFloorAgents(floorId)`;
- `useFloorSectors(floorId)`;
- `useFloorAutomations(floorId)`;
- `useFloorOverview(floorId)`.

Widgets/canais podem usar hook próprio. Evitar carregar widgets em todas as páginas de agentes e setores sem necessidade.

Usar AbortController ou proteção contra resposta atrasada ao trocar rapidamente de andar.

### 15.3 Erros

Não transformar erro de API em lista vazia silenciosamente. Diferenciar:

- loading;
- empty;
- error com retry;
- forbidden/not found;
- feature indisponível.

---

## 16. Visual e consistência

### 16.1 Preservar o design system

- reutilizar `Card`, `Button`, `Dialog`, `Select`, `Input`, `EmptyState`, `MetricStat`, `Icon` e tokens existentes;
- reduzir estilos inline novos quando um componente/tailwind existente resolver;
- não introduzir outra paleta ou tipografia;
- manter ilustrações e sprites atuais.

### 16.2 Densidade

- Dashboard: visão agregada e escaneável;
- andar: mapa dominante;
- listagens: toolbars simples;
- configurações: seções claras;
- evitar repetir o seletor de andar no corpo de todas as páginas.

### 16.3 Orientação espacial

Em qualquer página autenticada, o usuário deve conseguir responder visualmente:

1. Em qual prédio/conta estou?
2. Estou vendo tudo ou um andar?
3. Qual andar está ativo?
4. Em qual módulo estou?
5. Como volto para a visão geral?

Usar sidebar, breadcrumb, título e URL em conjunto, não apenas cor de item ativo.

### 16.4 Textos

Exemplos:

- “Meu prédio” → nome personalizado ou fallback da conta;
- “Escritório” → nome real do andar;
- “Sua equipe” → “Equipe deste andar”;
- “Runs (24h)” → “Execuções nas últimas 24h”;
- “Runs das suas automações” → “Histórico de execuções deste andar”;
- “Agentes que atendem juntos” → “Salas e especialidades deste andar”.

---

## 17. Compatibilidade e migração

### 17.1 Banco

Não renomear coleção `offices` nem campo `officeId` nesta etapa.

Continuar expondo `floorId` como alias público e usando `officeId` internamente onde necessário.

### 17.2 Dados existentes

- todos os agentes/setores legacy permanecem no andar default já associado;
- nenhum registro deve ser movido automaticamente por heurística;
- nenhuma automação muda de andar;
- nenhum widget/WhatsApp é recriado;
- nenhum histórico é apagado.

### 17.3 Frontend rollout

Evitar manter a UX nova e antiga ligadas simultaneamente. Quando a nova experiência passar nos gates:

- `/dashboard` recebe a nova visão geral;
- `/building` vira redirect;
- antigo conteúdo de `Dashboard` migra para `FloorOverview`;
- label “Escritório” sai do NAV;
- flags devem habilitar o conjunto coerente, não peças contraditórias.

Se necessário, criar flag única temporária `VITE_AI_NAVIGATION_V2` para trocar o shell completo de forma atômica. Não expor metade da arquitetura.

### 17.4 Backend compatibility

- `floorId` opcional em endpoints legacy durante transição;
- novo frontend sempre envia;
- log deprecation sem dados sensíveis;
- remover fallback apenas em versão posterior e documentada.

---

## 18. Fases de implementação

### Fase 0 — Baseline visual e técnico

- Confirmar `origin/development` atual e status limpo.
- Registrar commit-base.
- Ler o relatório do pivot e arquivos alterados após `7ca6a81`.
- Executar build, lint e testes atuais na ordem correta.
- Subir stack local com Mongo/Redis/worker se disponível.
- Capturar screenshots das rotas atuais em desktop e mobile.
- Registrar os problemas preexistentes sem confundi-los com regressões.

**Gate:** baseline reproduzível e inventário de rotas/dados.

### Fase 1 — Escopo de backend por andar

- Adicionar filtro/validação `floorId` a Agents/Sectors/stats.
- Expor `floorId` em DTOs.
- Criar agentes/setores no andar enviado.
- Validar membros do setor no mesmo andar.
- Criar overview agregado do prédio e do andar.
- Adicionar testes de ownership e cross-floor.
- Manter fallback legacy.

**Gate:** dois andares nunca misturam listas; criação cai no andar correto.

### Fase 2 — Contexto global e rotas canônicas

- Criar BuildingProvider.
- Tornar URL fonte de verdade.
- Implementar rotas aninhadas/canônicas.
- Implementar redirects legacy.
- Atualizar links internos e breadcrumbs.
- Evitar loops de redirect e refetch duplicado.

**Gate:** refresh/deep link preserva andar/módulo e links antigos continuam funcionando.

### Fase 3 — Novo shell e sidebar

- BuildingSwitcher.
- popover de andares.
- sidebar agrupada.
- estado expandido/recolhido.
- conta no rodapé.
- active patterns corretos.
- settings do prédio acessíveis.
- acessibilidade de teclado/foco.

**Gate:** usuário navega Dashboard → andar → módulo → outro andar sem perder orientação.

### Fase 4 — Dashboard geral

- Substituir página Building e Dashboard antigo pela visão geral.
- Implementar KPIs, cards de andares, alerts, recent runs/artifacts.
- Criar/editar prédio e CTA de andar.
- Empty/error/loading completos.
- `/building` redireciona.

**Gate:** não existe item/página “Prédio” vazia nem “Escritório” concorrente.

### Fase 5 — Visão real do andar

- Mover mapa para Floor Overview.
- Buscar agentes/setores filtrados.
- Passar `floorId` ao mapa e live status.
- Integrar métricas/atividade/ações úteis.
- Mover arquivamento para gerenciamento.
- Preservar toda simulação atual.

**Gate:** trocar andar troca claramente salas, agentes, mapa e dados operacionais.

### Fase 6 — Páginas filhas

- Agentes scoped.
- Setores scoped.
- Automações scoped e editor canônico.
- Execuções scoped e traduzidas.
- Entregáveis scoped ou ocultos até prontos.
- Canais/Conversas mostram andar derivado sem falso ownership.

**Gate:** toda criação/listagem/detalhe respeita o andar da URL.

### Fase 7 — Mobile

- bottom nav com no máximo cinco destinos;
- drawer completo e agrupado;
- floor switcher acessível;
- overflow de ações;
- safe areas;
- testar 320, 360, 390, 430px e tablet.

**Gate:** nenhum label esmagado, overflow horizontal ou destino inacessível.

### Fase 8 — QA, limpeza e documentação

- E2E de hierarquia e scoping.
- visual regression/screenshot matrix.
- testes de redirects.
- testes cross-owner e cross-floor.
- remover componentes/rotas duplicados somente após confirmação.
- atualizar README e relatório.
- atualizar feature flags para rollout atômico.

**Gate:** critérios globais completos e nenhuma regressão no pivot/módulos antigos.

---

## 19. Testes obrigatórios

### 19.1 Unitários

- resolução do andar pela URL/storage/fallback;
- geração de rotas por escopo;
- active state de nav em detalhes;
- troca preservando módulo;
- fallback quando andar foi arquivado;
- filtros de repository por `officeId`;
- serialização `floorId`;
- validação de agente/setor cross-floor;
- agregação do building overview;
- `useAgentStates` usando floorId explícito.

### 19.2 Integração backend

Criar owner A com dois andares e owner B:

- listar agentes de A/andar 1 não retorna andar 2;
- criar agente no andar 2 grava `officeId` correto;
- criar setor no andar 2 grava correto;
- tentar adicionar agente do andar 1 ao setor do andar 2 falha;
- owner B não acessa floors/agents/sectors de A;
- overview retorna contagens corretas;
- endpoints legacy sem floor mantêm comportamento documentado;
- automation/run/artifact continuam scoping correto.

### 19.3 Componentes

- sidebar expandida/recolhida;
- popover abre/fecha/foco/Escape;
- BuildingSwitcher com nomes longos;
- estados sem andar, um andar e muitos andares;
- archived floors;
- mobile drawer;
- breadcrumbs;
- cards e skeletons;
- erro/retry.

### 19.4 E2E funcional

Fluxo principal:

1. login legacy;
2. abre Dashboard geral;
3. não vê itens concorrentes “Prédio” e “Escritório”;
4. cria Marketing e Pesquisa;
5. abre Marketing;
6. cria agente e setor;
7. cria automação;
8. troca para Pesquisa;
9. Marketing não aparece nas listas/mapa de Pesquisa;
10. cria agente de Pesquisa;
11. volta para Marketing;
12. dados reaparecem corretamente;
13. refresh mantém rota/contexto;
14. link antigo `/agents/:id` redireciona para floor correto;
15. Canais/Conversas continuam acessíveis;
16. widget público continua funcionando.

### 19.5 E2E mobile

- barra inferior possui no máximo cinco itens;
- Mais abre drawer;
- troca de andar pelo drawer;
- títulos e ações não colidem;
- mapa utilizável/scroll correto;
- nenhum overflow horizontal em todas as rotas novas;
- back navigation coerente.

### 19.6 Regressão

- build frontend/backend;
- typecheck;
- lint;
- todos testes atuais;
- suíte de 58+ testes frontend;
- suíte backend completa após build;
- testes do office/pathfinding/sprites;
- responsive E2E existente;
- pivot E2E com Mongo+Redis+worker;
- chat/widget/WhatsApp/Socket.IO;
- Docker builds quando disponível.

Não considerar o E2E “guardado e pulado” como validação executada. Para fechar este plano, rodar o cenário com `E2E_PIVOT=1` e infraestrutura real de teste.

---

## 20. Critérios globais de aceite

- [ ] Sidebar não mostra “Prédio” e “Escritório” como páginas paralelas.
- [ ] `/dashboard` é a única visão geral do prédio.
- [ ] `/building` redireciona para Dashboard.
- [ ] Cada andar possui uma visão própria com o mapa visual.
- [ ] Nome do prédio/empresa aparece no cabeçalho da sidebar e é editável.
- [ ] Popover lista andares e permite navegar/criar/gerenciar.
- [ ] Andar ativo aparece de forma persistente.
- [ ] URL define o andar em páginas scoped.
- [ ] Sidebar agrupa Geral, Andar e Comunicação.
- [ ] Desktop não depende somente de hover para legibilidade.
- [ ] Mobile possui no máximo cinco ações primárias.
- [ ] Agentes são listados/criados no andar correto.
- [ ] Setores são listados/criados no andar correto.
- [ ] Setor não aceita agente de outro andar.
- [ ] Automações, execuções e entregáveis respeitam o andar.
- [ ] Mapa recebe agentes/setores/status do andar visível.
- [ ] Canais e Conversas continuam funcionando.
- [ ] Links antigos redirecionam sem quebrar.
- [ ] Nenhum dado existente é movido/apagado.
- [ ] `offices/officeId` permanecem compatíveis.
- [ ] Empty/loading/error states orientam o usuário.
- [ ] Terminologia portuguesa está consistente.
- [ ] 320px até desktop foi testado.
- [ ] Cross-floor e cross-owner foram testados.
- [ ] Build, lint, unit, integração e E2E passam.
- [ ] Relatório final possui screenshots e resultados exatos.

---

## 21. Não escopo desta etapa

- duplicar/copiar agentes entre andares;
- agente único pertencendo fisicamente a vários andares;
- múltiplos prédios por conta;
- RBAC/múltiplos usuários;
- novo canvas de automação;
- novas integrações;
- mudança do worker/scheduler além do necessário para filtros/UX;
- refazer sprites ou simulação;
- deploy em produção;
- renomear coleção Mongo `offices`;
- apagar feature flags sem validação.

Não usar sugestões futuras como justificativa para ampliar esta implementação.

---

## 22. Estratégia de commits

Sugestão:

1. `chore(ux): capture navigation and floor-scoping baseline`
2. `feat(api): scope agents and sectors by floor`
3. `test(api): cover cross-floor ownership and creation`
4. `feat(shell): add global building and floor context`
5. `refactor(routes): introduce canonical floor-scoped navigation`
6. `feat(nav): add building switcher and dynamic desktop sidebar`
7. `feat(nav): simplify mobile navigation and floor drawer`
8. `feat(dashboard): unify building overview`
9. `feat(floor): make visual office the floor overview`
10. `refactor(agents): scope roster and details to active floor`
11. `refactor(sectors): scope rooms and members to active floor`
12. `refactor(automations): scope automations and runs routes`
13. `feat(artifacts): add floor deliverables view`
14. `refactor(channels): show linked floor context`
15. `test(ux): add hierarchical navigation and responsive e2e`
16. `docs(ux): document information architecture and QA results`

Commits pequenos, compiláveis e reversíveis. Não misturar todo o shell, APIs e mapa num único commit.

---

## 23. Rollback

- Manter redirects e aliases.
- Alterações de banco são aditivas/queries, sem migration destrutiva.
- Feature flag única de shell pode restaurar navegação anterior temporariamente.
- Preservar componentes antigos até novo shell passar E2E; remover depois em commit separado.
- Se mapa scoped falhar, desativar apenas integração de overview, não automações/backend.
- Não usar `git reset --hard`, apagar coleção ou recriar dados.

Documentar no relatório:

- como desligar shell v2;
- como voltar rotas;
- como verificar scoping do banco;
- como reativar componentes antigos durante rollback temporário.

---

## 24. Documentação e relatório final

Criar:

- `AI_BUILDING_UX_NAVIGATION_REORGANIZATION_REPORT.md`;
- atualização do README;
- documento curto da arquitetura de informação;
- mapa de redirects legados;
- screenshots desktop/mobile.

O relatório deve incluir:

- branch e commit-base real;
- commits criados;
- rotas antes/depois;
- componentes removidos/substituídos;
- alterações de API;
- como o floorId é validado;
- resultados exatos de testes;
- screenshots de Dashboard, andar, agentes, automações, sidebar e mobile;
- pendências reais;
- flags e estado;
- git status final;
- nenhuma afirmação de teste não executado.

---

## 25. Regras de execução para Claude Code

1. Ler este plano inteiro antes de editar.
2. Atualizar `development` e confirmar alterações remotas.
3. Preservar alterações existentes e nunca sobrescrever trabalho do usuário silenciosamente.
4. Implementar na ordem das fases e respeitar gates.
5. Priorizar correção da arquitetura da informação, não adicionar features futuras.
6. Usar a URL como fonte de verdade para andar.
7. Não construir uma sidebar bonita sobre APIs ainda misturadas; corrigir scoping primeiro.
8. Não manter Prédio/Escritório/Andar como destinos paralelos.
9. Não remover widget, WhatsApp, conversas ou comportamento conversacional.
10. Não alterar o motor visual além do necessário para receber o andar correto.
11. Não renomear `offices/officeId` fisicamente.
12. Não mover dados automaticamente.
13. Não fazer deploy, alterar DNS ou produção.
14. Usar mocks para serviços externos.
15. Rodar testes após cada fase.
16. Corrigir regressões antes de avançar.
17. Não marcar E2E pulado como aprovado.
18. Não esconder erros de API como empty state.
19. Não colocar mais de cinco itens na bottom nav.
20. Não implementar duplicação de agentes nesta etapa.
21. Continuar até concluir todos os critérios ou encontrar bloqueio real que exija acesso, segredo ou decisão irreversível.
22. Ao finalizar, produzir relatório completo, screenshots, testes exatos e git status.

---

## 26. Definição de pronto

Esta etapa estará pronta quando uma pessoa nova conseguir entrar e compreender, sem explicação externa:

1. o Dashboard mostra todo o prédio;
2. o seletor mostra seus andares;
3. abrir Marketing mostra o mapa, agentes, salas e operação de Marketing;
4. trocar para Pesquisa muda todo o contexto de forma visível e correta;
5. Agentes, Setores, Automações, Execuções e Entregáveis pertencem claramente ao andar;
6. Canais e Conversas permanecem como áreas gerais;
7. nenhum dado de outro andar aparece ou é criado por engano;
8. desktop e mobile mantêm orientação espacial;
9. o antigo “Prédio vazio” e o “Escritório paralelo” deixam de existir;
10. todos os testes e regressões estão comprovados.

O resultado final deve parecer um único produto coerente: um Dashboard geral e vários andares operacionais — não páginas novas adicionadas ao lado do sistema antigo.

