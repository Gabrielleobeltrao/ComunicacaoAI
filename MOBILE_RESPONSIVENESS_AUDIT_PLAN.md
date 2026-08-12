# Mobile Responsiveness Audit & Implementation Plan

> **Projeto-alvo:** `https://github.com/Gabrielleobeltrao/ComunicacaoAI`
>
> **Área:** frontend completo, todas as páginas, sessões, blocos, formulários, modais, navegação e mapa do escritório.
>
> **Objetivo desta etapa:** auditar, corrigir, testar e documentar a responsividade. Esta etapa não inclui deploy, VPS, Cloudfy, domínio, proxy, SSL, backend em produção ou variáveis de ambiente de produção.

## 1. Contexto e regra de segurança

A implementação mais recente do escritório pode estar apenas no worktree/branch local do Claude Code. A branch pública `development` foi observada no commit `ee66325`, portanto o estado local deve ser inspecionado antes de qualquer sincronização.

- Não executar `git pull`, reset, checkout destrutivo ou troca de branch antes de verificar `git status`, branch atual, commits locais e divergência com o remoto.
- Preservar integralmente todas as mudanças e commits da implementação mais recente.
- Usar o código local mais recente como fonte de verdade quando ele estiver à frente do remoto.
- Não refazer nem remover a nova simulação do escritório.
- Não fazer push ou merge sem autorização do usuário.
- Registrar branch e commit-base utilizados.

## 2. Resultado esperado

O sistema deve funcionar de forma confortável no telefone e no tablet, na medida apropriada para cada recurso, sem alterar o comportamento de negócio.

Ao concluir:

- Todas as rotas devem ser utilizáveis em telas pequenas.
- Não deve existir overflow horizontal acidental da página.
- Navegação, cabeçalhos, ações, cards, grids, formulários, abas, chats, modais e mapa devem se adaptar.
- O escritório deve continuar completo, com pan e zoom por toque.
- Teclado virtual não deve esconder inputs ou botões importantes.
- Estados loading, empty, error e conteúdo longo devem permanecer legíveis.
- Deve existir evidência visual organizada para o usuário conferir pelo celular.

## 3. Fora de escopo

Não implementar nesta etapa:

- Deploy em VPS ou Cloudfy.
- URL pública ou túnel permanente.
- Domínio ou subdomínio.
- Nginx, Caddy, Traefik ou Cloudflare.
- SSL.
- Dockerização para produção.
- Serviços systemd/PM2.
- Alterações de API ou banco de dados.
- Mudanças nas regras dos agentes.
- Redesign completo da identidade visual.

Responsividade não torna `localhost` acessível fora do computador. O acesso remoto real será tratado no plano de deploy posterior. Nesta etapa, gerar screenshots e relatório para validação pelo telefone.

## 4. Fase 0 — Baseline e inventário real

1. Executar e registrar:
   - `git status --short --branch`
   - `git log --oneline --decorate -20`
   - comparação entre HEAD local e `origin/development`
2. Identificar mudanças locais não commitadas e preservá-las.
3. Executar baseline de frontend: instalação existente, typecheck/build, lint e testes.
4. Subir o projeto localmente sem mudar configurações de produção.
5. Percorrer todas as rotas e estados disponíveis.
6. Criar `RESPONSIVE_QA_REPORT.md` e registrar nele o baseline, problemas encontrados, correções e evidências.
7. Tirar screenshots “antes” somente quando forem úteis para comparação.

Se o baseline estiver quebrado, separar problemas preexistentes dos problemas introduzidos nesta etapa.

## 5. Matriz obrigatória de rotas

Auditar pelo menos:

- `/`
- `/login`
- `/register`
- `/dashboard`
- `/agents`
- `/agents/:agentId`
- Todas as subseções de `/agents/:agentId/:section`
- `/setores`
- `/setores/:sectorId`
- Todas as subseções de `/setores/:sectorId/:section`
- `/widgets`
- Todas as abas e gerenciadores dentro de Canais
- `/chats`
- `/settings`
- `/widget/:publicKey`
- Redirecionamentos legados `/whatsapp` e `/teams`
- Página/estado 404 ou redirecionamento de rota desconhecida

Para páginas protegidas, utilizar uma conta de teste existente ou uma estratégia local segura. Não enfraquecer autenticação nem criar bypass que possa chegar à produção.

## 6. Matriz obrigatória de viewports

Testar retrato e, quando indicado, paisagem:

### Telefones

