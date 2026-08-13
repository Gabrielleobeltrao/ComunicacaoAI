# ComunicacaoAI — Plano de paridade visual e navegacional no mobile

## 1. Identificação do plano

- Projeto: `Gabrielleobeltrao/ComunicacaoAI`
- Objetivo: levar ao mobile a experiência atual do prédio operacional, com a mesma hierarquia, contexto de andar e capacidade de navegação disponíveis no desktop.
- Branch remota usada como referência visual atual: `origin/main`.
- Commit auditado: `2cb1e48` (`fix(office-map): native touch panning on mobile`).
- Branch `origin/development` auditada: `7ca6a81`; está atrás da `main` e não contém as mudanças visuais mais recentes.
- Natureza da mudança: frontend, responsividade, navegação, rotas e configuração pública de build do frontend.
- Não fazer deploy neste plano.
- Não alterar DNS, banco de dados, autenticação, worker, filas ou comportamento das automações.

---

## 2. Contrato de execução para o Claude Code

Antes de editar qualquer arquivo:

1. Ler este plano inteiro.
2. Executar `git status`, `git branch -vv`, `git fetch --all --prune` e `git log --oneline --decorate -20`.
3. Preservar qualquer alteração local do usuário.
4. Confirmar que a base contém o commit `2cb1e48` ou um descendente dele.
5. Não iniciar a implementação sobre a `development` antiga (`7ca6a81`) sem antes trazer, de forma segura, o estado atual da `main`.
6. Preferir criar uma branch de trabalho a partir da `main` atual, por exemplo `fix/mobile-building-parity`.
7. Se a `main` remota tiver avançado, auditar os commits novos e adaptar o plano ao código mais recente, sem apagar decisões visuais do usuário.
8. Não fazer `reset --hard`, não sobrescrever `.env`, não apagar dados e não fazer push forçado.
9. Implementar por fases e executar o gate de validação de cada fase antes de seguir.
10. Continuar até atender todos os critérios de aceite ou encontrar um bloqueio real que dependa de decisão do usuário.

Este plano não pede uma cópia pixel a pixel do desktop. Ele pede paridade de informação, hierarquia, funções, identidade visual e entendimento, usando padrões adequados para telas de toque.

---

## 3. Estado atual confirmado no repositório

### 3.1 O que já existe

O código atual já possui parte da estrutura mobile:

- `AppLayout.tsx` tem topbar mobile, botão de menu e reserva para a barra inferior.
- `MobileNav.tsx` tem barra inferior e drawer lateral.
- `BuildingContext.tsx` usa a URL como fonte de verdade para o andar ativo.
- `BuildingSwitcher.tsx` permite trocar de andar no desktop.
- `OfficeMap.tsx` já usa rolagem nativa para pan por toque.
- O mapa, agentes, setores, automações e execuções já possuem rotas por andar.
- A `main` contém as mudanças recentes de cards de setores e mapa.

Portanto, não reconstruir o shell do zero e não restaurar a UX anterior.

### 3.2 Problemas concretos encontrados

#### A. Troca de andar está escondida no mobile

No telefone, o usuário precisa:

1. descobrir o botão hambúrguer;
2. abrir o drawer;
3. descobrir que o cartão do prédio é clicável;
4. abrir outro popover;
5. só então escolher o andar.

Essa é a função que define todo o contexto do produto e não pode ficar escondida em dois níveis.

#### B. O componente de desktop foi reaproveitado em um contexto inadequado

`MobileNav.tsx` renderiza `<BuildingSwitcher expanded />` dentro de um drawer com `overflow-y: auto`. O switcher abre um popover absoluto, pensado para desktop. Isso cria uma interação aninhada pouco evidente e sujeita a recorte, sobreposição, problemas de foco e fechamento inesperado.

#### C. A barra inferior não oferece uma hierarquia móvel completa

Hoje os itens primários dependem de `mobilePrimary` e resultam em poucos destinos mais “Mais”. A experiência deve ser estável e previsível: andar, agentes, setores, automações e menu adicional.

#### D. Algumas páginas ainda usam rotas globais antigas

Exemplos confirmados:

- `Automations.tsx` liga para `/runs` e `/automations/:id`.
- `AutomationEditor.tsx` volta para `/automations` e navega para `/runs`.
- detalhes de agente e setor ainda usam caminhos globais em diversas ações.
- `Automations.tsx` cria outra instância de `useFloors()` em vez de usar apenas o contexto global do prédio.

