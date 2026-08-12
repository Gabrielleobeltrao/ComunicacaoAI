# Plano de implementação — Escritório virtual vivo

> Projeto: ComunicacaoAI  
> Branch-base analisado: `development`  
> Commit-base analisado: `9b2274b99995ed5c960a4db8c8728f35e9917fb5`  
> Escopo: somente frontend e experiência visual do escritório da página inicial autenticada  
> Status inicial: planejamento aprovado; implementação pendente

## 1. Objetivo

Dar vida ao escritório virtual que aparece em **Dashboard → Sua equipe**, preservando integralmente o layout, a distribuição de personagens, o alinhamento com mesas e cadeiras, o mapa orgânico, o zoom, o pan, a tela cheia e a navegação que já funcionam.

A implementação deve acrescentar duas camadas visuais:

1. **Simulação dos agentes:** agentes levantam da cadeira, caminham pelo escritório em quatro direções, fazem pausas, visitam pontos válidos e retornam à própria mesa sem atravessar paredes, móveis ou outros agentes.
2. **Composição do cenário:** objetos do catálogo visual são distribuídos de maneira estável e coerente nos setores e áreas externas, sem bloquear portas, corredores, cadeiras ou rotas.

Este plano não autoriza mudanças no comportamento real dos agentes de IA, backend, banco de dados, APIs, autenticação, chats ou orquestração.

---

## 2. Estado atual que deve ser preservado

### 2.1 Arquivos principais

- `frontend/src/pages/Dashboard.tsx`
  - Renderiza a seção **Sua equipe**.
  - Entrega `agents` e `sectors` para `OfficeFloor`.
- `frontend/src/office/OfficeFloor.tsx`
  - Calcula dimensões e posições dos setores.
  - Calcula mesas, cadeiras, assentos e agentes sem setor.
  - Usa PRNG baseado em IDs para produzir aleatoriedade visual estável.
- `frontend/src/office/OfficeMap.tsx`
  - Controla viewport, zoom, ajuste à tela, tela cheia e pan por arraste.
- `frontend/src/office/MapAgent.tsx`
  - Renderiza o personagem, sombra, nome e status.
  - Mantém o clique que abre `/agents/:id`.
- `frontend/src/office/MapObject.tsx`
  - Renderiza objetos posicionados em coordenadas do mapa.
- `frontend/src/office/MapZone.tsx`
  - Renderiza os setores, pisos e paredes.
- `frontend/src/lib/agentAvatar.ts`
  - Escolhe personagem, cor e status decorativo de forma estável pelo ID.
- `frontend/public/illustrations/map/agents/`
  - Atualmente contém somente poses estáticas de frente/costas e sentado/em pé.
- `frontend/public/illustrations/map/objects/`
  - Atualmente contém mesas, cadeiras, planta e sofá.

### 2.2 Comportamentos que não podem regredir

- O mesmo agente mantém o mesmo personagem depois de recarregar.
- A rotação entre Bruno, Lia, Nina e Teo continua estável e com o mínimo possível de repetição.
- Agentes de um setor continuam associados ao setor correto.
- Agentes sentados continuam alinhados ao monitor, mesa e cadeira corretos.
- Agentes do lado superior e inferior da mesa continuam com a orientação correta.
- Agentes sem setor continuam distribuídos fora das salas sem sobreposição inicial.
- Os setores continuam com formato orgânico e estável.
- O mapa continua preenchendo o painel sem área vazia indevida no zoom mínimo.
- Zoom, pan, ajuste à tela e tela cheia continuam funcionando.
- Arrastar o mapa não abre acidentalmente a página do agente.
- Clicar em um agente continua abrindo sua página.
- O build atual precisa continuar passando.

Antes de modificar o código, registrar uma referência do comportamento atual e rodar o build de baseline.

---

## 3. Restrições obrigatórias

### 3.1 Limite de escopo

Não modificar:

- `backend/`;
- modelos ou coleções do MongoDB;
- endpoints da API;
- autenticação;
- execução de LLM;
- widgets;
- chats;
- lógica de setores;
- formato persistido de agentes ou setores.