- 320 × 568
- 360 × 800
- 375 × 667
- 390 × 844
- 393 × 852
- 412 × 915
- 430 × 932
- Paisagem 844 × 390

### Tablets

- 768 × 1024
- 820 × 1180
- 1024 × 768 em paisagem

### Regressão desktop

- 1280 × 720
- 1440 × 900
- 1920 × 1080

Os breakpoints devem surgir da necessidade do conteúdo, e não de um aparelho específico.

## 7. Critérios globais de inspeção

Em cada rota, verificar:

- Largura e altura do viewport.
- Scroll vertical natural.
- Ausência de scroll horizontal acidental.
- Safe areas de iPhone.
- Barra de endereço móvel e unidades `dvh`/`svh`.
- Zoom do navegador em 200% quando aplicável.
- Títulos e textos longos.
- E-mails, IDs, URLs e nomes longos sem espaço.
- Estados vazio, loading, erro, sucesso e conteúdo populado.
- Menus, dropdowns, tooltips, popovers e modais.
- Foco do teclado e teclado virtual.
- Botões desabilitados e em loading.
- Áreas clicáveis por toque.
- Orientação retrato/paisagem.
- Tema e cores já existentes.

## 8. Fase 1 — Fundação responsiva e tokens

Revisar `index.html`, tokens, `index.css` e estilos globais.

### Implementar ou corrigir

- Confirmar `meta viewport` correto com `width=device-width, initial-scale=1`.
- Não desabilitar zoom do usuário.
- Adotar `100dvh` onde o viewport móvel dinâmico for necessário, com fallback seguro.
- Criar gutters responsivos, por exemplo 16px em telefone, 20px em tablet e o valor atual em desktop.
- Criar tokens para safe area usando `env(safe-area-inset-*)`.
- Garantir `min-width: 0` em filhos flex/grid que precisam encolher.
- Garantir wrapping de strings longas com `overflow-wrap: anywhere` apenas onde necessário.
- Imagens, SVGs, vídeos e canvases nunca devem ultrapassar o contêiner.
- Evitar larguras fixas quando `max-width`, `min()`, `clamp()` ou grids responsivos resolverem.
- Manter overflow horizontal somente em elementos intencionais, como tabs, código e mapa.
- Preservar tokens e identidade atuais.

Não aplicar um `overflow-x: hidden` global para apenas esconder bugs. Corrigir a origem de cada overflow.

## 9. Fase 2 — App shell e navegação móvel

O rail atual depende de hover e reserva largura fixa. Isso não é adequado como única navegação em telas touch.

### Desktop

- Preservar o rail recolhido/expandido atual.
- Não causar regressão no hover e navegação.

### Telefone e tablet pequeno

- Não reservar permanentemente os 72px do rail.
- Ocultar o rail desktop abaixo do breakpoint apropriado.
- Implementar navegação móvel coerente com o design atual: bottom navigation para destinos principais e/ou drawer acessível para itens secundários.
- Garantir acesso a Escritório, Agentes, Setores, Canais, Conversas, Configurações e Sair.
- Destacar rota ativa.
- Fechar drawer após navegação, Escape ou clique no backdrop.
- Travar o scroll de fundo somente enquanto o drawer estiver aberto.
- Respeitar safe area inferior.
- Usar alvos de toque de no mínimo 44 × 44px.

### Topbar

- Título, subtítulo, badges e ações não podem disputar a mesma linha até ficarem cortados.
- Permitir truncamento ou wrapping controlado.
- Em telas pequenas, mover ações secundárias para menu “mais” ou segunda linha.
- Manter ações críticas visíveis.
- Topbar não pode esconder conteúdo nem ultrapassar o viewport.
- Usar altura flexível quando o conteúdo realmente precisar de duas linhas.

### Conteúdo principal

- Usar largura total disponível no telefone.
- Aplicar gutter responsivo.
- Preservar `max-width` no desktop.
- Compensar bottom navigation e safe area para que o final da página permaneça acessível.

## 10. Fase 3 — Dashboard e escritório virtual

O mapa não deve ser convertido em uma versão empobrecida. Deve continuar completo e navegável por toque.

### Dashboard

- Métricas em uma coluna no menor telefone, duas quando houver largura e quatro apenas no desktop apropriado.
- Select/filtro de período deve caber no cabeçalho ou ocupar largura total em uma segunda linha.
- Cards e mensagens de loading/error não podem transbordar.

### OfficeMap