Os redirects escondem parte do problema, mas provocam saltos, perda de contexto e comportamento confuso ao trocar de andar, principalmente no mobile.

#### E. Os testes responsivos ainda validam a arquitetura antiga

`frontend/e2e/responsive.spec.ts` navega principalmente por:

- `/dashboard`
- `/agents`
- `/setores`
- `/widgets`
- `/chats`
- `/settings`

Ele não prova:

- troca de andar pelo telefone;
- preservação do módulo ao trocar de andar;
- isolamento dos dados entre dois andares;
- rotas canônicas `/floors/:floorId/*`;
- retorno correto de detalhes;
- comportamento com drawer, seletor e teclado virtual;
- build de produção com as flags habilitadas.

#### F. As evidências visuais estão desatualizadas

As screenshots em `docs/ux-nav/screenshots/mobile-*` representam um estado intermediário. Por exemplo, algumas ainda exibem o bloco “PRÉDIO”, removido depois da tela do andar. Não usá-las como prova do estado final.

#### G. Há risco real de o build publicado não conter a nova UX

As flags Vite são avaliadas no build e ficam embutidas no JavaScript. Atualmente:

- `frontend/src/featureFlags.ts` exige `VITE_AI_BUILDING_ENABLED=true` para mostrar a nova navegação;
- `frontend/.env.production.example` só documenta `VITE_API_URL`;
- `frontend/Dockerfile` declara apenas `ARG VITE_API_URL` e `ENV VITE_API_URL`;
- as flags ficam desligadas por padrão.

Variáveis Vite colocadas apenas em runtime no Coolify não alteram um bundle já construído. Essa diferença pode explicar por que o desktop local mostra a experiência nova e o telefone, acessando o deploy, mostra a antiga.

---

## 4. Objetivo de produto

No mobile, o usuário deve entender imediatamente:

1. em qual prédio está;
2. em qual andar está;
3. qual módulo do andar está aberto;
4. como trocar de andar;
5. como voltar à visão do andar;
6. como chegar a agentes, setores, automações, execuções, canais e conversas.

A troca de andar deve estar disponível em um único toque a partir de qualquer rota pertencente a um andar.

Ao selecionar outro andar:

- a URL precisa mudar;
- o nome do andar precisa mudar sem atraso enganoso;
- os dados precisam ser recarregados no escopo correto;
- o usuário deve permanecer no mesmo módulo quando isso fizer sentido;
- detalhes específicos não devem ser carregados no outro andar por engano.

---

## 5. Hierarquia que deve aparecer no mobile

```text
Prédio / conta
└── Andar ativo
    ├── Visão do andar
    ├── Agentes
    ├── Setores
    ├── Automações
    └── Execuções

Áreas globais
├── Canais
├── Conversas
└── Configurações
```

Não criar novamente páginas paralelas chamadas “Prédio”, “Escritório” e “Andar”. O andar continua sendo a página visual com o mapa do escritório. O prédio é o contexto superior, não um destino vazio.

---

## 6. Experiência mobile alvo

### 6.1 Topbar em rotas de andar

Nas rotas `/floors/:floorId` e `/floors/:floorId/*`, a topbar mobile deve mostrar um acionador de contexto de andar visível e tocável.

Conteúdo mínimo do acionador:

- ponto ou pequeno avatar com a cor do andar;
- nome do andar atual;
- chevron indicando que há opções;
- `aria-label="Trocar andar. Andar atual: <nome>"`;
- área de toque mínima de 44 × 44 px.

O módulo atual deve continuar claro, por exemplo:

- linha de contexto: `Marketing` com chevron;
- título da tela: `Agentes`, `Setores`, `Automações` ou `Visão do andar`.

Em telas muito estreitas, truncar o nome com ellipsis sem esconder o título do módulo nem as ações essenciais.

### 6.2 Seletor de andar próprio para mobile

Criar um componente específico, por exemplo:

- `MobileFloorPicker.tsx`; ou
- `FloorSwitcherSheet.tsx`.

Não reaproveitar o popover absoluto de desktop dentro do drawer.

O seletor deve abrir como bottom sheet ou dialog adaptado ao telefone:

- cabeçalho “Trocar de andar”;
- nome do prédio como contexto secundário;
- andar atual marcado com check;
- lista de andares ativos com cor, nome e missão curta quando disponível;
- andares arquivados ocultos por padrão ou claramente desabilitados;
- estado de carregamento;
- estado de erro com botão “Tentar novamente”;
- estado vazio com ação para configurar/criar o primeiro andar;
- botão de fechar;
- suporte a Escape, clique no overlay e foco preso no dialog;
- safe areas de iPhone;
- lista rolável sem mover o conteúdo atrás;
- seleção por toque em uma única linha de pelo menos 48 px.

Se houver muitos andares, incluir busca somente a partir de um limite razoável, por exemplo oito itens. Não poluir a interface com busca quando há poucos andares.

### 6.3 Regra ao selecionar outro andar

Centralizar a regra em uma função e cobri-la por testes:

| Rota atual | Ao escolher outro andar |
|---|---|
| `/floors/A` | `/floors/B` |
| `/floors/A/agents` | `/floors/B/agents` |
| `/floors/A/sectors` | `/floors/B/sectors` |
| `/floors/A/automations` | `/floors/B/automations` |
| `/floors/A/runs` | `/floors/B/runs` |
| detalhe de agente | raiz de agentes do andar B |
| detalhe de setor | raiz de setores do andar B |
| editor de automação | raiz de automações do andar B |
| rota global | visão do andar B, salvo quando o produto definir explicitamente outra ação |

Nunca carregar um ID de entidade do andar A dentro da URL do andar B.

Depois da seleção:

1. fechar o sheet;
2. fechar o drawer, se estiver aberto;
3. navegar para a rota canônica;
4. mover o foco para o título principal;
5. exibir skeleton/loading do novo andar;
6. não mostrar dados antigos como se pertencessem ao novo andar.

### 6.4 Drawer mobile

O drawer deve ser simples, sem um popover dentro de outro popover.

Estrutura proposta:

1. marca do produto e fechar;
2. cartão do prédio;
3. linha explícita `Andar atual: <nome>`;
4. botão visível `Trocar de andar`;
5. grupo `ANDAR · <NOME>`;
6. grupo `COMUNICAÇÃO`;
7. conta, configurações e sair.

O clique no nome do andar ou em “Trocar de andar” abre o mesmo `MobileFloorPicker`. A lógica e a lista não devem ser duplicadas.

### 6.5 Barra inferior

Quando `aiBuilding` estiver habilitada e existir andar ativo, usar cinco slots estáveis:

1. Andar;
2. Agentes;
3. Setores;
4. Automações;
5. Mais.

Regras:

- `Execuções`, `Canais`, `Conversas` e `Configurações` ficam no drawer.
- Se automações estiverem desabilitadas por feature flag, remover o item sem deixar buraco e promover um destino válido definido por `navConfig`.
- Não renderizar mais de cinco slots.
- Rótulos curtos e legíveis em 320 px.
- Estado ativo baseado na URL canônica, não na prop legada `current`.
- A barra deve respeitar `safe-area-inset-bottom`.
- O conteúdo nunca deve ficar escondido atrás dela.
- Teclado virtual e dialogs não devem deixar duas navegações sobrepostas.

### 6.6 Rotas globais

Em `Canais`, `Conversas` e `Configurações`, manter o prédio visível como contexto. A troca de andar pode continuar disponível no drawer, mas não deve dar a falsa impressão de que canais globais pertencem exclusivamente ao andar selecionado.

Usar rótulos claros:

- `Canais · Prédio` ou descrição equivalente;
- `Conversas · Todos os canais`, quando os dados forem globais;
- evitar mostrar `ANDAR · X` como se filtrasse dados que a API não filtra.

---

## 7. Arquitetura de componentes

### 7.1 Manter uma única fonte de verdade

`BuildingProvider` deve continuar como fonte única para:

- prédio;
- lista de andares;
- andar ativo;
- carregamento;
- erro;
- recarregamento;
- seleção de andar.

Não criar outra chamada `useFloors()` em páginas quando `BuildingContext` estiver ativo.

### 7.2 Extrair helpers de rota

Criar um módulo tipado, por exemplo `frontend/src/lib/floorRoutes.ts`, com helpers:

- `floorHome(floorId)`;
- `floorAgents(floorId)`;
- `floorAgent(floorId, agentId, section?)`;
- `floorSectors(floorId)`;
- `floorSector(floorId, sectorId, section?)`;
- `floorAutomations(floorId)`;
- `floorAutomation(floorId, automationId)`;
- `floorRuns(floorId)`;
- `switchFloorPath(pathname, nextFloorId)`.

Substituir strings soltas nas telas afetadas. Manter redirects legados apenas para bookmarks antigos, não como fluxo normal da UI nova.

### 7.3 Separar os padrões desktop e mobile

- `BuildingSwitcher.tsx`: manter para desktop/rail.
- `MobileFloorPicker.tsx`: novo padrão touch.
- `MobileFloorTrigger.tsx`: acionador compacto da topbar.
- `MobileNav.tsx`: drawer e barra inferior.
- `AppLayout.tsx`: coordena abertura do drawer e do seletor.

Compartilhar dados e callbacks, mas não forçar o mesmo layout de popover nos dois ambientes.

### 7.4 Estado de overlays

`AppLayout` ou um controlador de navegação mobile deve manter:

- `drawerOpen`;
- `floorPickerOpen`.

Nunca deixar os dois overlays interativos simultaneamente. Ao abrir o seletor pelo drawer, fechar ou suspender corretamente o drawer antes de apresentar o sheet.

Bloquear scroll do body enquanto qualquer overlay estiver aberto e restaurar exatamente o valor anterior ao fechar/desmontar.

### 7.5 URL inválida ou andar indisponível

Hoje o contexto pode resolver um fallback enquanto a URL ainda carrega um `floorId` inválido. Corrigir a experiência:

- se o andar da URL não existir, estiver fora da conta ou estiver arquivado, não exibir dados de outro andar sob aquela URL;
- mostrar estado de erro/indisponível ou redirecionar de forma explícita ao andar ativo;
- usar `replace` para não criar loop no histórico;
- cobrir por teste.

---

## 8. Correções de navegação necessárias

### 8.1 Automações

Em `Automations.tsx`:

- usar `useBuildingContext()` quando a navegação V2 estiver ativa;
- usar o `floorId` da URL como autoridade;
- remover o elevador legado da rota canônica;
- criar automação no andar da URL;
- corrigir o `disabled` do botão para usar o `floorId` efetivo;
- ligar cards para `/floors/:floorId/automations/:id`;
- ligar Execuções para `/floors/:floorId/runs`;
- mostrar erro real de carregamento em vez de transformar toda falha em lista vazia.

Em `AutomationEditor.tsx`:

- ler `floorId` da rota;
- voltar à lista canônica daquele andar;
- navegar à execução canônica daquele andar;
- empilhar ações e campos adequadamente no telefone;
- não alterar o motor da automação nem o formato da definição.

### 8.2 Agentes

- links de cards e detalhes devem preservar o `floorId`.
- ao excluir, voltar para `/floors/:floorId/agents`.
- colegas, setores associados e seletores devem usar agentes do mesmo andar.
- o botão de contratar deve mostrar somente ícone em larguras em que o texto colidir com a topbar, mantendo `aria-label`.
- a busca e filtros devem empilhar em 320 px.

### 8.3 Setores

- links de cards e detalhes devem preservar o `floorId`.
- ao excluir, voltar para `/floors/:floorId/sectors`.
- links internos para agentes devem apontar para o mesmo andar.
- o carregamento de agentes do detalhe deve ser filtrado pelo andar quando a API suportar o filtro já existente.
- não alterar o algoritmo do recorte visual nem a simulação dos cards.

### 8.4 Execuções

- recarregar quando `floorId` mudar; hoje o effect inicial não depende do andar.
- separar visualmente status, gatilho, data e ações em telas estreitas.
- permitir quebra de texto em erros e nomes longos.
- manter timeline legível sem overflow horizontal.

### 8.5 Canais, conversas e configurações

- manter como áreas globais.
- verificar tabs, formulários, cards, códigos copiáveis, painéis de conversa e ações em 320 px.
- não filtrar dados globalmente por andar sem decisão de produto e suporte de backend.

---

## 9. Passagem responsiva tela por tela

### 9.1 Shell geral

- validar 320, 360, 390, 412 e 768 px de largura;
- topbar sem colisão entre menu, contexto, título e ações;
- títulos longos truncados com acesso ao nome completo;
- conteúdo com gutter de 16 px no telefone;
- nenhuma rolagem horizontal acidental na página;
- foco visível;
- alvos de toque de pelo menos 44 px.