Não instalar uma engine de jogos. A solução deve usar React, TypeScript, CSS e APIs nativas do navegador. Uma biblioteca pequena só pode ser adicionada se houver justificativa técnica concreta e se não existir solução razoável com o stack atual.

### 3.2 Segurança de implementação

- Trabalhar a partir de `development`, em branch próprio.
- Não substituir o layout atual por outro sistema antes de extrair e testar suas regras existentes.
- Não apagar nem renomear os SVGs antigos.
- Novos sprites precisam possuir fallback para as poses estáticas atuais.
- Manter uma feature flag local para desativar toda a simulação sem remover código.
- Fazer commits pequenos e separados por etapa.
- Não usar aleatoriedade não determinística para layout ou decoração persistente.
- Toda alteração deve continuar compilando antes de seguir para a próxima fase.
- Não encerrar a execução deixando erros de TypeScript, lint ou build conhecidos.

### 3.3 Feature flags

Criar configuração central, por exemplo:

```ts
export const OFFICE_FEATURES = {
  simulation: true,
  decoration: true,
  debug: import.meta.env.DEV,
}
```

O modo `debug` deve estar desligado visualmente por padrão mesmo em desenvolvimento e ser ativado por parâmetro de URL ou controle interno de desenvolvimento.

---

## 4. Arquitetura proposta

Organizar a implementação sem transformar `OfficeFloor.tsx` em um arquivo ainda maior.

```text
frontend/src/office/
├── OfficeFloor.tsx
├── OfficeMap.tsx
├── MapAgent.tsx
├── MapObject.tsx
├── MapZone.tsx
├── AgentSprite.tsx
├── officeConfig.ts
├── officeTypes.ts
├── officeAssets.ts
├── buildOfficeLayout.ts
├── buildNavigationGrid.ts
├── findOfficePath.ts
├── placeOfficeDecor.ts
├── useOfficeSimulation.ts
├── OfficeDebugOverlay.tsx
└── __tests__/
    ├── buildOfficeLayout.test.ts
    ├── buildNavigationGrid.test.ts
    ├── findOfficePath.test.ts
    └── placeOfficeDecor.test.ts
```

Os nomes podem ser ajustados à convenção encontrada no projeto, desde que as responsabilidades continuem separadas.

### 4.1 Responsabilidades

- `officeTypes.ts`
  - Tipos de coordenada, direção, pose, estado, assento, sala, objeto, obstáculo, ponto de interesse, rota e reserva.
- `officeConfig.ts`
  - Constantes de timing, escala, colisão, limites de simultaneidade, feature flags e debug.
- `officeAssets.ts`
  - Manifesto único dos personagens, sprites, objetos e fallbacks.
- `buildOfficeLayout.ts`
  - Extração pura do cálculo que hoje vive em `OfficeFloor.tsx`.
  - Deve produzir o mesmo layout visual para as mesmas entradas.
- `buildNavigationGrid.ts`
  - Converte limites, salas, portas e objetos em células caminháveis ou bloqueadas.
- `findOfficePath.ts`
  - Pathfinding A* determinístico em quatro direções.
- `useOfficeSimulation.ts`
  - Controla as máquinas de estados, destinos, reservas, temporização e retorno à mesa.
- `AgentSprite.tsx`
  - Seleciona frame, direção, modo normal/telefone e fallback.
- `placeOfficeDecor.ts`
  - Distribui objetos por setor usando seed estável e regras de colisão.
- `OfficeDebugOverlay.tsx`
  - Exibe grade, obstáculos, portas, rotas e reservas somente em debug.

---

## 5. Modelo de dados visual

Criar tipos equivalentes aos seguintes:

```ts
export type OfficeDirection = 'front' | 'back' | 'left' | 'right'
export type AgentVisualMode = 'normal' | 'phone'
export type AgentMotionState =
  | 'seated'
  | 'standing-up'
  | 'walking'
  | 'pausing'
  | 'waiting'
  | 'returning'
  | 'sitting-down'

export interface OfficePoint {
  x: number
  y: number
}

export interface OfficeRect {
  x: number
  y: number
  width: number
  height: number
}

export interface AgentHome {
  seatId: string
  seatedPoint: OfficePoint
  exitPoint: OfficePoint
  seatedFacing: OfficeDirection
  sectorId?: string
}

export interface InteractionPoint {
  id: string
  point: OfficePoint
  facing?: OfficeDirection
  categories: string[]
  capacity: number
}

export interface AgentSimulationState {
  agentId: string
  motion: AgentMotionState
  mode: AgentVisualMode
  direction: OfficeDirection
  position: OfficePoint
  route: OfficePoint[]
  frame: number
  home: AgentHome
  destinationId?: string
}
```