- Definir altura móvel útil com `clamp()` e `dvh`, sem deixar o mapa minúsculo nem empurrar todo o restante para fora.
- Manter fit-to-view no carregamento.
- Suportar pan por um dedo sem ativar clique acidental em agentes.
- Manter zoom pelos botões; pinch-to-zoom pode ser adicionado apenas se for estável e testado.
- Não bloquear o scroll da página quando o gesto começar fora do mapa.
- Garantir que controles de zoom, labels, pausa, recall e tela cheia tenham 44px de área de toque.
- Reorganizar ou agrupar controles em telas estreitas para não cobrir personagens ou ocupar toda a lateral.
- Tooltips não podem ser o único meio de entender uma ação em touch.
- Se Fullscreen API não funcionar no iOS, oferecer fallback visual de mapa expandido dentro da aplicação.
- Respeitar safe area quando expandido.
- Manter nomes de agentes e setores legíveis; nomes de setores podem iniciar ocultos no menor viewport se isso melhorar a visualização, sem remover o controle.
- Preservar integralmente simulação, colisões, conversas, warm-start, pausa e recall.
- Não modificar pathfinding ou estados da simulação sem necessidade comprovada de responsividade.
- Validar rotação de orientação e recalcular fit sem teleporte visível ou reset destrutivo.

## 11. Fase 4 — Páginas de listagem

### Agentes

- Barra de busca/filtros deve quebrar ou empilhar no telefone.
- Inputs e botões devem ocupar largura apropriada.
- Corrigir grids com `minmax(300px, 1fr)` que possam estourar em viewport de 320px; usar uma coluna que aceite `min(100%, ...)`.
- Agent cards devem quebrar textos longos e preservar ações.
- Estados vazios e botões de criação devem permanecer visíveis.

### Setores

- Cards/listas devem usar uma coluna no telefone.
- Nomes, descrições, badges e ações devem quebrar sem sobreposição.
- Preservar navegação para os detalhes.

### Canais/Widgets

- Abas devem ter scroll horizontal intencional ou layout adaptativo, com indicador de aba ativa visível.
- Grids internos de duas ou três colunas devem empilhar no menor viewport.
- Chaves, URLs, snippets e códigos devem usar contêiner rolável próprio, sem expandir a página.
- Botões copiar/editar/excluir devem continuar acessíveis.
- WhatsApp Manager e Widget Manager devem ser testados em todos os estados.

## 12. Fase 5 — Páginas de detalhe e formulários complexos

### AgentDetail

- O layout fixo `300px + 1fr` deve empilhar no telefone e em tablet estreito.
- Perfil/resumo vem antes do conteúdo principal.
- Cards de métricas usam auto-fit seguro.
- Abas usam scroll horizontal com foco e item ativo visível.
- Conteúdo de cada subseção deve respeitar a largura.
- Colegas, canais, setores e documentos não podem cortar nomes.

### AgentForm, ferramentas e aplicativos

- Auditar todas as seções, não apenas a primeira.
- Labels e campos devem empilhar quando necessário.
- Selects, textareas e inputs devem usar 100% da largura disponível.
- Evitar tamanho de fonte abaixo de 16px em inputs no iPhone para não provocar zoom automático, ou aplicar solução equivalente acessível.
- Botões de salvar/cancelar devem permanecer alcançáveis com teclado aberto.
- Linhas repetíveis devem permitir edição e remoção sem overflow.
- Grids de apps/ferramentas devem reduzir colunas progressivamente.
- Textos de ajuda não podem criar largura extra.

### SectorDetail e SectorForm

- Auditar todas as seções e modos de roteamento/pipeline.
- Cards de etapas e conexões devem empilhar.
- Não depender de linhas horizontais largas para representar o fluxo no telefone.
- Métricas usam uma coluna ou duas conforme espaço.
- Abas/subnavegação devem ser roláveis e acessíveis.
- Formulários e ações devem permanecer utilizáveis em 320px.

## 13. Fase 6 — Conversas e chat público

### ConversationsPanel e `/chats`

- No telefone, evitar lista de conversas e conversa aberta espremidas lado a lado.
- Implementar padrão master-detail: mostrar lista; ao selecionar, mostrar conversa com botão voltar.
- Em tablet/desktop, preservar duas colunas.
- Composer deve permanecer visível com teclado virtual.
- Mensagens, markdown, código, imagens e tool calls não podem ampliar a página.
- Bolhas devem ter largura máxima adequada e quebrar conteúdo longo.
- Scroll deve permanecer estável ao enviar/receber mensagens.

### `/widget/:publicKey`