### 9.2 Visão do andar e mapa

Preservar o visual atual, personagens e inteligência da simulação.

No mobile:

- pan nativo em dois eixos deve continuar funcionando;
- scroll vertical da página deve continuar possível fora do mapa;
- controles de pausar, retornar às mesas, nomes, tela cheia e zoom devem ficar acessíveis;
- controles não podem ficar atrás da barra inferior;
- tela cheia deve respeitar notch e home indicator;
- o mapa deve iniciar enquadrado em uma região útil do escritório;
- mudança de orientação não pode deixar dimensões antigas;
- ao trocar de andar, reinicializar câmera/simulação do novo andar sem mostrar agentes do anterior;
- preservar preferências de labels/pausa somente se isso for intencional e testado.

### 9.3 Agentes

- cards em uma coluna no telefone;
- busca ocupa a linha inteira;
- filtro fica abaixo ou como botão compacto;
- modal de criação vira dialog quase fullscreen/bottom sheet no telefone;
- formulário sem campos lado a lado abaixo de 640 px;
- ações principais sempre acessíveis com teclado aberto.

### 9.4 Setores

- cards em uma coluna;
- recorte do mapa mantém proporção e não força largura mínima;
- métricas internas não espremem texto;
- hover não pode ser requisito para iniciar ou compreender interação no touch;
- se houver interação exclusiva de hover no desktop, fornecer comportamento touch seguro ou deixar a animação automática visível.

### 9.5 Automações e editor

- campo de nome e botão Criar empilham em 320 px;
- cards quebram nome/status sem overflow;
- editor usa campos com largura `100%`;
- grupo de ações pode quebrar linha;
- ação principal deve permanecer clara;
- teclado virtual não cobre o campo ativo nem a ação necessária;
- manter rotas por andar em todos os links.

### 9.6 Execuções

- cada run vira card vertical em telas estreitas;
- cancelar/atualizar continuam acessíveis;
- erros longos usam wrap;
- timeline não depende de hover;
- destaque via query string continua funcionando.

### 9.7 Detalhes de agentes e setores

- abas roláveis horizontalmente com indicador visual de continuidade;
- não esconder badges essenciais apenas por estarem em `titleExtra` com `sm:hidden`;
- mover badges importantes para o corpo ou resumo mobile;
- cards laterais do desktop entram numa ordem lógica no telefone;
- links de retorno respeitam o andar;
- ações destrutivas permanecem no final e exigem confirmação.

### 9.8 Canais

- tabs roláveis ou compactas;
- painéis usam padding menor no telefone;
- snippets têm rolagem própria;
- botões de copiar são tocáveis;
- formulários de widget/WhatsApp não ultrapassam o viewport.

### 9.9 Conversas

- manter o padrão lista → conversa já existente;
- botão voltar deve funcionar no telefone;
- compositor não fica atrás da barra inferior nem do teclado;
- altura deve usar `dvh` e safe area;
- não renderizar simultaneamente lista e conversa espremidas em 320 px.

### 9.10 Configurações

- seções e cartões em uma coluna;
- inputs, chaves e botões sem overflow;
- dados sensíveis continuam mascarados;
- não incluir nenhum segredo em variável `VITE_*`.

---

## 10. Configuração de build e paridade entre computador e telefone

Esta fase é obrigatória porque o usuário acessa o telefone pelo ambiente publicado.

### 10.1 Dockerfile do frontend

Declarar como `ARG` e repassar como `ENV` no estágio de build somente as flags públicas que o produto realmente usa:

- `VITE_AI_BUILDING_ENABLED`;
- `VITE_AI_FLOORS_ENABLED`;
- `VITE_AI_AUTOMATIONS_ENABLED`;
- `VITE_AI_SCHEDULER_ENABLED`;
- `VITE_AI_DELIVERIES_ENABLED`;
- `VITE_AI_OFFICE_LIVE_STATUS_ENABLED`.

Manter `VITE_API_URL`.

Não inserir secrets no frontend. Toda variável `VITE_*` é pública.

### 10.2 Template de produção

Atualizar `frontend/.env.production.example` com:

- URL de API atual;
- flags públicas e valores esperados;
- comentário explícito de que são build-time;
- instrução para rebuild depois de alterar.

Não copiar valores privados do `.env` do backend para o frontend.