O estado da simulação é temporário e somente visual. Não persistir no backend.

---

## 6. Fase 0 — Baseline e inventário

### Tarefas

- [x] Confirmar que o trabalho começou a partir do commit mais recente de `development` (HEAD `5cb232f`).
- [x] Criar branch de implementação, por exemplo `feature/living-office`.
- [x] Rodar `npm install` apenas se necessário (não necessário).
- [x] Rodar `npm run build` antes das alterações (passa — 345 módulos).
- [x] Rodar o lint disponível no frontend e registrar qualquer erro preexistente (`npm run lint -w frontend` = oxlint, limpo).
- [x] Ler por completo os componentes atuais do escritório.
- [x] Criar uma lista dos assets existentes com dimensões e `viewBox` (retrato 112×168, frente/costas 56×84, sentado 56×66; objetos por família).
- [x] Identificar no Claude Design os blocos `Map agents — andando`, `Map agents — ligação`, `Map agents — facings`, `Sprite library` e o catálogo de cenários/objetos.
- [x] Trazer os assets aprovados do Claude Design, sem redesenhá-los arbitrariamente (640 frames de walk gerados pelo gerador do design; frente/costas × andando1-4 × normal/telefone).
- [x] Verificar se os pés permanecem no mesmo ponto entre todos os frames (baseline consistente, 56×84).
- [x] Verificar se todos os personagens possuem o mesmo conjunto de direções e estados (40 personagens uniformes). Ressalva: o design **não tem perfil lateral** (esquerda/direita) — decisão do design ("a profile loses the face"); esquerda/direita usam frente com espelho como fallback documentado.

### Bloqueio controlado de assets

Se algum sprite do design ainda não estiver exportável:

1. Não inventar uma versão definitiva.
2. Criar o manifesto com fallback para o SVG estático correspondente.
3. Continuar implementando layout, navegação, colisão e simulação.
4. Registrar claramente no checklist qual asset falta.
5. Substituir o fallback assim que o asset ficar disponível antes da validação final.

### Resultado esperado

Um inventário completo de assets e uma baseline compilável, sem mudança visual acidental.

---

## 7. Fase 1 — Manifesto e normalização dos sprites

### Estrutura lógica obrigatória

Cada personagem deve oferecer:

```text
character
├── normal
│   ├── idle: front, back, left, right
│   └── walk: front[], back[], left[], right[]
└── phone
    ├── idle: front, back, left, right
    └── walk: front[], back[], left[], right[]
```

### Regras

- Preferir nomes em inglês no código e manter os nomes físicos dos assets quando renomeá-los puder quebrar referências.
- Centralizar o mapeamento entre nome lógico e arquivo em `officeAssets.ts`.
- Não espalhar caminhos de assets pelos componentes.
- Todos os frames devem ter:
  - fundo transparente;
  - mesma escala;
  - mesmo canvas lógico por categoria;
  - pés alinhados no mesmo ponto de apoio;
  - recorte sem cortar cabelo, mão ou telefone.
- Se o design possui quatro frames de caminhada, preservar os quatro.
- Fazer preload dos sprites necessários para evitar flashes ao trocar de frame.
- Se um frame falhar, usar o idle equivalente; se o idle falhar, usar a pose estática legada.

### Resultado esperado

`AgentSprite` recebe personagem, modo, direção, movimento e frame, e sempre consegue renderizar algo válido.

---

## 8. Fase 2 — Extração do layout atual

### Objetivo

Transformar o cálculo de layout atual em funções puras sem alterar o resultado exibido.

### Tarefas