- Substituir dependência rígida de `h-screen` por viewport móvel dinâmico seguro.
- Respeitar safe areas superior e inferior.
- Teclado virtual não pode esconder input e botão enviar.
- Header, histórico, avisos e composer devem coexistir sem sobreposição.
- Links e código dentro das mensagens devem quebrar ou rolar no próprio bloco.
- Testar loading, erro, sessão ativa e mensagens longas.

## 14. Fase 7 — Home, autenticação e configurações

### Home

- Header deve acomodar marca e ações em 320px.
- Hero deve empilhar de forma natural.
- Título deve usar `clamp()` sem ficar desproporcional.
- CTAs devem quebrar ou ocupar largura total quando necessário.
- Blocos demonstrativos, cards e benefícios devem reduzir para uma coluna quando necessário.
- Não remover informações para “resolver” mobile.

### Login e cadastro

- Formulário centralizado, mas com gutter adequado.
- Cards devem caber em 320px.
- Teclado, autofill, mensagens de erro e botão principal devem funcionar.
- Inputs não devem provocar zoom inesperado no iOS.
- Paisagem deve permitir scroll vertical.

### Settings

- Informações da conta, consumo e estatísticas devem empilhar.
- E-mails longos devem quebrar.
- Botões e danger actions devem ser acessíveis e não ficar lado a lado quando não houver espaço.

## 15. Fase 8 — Componentes compartilhados

Auditar e corrigir de forma central, evitando patches duplicados:

- `AppLayout`
- `Sidebar`
- `Topbar`
- `Card`
- `Button` e `IconButton`
- `Dialog` e `Modal`
- `Tabs`
- `Tooltip`
- `Select`, `Input`, `Textarea`, `Field`
- `Toast`
- `EmptyState`
- `AgentCard`
- `ConversationsPanel`
- Managers e forms complexos

### Modais e dialogs

- Largura máxima deve respeitar `calc(100vw - gutters)`.
- Altura máxima baseada em `dvh`.
- Conteúdo rolável e header/footer acessíveis.
- Teclado virtual não pode impedir submissão.
- Focus trap, Escape e retorno de foco devem continuar funcionando.
- Em telas muito pequenas, modal pode usar apresentação quase full-screen.

## 16. Fase 9 — Touch, acessibilidade e ergonomia

- Alvos interativos mínimos de 44 × 44px.
- Espaçamento suficiente entre ações destrutivas e ações comuns.
- Navegação completa por teclado no desktop.
- Focus visible preservado.
- `aria-label` para botões somente com ícone.
- `aria-expanded`, `aria-controls` e `aria-current` na navegação quando aplicável.
- Tooltips não podem depender apenas de hover.
- Não usar gestos como única forma de executar uma ação.
- Contraste e hierarquia visual devem permanecer equivalentes ao design atual.
- Respeitar `prefers-reduced-motion`.
- Testar zoom do navegador e tamanho de texto maior.

## 17. Fase 10 — Performance móvel

- Não duplicar árvores grandes para criar versões mobile e desktop quando CSS/estrutura adaptativa resolver.
- Evitar listeners de resize em excesso; preferir CSS e `ResizeObserver` quando necessário.
- Não recalcular o mapa ou a simulação a cada mudança irrelevante de viewport.
- Revisar imagens e sprites para não provocar layout shift.
- Preservar lazy loading existente.
- Medir bundle e registrar variação.
- Verificar interações em CPU móvel simulada sem exigir perfeição artificial.
- Não introduzir vazamentos de listeners, observers ou timers.

## 18. Fase 11 — Automação e testes

Adicionar uma estratégia de testes responsivos adequada ao projeto. Se ainda não houver E2E, preferir Playwright com configuração mínima e isolada.

### Testes automáticos mínimos

- Abrir cada rota principal em 320, 390, 768 e 1440px.
- Detectar overflow horizontal da página comparando `scrollWidth` e `clientWidth`.
- Confirmar que navegação móvel abre, navega e fecha.
- Confirmar que topbar e ações permanecem dentro do viewport.
- Confirmar que modais permanecem dentro da área visível.
- Confirmar que cards/listas mudam de coluna.
- Confirmar master-detail de conversas no telefone.
- Confirmar que OfficeMap recebe pan por toque e controles são clicáveis.
- Confirmar rotação/re-size do mapa.
- Confirmar chat público com teclado/viewport simulado na medida possível.
- Executar screenshots de regressão nas rotas principais.

Não criar testes frágeis baseados em delays arbitrários. Usar estados e seletores estáveis.