### 10.3 Verificação de build

Executar um build de produção com as flags habilitadas e servir o `dist` localmente. Verificar no browser mobile emulado que:

- a rota canônica de andar existe;
- a barra inferior V2 aparece;
- o seletor de andar aparece;
- a UI antiga não é usada;
- a URL da API é a esperada;
- refresh profundo em `/floors/:id/agents` retorna a SPA, não 404.

Documentar exatamente quais variáveis devem ser marcadas como build variables no Coolify, mas não alterar nem fazer deploy no ambiente.

---

## 11. Acessibilidade e comportamento de toque

- `role="dialog"` e `aria-modal="true"` no seletor.
- nome acessível no acionador e nas linhas dos andares.
- andar atual com texto/check, não apenas cor.
- foco preso no sheet e restaurado ao acionador ao fechar.
- Escape fecha em desktop/tablet com teclado.
- overlay fecha sem acionar links abaixo.
- scroll do body bloqueado apenas durante overlay.
- respeitar `prefers-reduced-motion` nas transições do sheet/drawer.
- animações do escritório podem seguir as regras já existentes; não reescrever o motor.
- não depender de hover para ações essenciais.
- contraste e estado ativo devem seguir os tokens atuais.

---

## 12. Desempenho e consistência de dados

- não refazer a consulta de andares a cada abertura do seletor;
- usar o cache/estado do `BuildingProvider`;
- não manter duas instâncias independentes de lista/andar ativo;
- cancelar ou ignorar respostas de requests do andar anterior após uma troca rápida;
- usar keys por `floorId` quando necessário para reinicializar dados visuais;
- não exibir lista vazia quando houve erro de rede;
- diferenciar loading, vazio e erro;
- evitar layout shift grande na topbar ao resolver o andar;
- preservar o último andar válido em `localStorage` apenas como fallback; a URL continua soberana.

---

## 13. Plano de implementação por fases

### Fase 0 — Baseline e segurança de branch

1. Confirmar base atual da `main` e divergência da `development`.
2. Criar branch de trabalho a partir da base atual.
3. Rodar build, typecheck, lint e testes existentes antes das mudanças.
4. Registrar falhas preexistentes sem mascará-las.
5. Capturar screenshots baseline reais em 390 × 844:
   - visão do andar;
   - drawer fechado e aberto;
   - tentativa atual de troca de andar;
   - agentes;
   - setores;
   - automações.

Gate: nenhuma edição funcional antes de entender o baseline e confirmar a branch correta.

### Fase 1 — Rotas canônicas e contexto único

1. Criar helpers de rota por andar.
2. Exportar parser de rota em local único.
3. Remover strings antigas dos fluxos normais.
4. Corrigir automações, editor, runs, agentes e setores.
5. Corrigir troca de andar em listas e detalhes.
6. Corrigir URL de andar inválido.
7. Manter redirects legados.

Gate:

- trocar A → B preserva o módulo;
- detalhes voltam para a lista correta;
- nenhuma UI V2 navega deliberadamente por rota global antiga;
- typecheck e testes unitários passam.

### Fase 2 — Seletor de andar mobile

1. Criar trigger da topbar.
2. Criar sheet/dialog mobile.
3. Implementar estados loading/error/empty.
4. Implementar foco, safe area e scroll lock.
5. Integrar com `BuildingProvider`.
6. Remover `BuildingSwitcher` desktop de dentro do drawer mobile.

Gate:

- trocar de andar em no máximo dois gestos, preferencialmente um toque no trigger mais um toque no destino;
- sem popover aninhado;
- sem recorte do seletor;
- teste com dois andares passa.

### Fase 3 — Shell, drawer e barra inferior

1. Atualizar `AppLayout` para expor contexto e módulo.
2. Reorganizar drawer.
3. Fixar cinco slots estáveis na bottom nav.
4. Garantir estado ativo pela URL.
5. Ajustar topbar para 320 px.
6. Verificar rotas globais.

Gate:

- nenhum overflow horizontal em 320 px;
- bottom nav não cobre conteúdo;
- drawer fecha em navegação;
- contexto do andar permanece claro.

### Fase 4 — Paridade responsiva das páginas

Aplicar a matriz da seção 9, começando por:

1. visão do andar/mapa;
2. agentes;
3. setores;
4. automações/editor;
5. execuções;
6. detalhes;
7. canais;
8. conversas;
9. configurações.