- [ ] Mover `hash32`, `mulberry32`, dimensionamento de salas, posicionamento de salas, mesas, assentos e agentes soltos para módulos puros.
- [ ] Fazer `OfficeFloor` consumir um objeto de layout calculado.
- [ ] Memorizar o layout com `useMemo` usando somente as dependências reais.
- [ ] Garantir que mudanças de frame, status ou posição não recalculem as salas.
- [ ] Preservar as seeds atuais baseadas nos IDs.
- [ ] Incluir no layout:
  - limites totais;
  - retângulos de salas;
  - retângulos de mesas e cadeiras;
  - assentos e pontos de saída;
  - orientação sentada original;
  - agentes soltos;
  - labels;
  - zonas externas;
  - portas e corredores.
- [ ] Adicionar testes determinísticos para as mesmas entradas.

### Regra de compatibilidade

Com `simulation: false` e `decoration: false`, o resultado visual deve permanecer equivalente ao escritório anterior.

---

## 9. Fase 3 — Portas e navegação

### Problema atual

Os setores são desenhados como retângulos com borda completa. Para um agente entrar e sair legitimamente, a sala precisa ter uma porta visual e uma abertura equivalente na malha de navegação.

### Implementação

- Definir pelo menos uma porta por setor.
- Posicionar a porta em uma borda que tenha acesso a um corredor válido.
- Não colocar porta atrás de mesa, cadeira, label ou objeto.
- Renderizar a abertura de maneira compatível com o estilo atual.
- Criar dois pontos por porta:
  - portal interno;
  - portal externo.
- Conectar ambos na grade de navegação.
- Manter uma faixa livre entre toda cadeira e a porta do setor.

### Grade

- Trabalhar em coordenadas do escritório, não em pixels da tela.
- Usar resolução inicial de `0.5 tile` ou outra resolução pequena validada visualmente.
- Bloquear:
  - paredes;
  - limites do mapa;
  - mesas;
  - cadeiras;
  - sofás;
  - plantas grandes;
  - objetos com colisão;
  - espaços sem acesso por porta.
- Inflar cada obstáculo pela área dos pés/corpo do personagem.
- O ponto usado para colisão deve ser o apoio dos pés, não o retângulo completo da imagem.

### Resultado esperado

Todas as mesas possuem rota para a porta e toda porta possui rota para pelo menos um ponto do corredor.

---

## 10. Fase 4 — Pathfinding e prevenção de colisões

### Algoritmo

Implementar A* em quatro direções:

- esquerda;
- direita;
- cima;
- baixo.

Não usar diagonais nesta primeira versão.

### Orientação visual

| Movimento na grade | Sprite |
|---|---|
| `x` diminui | `left` |
| `x` aumenta | `right` |
| `y` diminui | `back` |
| `y` aumenta | `front` |

### Reservas

- Cada agente reserva seu destino.
- Dois agentes não podem reservar o mesmo ponto com capacidade 1.
- O próximo segmento da rota deve ser reservado por uma janela curta.
- Se houver conflito, um agente entra em `waiting` e recalcula após um pequeno atraso com jitter.
- Nunca empurrar ou teletransportar outro agente.
- Se a rota ficar inválida, recalcular.
- Depois de tentativas limitadas, escolher outro destino ou retornar à mesa.
- O retorno à mesa tem prioridade sobre passeios decorativos.

### Testes mínimos

- [ ] Encontra caminho em corredor simples.
- [ ] Contorna uma mesa.
- [ ] Passa por uma porta.
- [ ] Não atravessa parede.
- [ ] Retorna `null` quando não há rota.
- [ ] Não corta diagonalmente a quina.
- [ ] Reage a uma célula temporariamente reservada.
- [ ] Produz resultado determinístico quando entradas e seed são iguais.

---

## 11. Fase 5 — Máquina de estados dos agentes

### Fluxo principal

```text
seated
  → standing-up
  → walking
  → pausing
  → walking (opcional, outro ponto)
  → returning
  → sitting-down
  → seated
```

`waiting` pode interromper `walking` ou `returning` quando a rota estiver ocupada.

### Regras de comportamento