## 19. Evidência visual para conferência pelo telefone

Criar a pasta `docs/qa/responsive/` com capturas finais otimizadas, preferencialmente WebP ou PNG comprimido.

Gerar pelo menos:

- `dashboard-390x844`
- `office-map-390x844`
- `mobile-navigation-390x844`
- `agents-390x844`
- `agent-detail-390x844`
- `sectors-390x844`
- `sector-detail-390x844`
- `channels-390x844`
- `conversations-list-390x844`
- `conversation-open-390x844`
- `settings-390x844`
- `home-390x844`
- `login-390x844`
- `public-widget-390x844`
- Uma comparação tablet e desktop do dashboard.

No `RESPONSIVE_QA_REPORT.md`:

- Incorporar ou linkar as imagens.
- Informar rota, viewport, estado testado e resultado.
- Listar limitações reais.
- Explicar como o usuário poderá visualizar as evidências pelo GitHub depois do push autorizado.
- Não incluir tokens, e-mails reais, chaves, mensagens privadas ou dados sensíveis nas imagens.

## 20. Verificação final obrigatória

Executar:

- Testes unitários existentes.
- Testes do escritório existentes.
- Novos testes responsivos/E2E.
- Typecheck.
- Lint.
- Build do frontend.
- Build geral do projeto.
- Verificação de instalação limpa quando o lockfile for alterado.
- Inspeção visual final da matriz de viewports.

Registrar comandos e resultados no relatório.

## 21. Ordem sugerida de commits

1. `test(responsive): add viewport audit baseline`
2. `feat(responsive): adapt app shell and mobile navigation`
3. `fix(responsive): adapt shared components and dialogs`
4. `fix(responsive): adapt dashboard and office map`
5. `fix(responsive): adapt listings and detail pages`
6. `fix(responsive): adapt forms managers and settings`
7. `fix(responsive): adapt conversations and public widget`
8. `fix(responsive): adapt home and authentication`
9. `test(responsive): add mobile e2e coverage and screenshots`
10. `docs(responsive): add final QA report`

Não criar commits vazios. Ajustar a divisão se a arquitetura local atual exigir, preservando commits pequenos e coerentes.

## 22. Critérios finais de aceite

- [x] Worktree e commits locais da implementação anterior foram preservados.
- [x] Todas as rotas da matriz foram auditadas.
- [x] Viewports de 320px a desktop foram testados.
- [x] Não existe overflow horizontal acidental da página.
- [x] O rail desktop não reserva espaço no telefone.
- [x] Existe navegação móvel completa e acessível.
- [x] Topbar, títulos, badges e ações não se sobrepõem.
- [x] Gutter e safe areas funcionam no iPhone.
- [x] Dashboard e métricas se adaptam.
- [x] OfficeMap permanece completo e utilizável por toque.
- [x] Controles do mapa possuem área de toque adequada.
- [x] Rotação do telefone não quebra ou reseta incorretamente o mapa.
- [x] Lists e cards funcionam em 320px.
- [x] AgentDetail e SectorDetail empilham corretamente.
- [x] Todas as subseções e formulários foram testados.
- [x] Abas possuem comportamento mobile claro.
- [x] Canais e managers não transbordam.
- [x] Conversas usam master-detail no telefone.
- [x] Chat público lida com `dvh`, safe area e teclado virtual.
- [x] Home, login, cadastro e configurações estão responsivos.
- [x] Modais e dialogs cabem no viewport e mantêm ações acessíveis.
- [x] Textos, e-mails, URLs e códigos longos não quebram o layout.
- [x] Touch targets e acessibilidade foram validados.
- [x] `prefers-reduced-motion` foi preservado.
- [x] Não houve alteração de backend ou regras de negócio.
- [x] Não foi implementado deploy nesta etapa.
- [x] Testes, typecheck, lint e builds passam.
- [x] Screenshots mobile finais foram geradas sem dados sensíveis.
- [x] `RESPONSIVE_QA_REPORT.md` documenta evidências e limitações.

## 23. Entrega final do Claude Code

Ao terminar, responder com:

1. Branch e commit-base usados.
2. Situação entre branch local e `origin/development`.
3. Resumo das correções por rota.
4. Componentes compartilhados alterados.
5. Arquivos alterados.
6. Testes e comandos executados com resultados.
7. Caminho do `RESPONSIVE_QA_REPORT.md` e das screenshots.
8. Limitações ainda existentes.
9. Commits criados.
10. Confirmação de que não houve deploy, push ou merge.