Não redesenhar o desktop. Reusar tokens, cards, tipografia, cores, raios e ilustrações atuais.

Gate: cada tela passa em 320, 390, 412, 768 e 1440 px sem perda de função.

### Fase 5 — Mapa e toque

1. Revalidar pan nativo.
2. Testar zoom, fullscreen, pause, recall e labels.
3. Testar troca de orientação.
4. Testar troca rápida de andar.
5. Garantir que animações e sector cards não degradaram.

Gate: mapa controlável por toque e scroll da página preservado.

### Fase 6 — Build de produção

1. Corrigir `frontend/Dockerfile`.
2. Corrigir `.env.production.example`.
3. Fazer build com flags públicas habilitadas.
4. Servir `dist` e executar smoke mobile.
5. Documentar configuração de Coolify sem fazer deploy.

Gate: bundle de produção apresenta a mesma arquitetura visual validada localmente.

### Fase 7 — Testes automatizados e QA visual

1. Atualizar `responsive.spec.ts` para rotas canônicas.
2. Criar teste específico de troca de andar mobile.
3. Rodar suite com dois andares e dados distintos.
4. Capturar screenshots atuais.
5. Executar regressão desktop.

Gate: todos os critérios da seção 14 comprovados.

### Fase 8 — Relatório e handoff

Criar `AI_BUILDING_MOBILE_VISUAL_PARITY_REPORT.md` contendo:

- commit inicial e final;
- arquivos alterados;
- decisões de UX;
- mapa final de navegação;
- correções de rotas;
- configuração pública de build necessária;
- comandos executados e resultados;
- screenshots finais;
- pendências reais;
- instrução de rollback;
- declaração explícita de que não houve deploy.

---

## 14. Estratégia de testes

### 14.1 Unitários

Cobrir:

- geração de rotas por andar;
- `switchFloorPath` em home, listas e detalhes;
- cálculo dos cinco itens da barra inferior;
- item ativo por pathname;
- fallback quando automações estão desabilitadas;
- resolução de andar válido/inválido;
- preservação do módulo.

### 14.2 Componentes

Cobrir:

- trigger exibe nome e estado de loading;
- sheet lista andares;
- andar atual marcado;
- seleção chama navegação correta;
- erro permite retry;
- foco retorna ao fechar;
- drawer e sheet não ficam abertos juntos.

### 14.3 Playwright mobile

Criar ou atualizar spec com conta QA contendo no mínimo dois andares e agentes distintos.

Viewports mínimos:

- 320 × 568;
- 360 × 800;
- 390 × 844;
- 412 × 915;
- 768 × 1024;
- 1440 × 900 para regressão desktop.

Cenários obrigatórios:

1. login e resolução do andar ativo;
2. abrir seletor pela topbar;
3. trocar de A para B na visão do andar;
4. trocar de A para B em Agentes e permanecer em Agentes;
5. provar que agente exclusivo de A desaparece e agente exclusivo de B aparece;
6. trocar de andar dentro de detalhe e cair na lista do outro andar;
7. usar drawer e fechar após navegação;
8. navegar pelos cinco slots inferiores;
9. voltar/avançar do browser;
10. refresh em rota profunda;
11. andar inválido;
12. loading, erro e lista vazia;
13. ausência de overflow horizontal;
14. controles do mapa com touch targets ≥ 44 px;
15. teclado virtual em busca/formulários;
16. dialog sem conteúdo atrás rolando;
17. safe areas.

### 14.4 Build Docker

Testar imagem do frontend com todos os build args públicos necessários. O teste precisa abrir o bundle produzido, não apenas o Vite dev server.

### 14.5 Screenshots finais

Salvar novas evidências, com nomes que incluam `mobile-parity`, sem reutilizar imagens antigas:

- topbar com andar;
- seletor aberto com dois andares;
- visão do segundo andar;
- drawer;
- agentes;
- setores;
- automações;
- execução;
- conversa;
- tela de 320 px;
- regressão desktop.

---

## 15. Critérios de aceite

O plano só está concluído quando todos os itens abaixo forem verdadeiros:

1. A implementação parte da `main` visual atual ou de um descendente dela.
2. O mobile não volta ao design anterior.
3. O andar atual aparece claramente em todas as rotas por andar.
4. A troca de andar é acessível diretamente pela topbar mobile.
5. O seletor não é um popover desktop aninhado no drawer.
6. A seleção atual é marcada de forma textual/visual.
7. Ao trocar de andar, a URL muda para o `floorId` correto.
8. O módulo é preservado em listas.
9. IDs de detalhes não atravessam andares.
10. Agentes e setores não vazam entre andares.
11. A bottom nav tem no máximo cinco slots e é estável.
12. O drawer apresenta prédio, andar, módulos e áreas globais com hierarquia clara.
13. Nenhuma ação essencial depende de hover.
14. O mapa continua animado e controlável por toque.
15. Pause, retorno às mesas, labels, fullscreen e zoom continuam funcionando.
16. Nenhuma tela canônica tem overflow horizontal em 320 px.
17. Conteúdo e ações não ficam atrás da barra inferior.
18. Dialogs e formulários funcionam com teclado virtual.
19. Rotas internas da UX nova são canônicas; redirects ficam apenas como compatibilidade.
20. `useFloors()` duplicado não governa páginas V2.
21. Erro de API não aparece como falso estado vazio.
22. O build Docker recebe as flags Vite no estágio de build.
23. O bundle de produção testado exibe a navegação V2.
24. Nenhum secret foi colocado no frontend.
25. Typecheck, lint, testes unitários, E2E relevante e build passam.
26. Regressão desktop passa.
27. Screenshots representam o commit final.
28. O relatório final foi criado.
29. Nenhum deploy foi feito.

---

## 16. Fora de escopo

Não implementar neste plano:

- novo motor de automações;
- novos tipos de gatilho ou integração;
- alteração do worker/BullMQ;
- mudança de MongoDB ou migração de dados;
- cópia de agente entre andares;
- múltiplos prédios por conta;
- novo sistema de permissões;
- redesign visual completo do desktop;
- criação de novas ilustrações ou sprites;
- reescrita da simulação do escritório;
- mudança de DNS;
- deploy no Coolify;
- inclusão de secrets em arquivos versionados;
- transformação de Canais/Conversas em escopo de andar sem decisão de produto.

Se for encontrado um bug de backend que impeça a troca de andar, documentar com reprodução e implementar apenas a correção mínima, após confirmar que ela não altera o domínio nem o escopo deste plano.

---

## 17. Compatibilidade e rollback

- Manter `VITE_AI_BUILDING_ENABLED` como chave de ativação do shell V2 enquanto a flag existir.
- Não duplicar a lógica V1 e V2 em novos componentes além do estritamente necessário.
- Preservar redirects de bookmarks antigos.
- Commits pequenos e reversíveis.
- Em caso de regressão, o rollback deve ser possível revertendo os commits desta implementação ou desabilitando a flag e reconstruindo o frontend.
- Deixar claro que alterar a flag exige novo build; mudar runtime sem rebuild não é rollback efetivo de Vite.

---

## 18. Sugestão de commits

1. `test(mobile): capture building navigation baseline`
2. `refactor(nav): centralize canonical floor routes`
3. `fix(floors): keep mobile navigation scoped to URL floor`
4. `feat(mobile): add direct floor switcher sheet`
5. `feat(mobile): align topbar drawer and bottom navigation`
6. `fix(responsive): align floor modules with current mobile UX`
7. `fix(office-map): validate controls and floor changes on touch`
8. `fix(build): pass public AI flags to Vite production build`
9. `test(mobile): cover floor switching and canonical routes`
10. `docs(mobile): add parity QA report and current screenshots`

Não é obrigatório usar exatamente estes nomes, mas manter separação lógica e capacidade de revisão/reversão.

---

## 19. Definition of Done

O trabalho está pronto quando uma pessoa que só possui o telefone consegue:

1. entrar no sistema publicado a partir de um build equivalente ao validado;
2. identificar o andar atual sem abrir menu;
3. trocar de andar de forma evidente;
4. ver o mapa e os agentes corretos do novo andar;
5. navegar entre visão do andar, agentes, setores e automações;
6. abrir execuções, canais, conversas e configurações pelo menu;
7. usar mapa, formulários, dialogs e conversas sem overflow ou controles escondidos;
8. atualizar a página ou usar voltar/avançar sem perder o contexto correto;
9. obter a mesma estrutura de produto do desktop, adaptada ao toque.

Somente depois de cumprir isso, gerar o relatório final e encerrar a execução.