- Todo agente vinculado a uma mesa começa sentado em sua cadeira atual.
- Agente sem setor começa no ponto solto calculado atualmente.
- Cada agente usa um PRNG próprio derivado de `agentId` mais um contador de ciclo.
- O agente espera um tempo variável antes de se levantar.
- Ao levantar, passa da posição sentada para o `exitPoint` da cadeira.
- Escolhe somente destinos acessíveis.
- Pode visitar um ou dois pontos antes de retornar.
- Faz pequenas pausas no destino e, ocasionalmente, durante o caminho.
- Retorna à cadeira exata de origem.
- Recupera a orientação sentada original ao sentar.
- Agentes sem assento podem alternar entre pausa e caminhada, sem executar retorno à cadeira.

### Ritmo visual inicial

Usar configuração central e ajustar visualmente:

- pausa sentado: aproximadamente 20–70 segundos;
- pausa em destino: aproximadamente 4–14 segundos;
- pausa intermediária rara: aproximadamente 1–4 segundos;
- máximo de visitas por passeio: 2;
- simultaneidade: no máximo 25% dos agentes, com mínimo prático de 1 quando houver agentes suficientes;
- velocidade: constante e calma, sem corrida;
- início escalonado para evitar movimentos sincronizados.

Não codificar esses tempos diretamente dentro dos componentes.

### Estado visual normal versus telefone

Nesta entrega, usar o status disponível como fonte visual:

| Status | Modo do sprite |
|---|---|
| `working` | `phone` |
| `thinking` | `phone` |
| `calling` | `phone` |
| `idle` | `normal` |
| `break` | `normal` |
| `blocked` | `normal` |

O modo não controla a rota. Um agente pode caminhar ou ficar parado tanto no modo normal quanto no modo telefone.

Preparar a interface para receber status real no futuro, mas não implementar integração de backend nesta tarefa.

---

## 12. Fase 6 — Animação e renderização

### Regras de performance

- Não provocar renderização completa do escritório em cada frame.
- React controla estados semânticos: sentado, andando, parado, direção e modo.
- Usar `transform: translate3d(...)` para deslocamento.
- Usar `requestAnimationFrame`, Web Animations API ou transições controladas para movimento contínuo.
- Trocar frames de caminhada em baixa frequência coerente com o design.
- Separar a frequência da simulação da frequência de pintura.
- Atualizar `z-index` de maneira coerente com a coordenada dos pés quando o agente estiver solto.
- Preservar as regras especiais de profundidade em relação às mesas e cadeiras.
- Precarregar sprites antes de iniciar o primeiro ciclo.
- Suspender animação e timers quando `document.visibilityState !== 'visible'`.
- Liberar timers, animações e listeners no unmount.
- Não gerar vazamentos ao trocar de página.

### Acessibilidade

- Respeitar `prefers-reduced-motion: reduce`.
- Nesse modo, manter os agentes nas posições estáticas iniciais.
- Manter o nome acessível e a ação de abrir a página do agente.
- O movimento não pode impedir teclado, clique ou leitura do botão.

### Interação com o mapa

- Pan e zoom não podem alterar as coordenadas lógicas da simulação.
- Arrastar o mapa continua tendo precedência sobre o clique.
- Um agente em movimento continua clicável.
- Ao abrir e voltar da página de um agente, reiniciar a simulação de forma limpa e estável.

---

## 13. Fase 7 — Catálogo e composição do cenário

Executar somente depois que pathfinding e retorno à mesa estiverem estáveis.

### Catálogo

Cada objeto deve possuir metadados equivalentes a:

```ts
export interface OfficeObjectDefinition {
  id: string
  asset: string
  width: number
  height: number
  collision: OfficeRect
  categories: Array<
    | 'work'
    | 'meeting'
    | 'lounge'
    | 'marketing'
    | 'sales'
    | 'support'
    | 'finance'
    | 'decoration'
    | 'outdoor'
  >
  allowedZones: Array<'room' | 'hall' | 'outdoor'>
  interactionPoints: InteractionPoint[]
  placementWeight: number
  maximumPerRoom: number
  blocksNavigation: boolean
}
```

### Ordem obrigatória de posicionamento

1. Limites, paredes e portas.
2. Mesas e cadeiras atuais.
3. Saídas das cadeiras.
4. Corredores obrigatórios.
5. Objetos grandes.
6. Objetos interativos.
7. Objetos decorativos pequenos.
8. Plantas e detalhes externos.

### Validação de cada objeto

Antes de aceitar uma posição, verificar:

- não cruza parede;
- não cruza outro objeto;
- não cobre agente ou assento;
- não bloqueia porta;
- não bloqueia saída de cadeira;
- não invade o label do setor;
- não elimina a rota cadeira → porta;
- não elimina a rota porta → corredor;
- respeita margem visual;
- não deixa o ambiente carregado demais;
- possui ao menos um interaction point alcançável quando for interativo.

Se a posição falhar, tentar outra posição por número limitado de vezes. Se nenhuma for válida, simplesmente não colocar aquele objeto.

### Estabilidade

Usar seed equivalente a:

```text
office-layout-version + sectorId + object-catalog-version
```

A decoração não pode trocar quando:

- o componente renderiza novamente;
- um sprite muda de frame;
- um agente muda de status;
- o usuário aplica zoom;
- o painel é redimensionado.

### Temas

Selecionar objetos por nome/tipo do setor quando houver correspondência clara:

- Marketing: quadro criativo, mídia, lounge e decoração.
- Vendas: estações de trabalho e reunião.
- Suporte: mesas, telas e espera.
- Financeiro: ambiente mais organizado e discreto.
- Desenvolvimento: estações e quadro técnico.
- RH: reunião, espera e plantas.
- Setor desconhecido: tema genérico equilibrado.

O tema é apenas visual e não altera lógica de negócio.

---

## 14. Fase 8 — Pontos de interesse

Transformar objetos compatíveis em destinos opcionais:

- sofá;
- quadro;
- máquina de café, se existir no design;
- mesa compartilhada;
- planta ou janela como ponto apenas de contemplação;
- área externa;
- pontos de encontro nos corredores.

### Regras

- O agente caminha para o interaction point, nunca para o centro do objeto.
- Ao chegar, assume a direção indicada pelo ponto.
- Respeita `capacity`.
- Não inventar animação de sentar, beber ou escrever se o sprite não existir.
- Sem sprite específico, o agente apenas para e usa a pose idle adequada.
- Após a pausa, libera a reserva.

---

## 15. Fase 9 — Debug e observabilidade visual

Criar overlay de desenvolvimento capaz de mostrar:

- células navegáveis;
- obstáculos permanentes;
- reservas temporárias;
- portas e portais;
- ponto dos pés de cada agente;
- rota atual;
- destino;
- assento e saída da cadeira;
- interaction points;
- estado da máquina;
- colisões ou rotas inválidas em vermelho.

Ativação sugerida:

```text
/dashboard?officeDebug=1
```

O overlay não deve entrar visível em produção e não deve interceptar cliques.

---

## 16. Fase 10 — Testes e validação final

### Testes automatizados

- [ ] Layout é determinístico.
- [ ] Personagem e assento continuam estáveis pelo ID.
- [ ] Toda cadeira ocupada possui saída válida.
- [ ] Todo setor ocupado possui porta.
- [ ] Toda saída de cadeira alcança uma porta.
- [ ] Toda porta alcança o corredor.
- [ ] Pathfinding contorna obstáculos.
- [ ] Destinos não são duplicados quando a capacidade é 1.
- [ ] Decoração é determinística.
- [ ] Decoração não bloqueia rotas obrigatórias.
- [ ] Manifesto resolve fallback quando um frame não existe.
- [ ] A máquina retorna o agente ao assento de origem.

### Verificação manual

Testar:

- 1 agente e nenhum setor;
- vários agentes sem setor;
- setor vazio;
- 1 setor com 1 agente;
- 1 setor com 4 agentes;
- setor com mais de uma mesa;
- vários setores;
- muitos agentes andando;
- zoom mínimo e máximo;
- pan durante caminhada;
- entrada e saída de tela cheia;
- resize do painel;
- abrir um agente durante a caminhada;
- navegar para outra tela e voltar;
- aba escondida e reaberta;
- `prefers-reduced-motion`;
- asset ausente;
- modo com simulação desativada;
- modo com decoração desativada.

### Comandos obrigatórios

Executar, corrigir e repetir até passarem:

```bash
npm run build
npm run lint -w frontend
```

Executar também os testes adicionados usando o runner escolhido e documentado no projeto.

Se o projeto ainda não tiver runner de testes, adicionar uma configuração pequena e compatível com Vite/TypeScript apenas para os módulos puros do escritório.

---

## 17. Critérios de aceite

O trabalho só está concluído quando todos os itens abaixo forem verdadeiros:

- [ ] Nenhum agente atravessa mesa, cadeira, sofá, planta, parede ou limite do mapa.
- [ ] Agentes não passam visualmente por cima uns dos outros.
- [ ] Agentes saem e entram nos setores somente pelas portas.
- [ ] Frente, costas, esquerda e direita correspondem ao movimento real.
- [ ] O ciclo de frames não corta, pula ou faz os pés deslizarem de forma evidente.
- [ ] `working`, `thinking` e `calling` usam o conjunto visual de telefone.
- [ ] `idle`, `break` e `blocked` usam o conjunto visual normal.
- [ ] Todo agente com mesa volta para a cadeira exata de origem.
- [ ] Ao sentar, recupera a orientação e profundidade corretas em relação à mesa.
- [ ] A distribuição atual de personagens continua estável.
- [ ] O cenário permanece igual após recarregar.
- [ ] Nenhum objeto decorativo bloqueia rota obrigatória.
- [ ] O escritório continua funcionando com assets faltantes por meio de fallback.
- [ ] Zoom, pan, fullscreen e clique continuam funcionando.
- [ ] O movimento pausa quando a aba fica invisível.
- [ ] Reduced motion mantém uma versão estática funcional.
- [ ] Não há alteração de backend ou contrato de API.
- [ ] Não há erro conhecido de TypeScript, build, lint ou testes provocado pela implementação.
- [ ] O modo de debug comprova visualmente rotas e colisões.
- [ ] O documento foi atualizado com todos os checkboxes concluídos ou justificativa objetiva para algum item inaplicável.

---

## 18. Ordem de commits sugerida

1. `refactor(office): extract deterministic office layout`
2. `feat(office): add sprite asset manifest and fallbacks`
3. `feat(office): add doors and navigation grid`
4. `feat(office): add collision-safe pathfinding`
5. `feat(office): add agent simulation state machine`
6. `feat(office): animate directional normal and phone sprites`
7. `feat(office): add deterministic room decoration`
8. `feat(office): add object interaction points`
9. `test(office): cover layout navigation and simulation`
10. `fix(office): complete visual QA and accessibility`

Não é obrigatório usar exatamente essas mensagens, mas os commits devem permanecer pequenos e revisáveis.

---

## 19. Protocolo de execução autônoma

Durante a execução deste plano:

1. Ler o arquivo inteiro antes de editar.
2. Inspecionar o código real e adaptar nomes quando necessário, sem abandonar os requisitos.
3. Criar e manter uma lista de tarefas baseada nas fases deste documento.
4. Executar as fases em ordem.
5. Após cada fase:
   - revisar o diff;
   - rodar validações relevantes;
   - corrigir regressões;
   - marcar os checkboxes concluídos;
   - fazer um commit focado.
6. Não pedir confirmação entre etapas para decisões técnicas reversíveis e claramente cobertas por este plano.
7. Quando houver um problema, investigar e tentar alternativas seguras antes de interromper.
8. Não contornar erros desabilitando TypeScript, lint, testes ou regras de segurança.
9. Não declarar conclusão enquanto os critérios de aceite não forem verificados.
10. Ao final, entregar um resumo com:
    - arquivos criados e modificados;
    - arquitetura implementada;
    - sprites importados e fallbacks restantes;
    - testes executados;
    - resultado de build e lint;
    - passos exatos para testar manualmente;
    - limitações reais que ainda existirem.

---

## 20. Fora de escopo desta entrega

- Status operacional real enviado pelo backend.
- Persistência da posição atual de cada agente.
- Sincronização da simulação entre usuários.
- Multiplayer.
- Editor manual de móveis.
- Alteração da composição de setores.
- Novos comportamentos de IA.
- Sons ambientes.
- Animações não existentes no Claude Design.
- Mecânicas de jogo, pontuação ou recompensas.

Esses itens podem ser planejados depois que a simulação visual estiver estável.

