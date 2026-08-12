# Office Visual Simulation V2

> **Projeto-alvo:** `https://github.com/Gabrielleobeltrao/ComunicacaoAI`
>
> **Branch-base:** `development`
>
> **Área exclusiva:** mapa visual do escritório virtual, personagens, movimentação, colisões, interações, controles e decoração.
>
> **Atenção:** este plano NÃO pertence ao Web Builder e não deve alterar nenhum recurso do Website Builder. O comando usado como referência em outra conversa serviu apenas para demonstrar o formato Base64 + Bzip2.

## 1. Objetivo

Aprimorar exclusivamente a experiência visual e a simulação do escritório virtual da página inicial/dashboard.

A implementação deve tornar o escritório vivo imediatamente, permitir que os agentes caminhem de forma contínua e segura dentro e fora das salas, adicionar interações simples entre personagens, compactar moderadamente o cenário, enriquecer a decoração e disponibilizar controles de pausa e retorno às mesas.

A alteração deve preservar:

- A composição atual das salas.
- A posição centralizada do conjunto de salas.
- O vínculo entre agente, departamento, sala, mesa e cadeira.
- O rodízio visual de personagens.
- Os recursos atuais de zoom, nomes, debug e acessibilidade.
- O restante do dashboard e da aplicação.
- Todas as integrações existentes.

## 2. Escopo estritamente visual

Esta implementação pode alterar somente o frontend relacionado ao escritório virtual.

Pode alterar:

- Layout visual do escritório.
- Espaçamento entre salas.
- Limites da área de circulação.
- Simulação local dos personagens.
- Pathfinding e colisões.
- Estados visuais dos agentes.
- Sprites e animações.
- Decoração visual.
- Controles do mapa.
- Testes do frontend relacionados ao escritório.

Não pode alterar:

- Backend.
- Banco de dados.
- APIs.
- Modelos persistidos.
- Regras reais de negócio.
- Execução dos agentes de IA.
- Status reais dos agentes.
- Autenticação.
- Outras páginas da aplicação.

Qualquer status de trabalho, ligação, descanso ou conversa criado neste plano deve ser exclusivamente visual e local.

## 3. Diagnóstico da implementação atual

Antes de modificar, confirmar o estado atual da branch `development`.

A implementação existente já possui uma base adequada:

- `OfficeFloor.tsx`
- `officeSimCore.ts`
- `useOfficeSimulation.ts`
- `buildOfficeLayout.ts`
- `buildNavigationGrid.ts`
- `findOfficePath.ts`
- `placeOfficeDecor.ts`
- `officeSprites.ts`
- `AgentSprite.tsx`
- `SimAgent.tsx`
- `OfficeDebugOverlay.tsx`
- Sprites de caminhada normal e em ligação.
- Grid de navegação.
- Pathfinding.
- Reservas de células.
- Feature flags.
- Testes automatizados.

Entretanto, os seguintes problemas devem ser considerados abertos:

- Agentes parados podem deixar de ocupar formalmente sua célula.
- Uma rota pode atravessar um agente pausado.
- Agentes sem mesa podem começar sem célula ocupada.
- Pontos de interação com capacidade maior que um podem sobrepor personagens.
- O teste atual de colisão verifica reservas, mas não necessariamente a posição real dos pés.
- O limite de agentes ativos pode momentaneamente ultrapassar a capacidade configurada.
- Ao falhar uma rota de retorno, o agente pode ser teleportado para perto da cadeira.
- A pausa no meio de um percurso foi configurada, mas não está totalmente implementada.
- A saída da cadeira não apresenta uma caminhada visual completa de dentro da sala até a porta.
- Os agentes quase não caminham dentro das próprias salas.
- Os destinos externos podem levar os agentes longe demais do conjunto de salas.
- A tela inicialmente parece parada e só ganha movimento gradualmente.
- Direita e esquerda ainda podem reutilizar visualmente os sprites frontais.
- A atribuição visual de personagens pode mudar quando a lista de agentes muda.
- A instalação limpa em Linux precisa ser validada.
- Alguns critérios do plano anterior foram marcados como concluídos sem testes suficientemente rigorosos.

## 4. Regras gerais de implementação

- Não reescrever o escritório inteiro.
- Evoluir a arquitetura atual.
- Manter a simulação determinística quando uma seed for fornecida.
- Não usar movimento livre ignorando o grid.
- Não usar teleporte durante uma simulação visível.
- Não mascarar colisões apenas com `z-index`.
- Não bloquear portas com decoração ou interações.
- Não marcar tarefas como concluídas sem teste ou verificação.
- Preservar as feature flags e o modo de debug existentes.
- Separar lógica pura de simulação da camada React.
- Evitar renderização React a cada frame quando não for necessária.
- Respeitar `prefers-reduced-motion`.
- Garantir funcionamento em diferentes tamanhos de tela.

## 5. Fase 0 — Baseline e proteção contra regressões

Antes das mudanças:

1. Atualizar a branch local com a versão mais recente de `development`.
2. Verificar o working tree e preservar alterações existentes do usuário.
3. Registrar o commit-base usado na implementação.
4. Executar os testes atuais do escritório.
5. Executar build e lint do frontend.
6. Executar o build geral do projeto.
7. Registrar visualmente o estado atual do escritório em viewport desktop e menor.
8. Mapear salas, portas, mesas, cadeiras, corredores, pontos de interação, área caminhável e objetos bloqueadores ou apenas decorativos.

Se o baseline já estiver quebrado, documentar separadamente antes de modificar.

## 6. Fase 1 — Compactação moderada do mapa

O espaço entre as salas está maior que o desejado. Reduzir moderadamente o espaçamento, sem alterar a organização central atual.

### Requisitos

- Manter as salas nas mesmas posições relativas.
- Não reconstruir o layout.
- Não mudar a sala de departamento.
- Não inverter ou reorganizar setores.
- Reduzir os vãos aproximadamente entre 15% e 25%, sujeito à validação visual.
- Usar como primeira tentativa a redução de `GAP_RINGS` de `3` para `2`, se esse ainda for o parâmetro vigente.
- Não reduzir abaixo da largura segura exigida pelos personagens e pelo pathfinding.
- Preservar corredores navegáveis e todas as portas acessíveis.
- Impedir sobreposição de salas, paredes, móveis ou personagens.
- Recalcular os bounds depois da compactação.
- Centralizar novamente o conjunto completo sem mudar sua composição.
- Validar zoom-to-fit e responsividade.

O escritório deve parecer mais unido e menos espalhado, mas ainda deve existir separação clara entre as salas.

## 7. Fase 2 — Limite invisível da área de atividade

Criar uma `activity envelope`, ou área invisível de atividade, para impedir que agentes caminhem para regiões vazias e muito afastadas.

A área permitida deve ser formada pela união de:

- Interior navegável das salas.
- Corredores entre as salas.
- Portas e células de transição.
- Uma margem externa controlada ao redor do conjunto.
- Pontos externos explicitamente aprovados.

### Regras

- Expandir o contorno das salas por uma margem aproximada de 2,5 a 4 células.
- Intersectar essa área com o grid caminhável.
- Não gerar destinos aleatórios em todo o retângulo do mapa.
- Não utilizar extremidades vazias apenas porque são caminháveis.
- Manter qualquer agente sem mesa dentro dessa área.
- Pontos externos devem ser intencionais e próximos do escritório.
- A borda deve ser invisível no modo normal e visível no debug.
- Shrink-wrap dos bounds visuais pode ser aplicado se não cortar decoração ou controles.

Durante uma simulação prolongada, nenhuma posição de destino ou posição real dos pés pode sair da `activity envelope`.

## 8. Fase 3 — Ocupação física e colisões reais

Separar formalmente:

- `occupiedCell`: célula atualmente ocupada pelos pés do agente.
- `reservedNextCell`: próxima célula reservada durante o movimento.

Todo agente em pé deve manter uma `occupiedCell`, inclusive quando estiver andando, esperando rota, pausado, conversando, esperando outro agente, levantando, retornando ou temporariamente bloqueado.

A célula ocupada não pode expirar por timeout enquanto o agente estiver nela. Reservas futuras podem expirar ou ser recalculadas, mas nunca devem substituir o registro da posição física atual.

O pathfinding deve evitar:

- Paredes.
- Móveis bloqueadores.
- Células ocupadas.
- Células futuras reservadas por outro agente.
- Slots de conversa reservados.
- Portas temporariamente congestionadas, quando houver alternativa.

Antes de iniciar a animação de levantar, o agente deve ocupar ou reservar corretamente sua célula de saída.

Corrigir a concorrência para que novos agentes só sejam iniciados quando `movingCount < movingCapacity`, nunca permitindo `movingCapacity + 1`.

Nenhum ponto com capacidade maior que um pode representar uma única coordenada física. Criar slots físicos distintos ou reduzir a capacidade para um.

### Testes obrigatórios

- Comparar posições reais dos pés em cada tick.
- Executar milhares de ticks com vários agentes.
- Falhar se dois agentes ocuparem a mesma célula.
- Incluir agentes andando, pausados, conversando e aguardando.
- Incluir agentes com mesa e sem mesa.
- Verificar ocupação durante a animação de levantar.
- Verificar limite estrito de concorrência.

## 9. Fase 4 — Saída contínua da cadeira e circulação dentro das salas

Eliminar completamente o teleporte visual quando o agente sai da mesa.

### Sequência mínima

1. Agente sentado na cadeira.
2. Início da animação de levantar.
3. Posicionamento ao lado ou à frente da cadeira.
4. Caminhada dentro da própria sala.
5. Aproximação interna da porta.
6. Travessia da porta.
7. Entrada no corredor.
8. Continuação até o destino.

Não pode haver salto direto da mesa para fora da sala.

Cada sala deve possuir, quando possível: `seatExit`, `interiorWorkPoint`, `interiorIdlePoint`, `doorInside`, `doorOutside`, `socialSlots` e `decorSafePoints`. Rotas de entrada usam a sequência inversa.

Se uma rota estiver temporariamente bloqueada, o agente deve esperar, manter sua célula ocupada, tentar novamente e procurar alternativa válida. Nunca finalizar o retorno enquanto não estiver fisicamente na saída da cadeira e nunca alterar diretamente a posição para simular chegada.

Criar teste de continuidade que limite o deslocamento máximo por frame. Saltos só podem existir durante inicialização invisível, antes do primeiro paint.

## 10. Fase 5 — Caminhada dentro da sala de origem

Criar pontos navegáveis no interior das salas respeitando paredes, mesas, cadeiras, objetos, portas, circulação e células ocupadas.

Aplicar pesos configuráveis, usando como referência inicial:

- 50% a 65%: destinos dentro da sala do próprio departamento.
- 20% a 30%: corredores e regiões próximas.
- 10% a 20%: pontos externos aprovados ou interações.
- Visitas a outras salas somente com destino permitido e rota segura.

### Comportamento desejado

- Mais agentes caminhando dentro das salas.
- Um agente pode levantar, caminhar dentro da sala, parar e retornar sem sair dela.
- Um agente pode atravessar a porta para outro destino.
- A sala deve continuar legível, sem congestionamento permanente.
- Portas nunca devem ser escolhidas como ponto de pausa.
- Não obrigar todos os agentes a sair ao mesmo tempo.

## 11. Fase 6 — Pausa durante o percurso

Implementar de fato a pausa intermediária já prevista:

- Pausar somente ao concluir uma célula ou segmento.
- Nunca parar entre células.
- Manter a célula atual ocupada.
- Preservar o restante da rota.
- Retomar a mesma rota se continuar válida.
- Recalcular somente quando houver bloqueio real.
- Não pausar em portas, passagens estreitas ou pontos de cadeira.
- Variar duração e probabilidade com seed determinística.
- Limitar pausas consecutivas.

## 12. Fase 7 — Interação visual entre dois personagens

Adicionar conversa visual simples sem exigir nova animação desenhada.

### Funcionamento

1. Selecionar dois agentes elegíveis, preferencialmente da mesma sala ou setor.
2. Reservar dois slots físicos distintos.
3. Levar cada agente ao seu slot.
4. Aguardar ambos chegarem.
5. Virar os agentes um de frente para o outro.
6. Permanecer parados por um intervalo curto.
7. Encerrar a interação e liberar os slots.
8. Retomar uma rota ou retornar ao contexto anterior.

Se alinhados verticalmente, um usa frente e o outro costas. Se alinhados horizontalmente, usar direita e esquerda. A distância sugerida é de 0,8 a 1,2 células visuais, adaptada aos sprites.

Adicionar estados equivalentes a `social-requested`, `social-walking`, `social-waiting`, `socializing`, `social-finished` e `social-cancelled`, com `pairId`, `partnerId`, dois slots, timeouts e cancelamento seguro.

Não iniciar conversa em portas ou corredores estreitos, com agente retornando à mesa ou já interagindo. Cancelar com segurança se um agente desaparecer. Nenhum cancelamento pode teleportar personagens. Limitar conversas simultâneas pela capacidade do escritório.

## 13. Fase 8 — Escritório vivo desde o primeiro frame

Implementar warm-start determinístico antes do primeiro paint visível:

- Criar estado inicial puro da simulação.
- Fazer pre-roll interno equivalente a aproximadamente 15 a 30 segundos.
- Executar sem renderização DOM.
- Usar a mesma seed.
- Validar ocupações e reservas durante o pre-roll.
- Renderizar diretamente o snapshot resultante.

Ao abrir o dashboard já deve existir movimento. Alguns agentes podem estar dentro das salas, no corredor, pausados ou em conversa; os demais podem estar sentados ou trabalhando. Não deve existir uma onda artificial na qual todos começam um por um.

Como referência, iniciar entre 35% e 50% dos agentes em estados visivelmente ativos, respeitando densidade e segurança. O objetivo é o escritório parecer vivo imediatamente, e não obrigar literalmente todos a caminhar simultaneamente.

## 14. Fase 9 — Controle de pausar e retomar

Adicionar ao conjunto de controles à direita, próximo ao zoom e aos nomes, um botão de pausa.

Ao pausar:

- Congelar agentes na posição exata.
- Congelar o frame atual do sprite.
- Congelar conversas e timers visuais.
- Não avançar o relógio lógico.
- Não deixar reservas expirarem.
- Não recalcular destinos ou liberar células ocupadas.

Ao retomar:

- Reiniciar a referência de tempo para evitar salto de `deltaTime`.
- Continuar do mesmo ponto.
- Revalidar rotas apenas quando necessário.
- Não acelerar para compensar o período pausado.

Usar ícones de pausar/reproduzir, tooltip, `aria-label`, estado pressionado acessível e o padrão visual dos controles existentes. Essa pausa é diferente de `prefers-reduced-motion`.

## 15. Fase 10 — Controle “retornar às mesas”

Adicionar outro botão na mesma área. Ao clicar:

1. Entrar no modo global `recall`.
2. Impedir novas saídas e conversas.
3. Cancelar interações com segurança.
4. Preservar células fisicamente ocupadas.
5. Calcular rotas de retorno.
6. Distribuir partidas para evitar congestionamento.
7. Fazer cada agente atravessar a porta correta.
8. Caminhar até a saída da própria cadeira.
9. Executar transição para sentado.
10. Deixar o escritório estático/pausado quando todos chegarem.

Agentes sem cadeira retornam a um `homePoint` válido e estável.

Não teleportar. Se a rota estiver bloqueada, esperar e tentar novamente. Não colocar agentes na mesma porta ou cadeira. Exibir progresso no botão, indicar quando todos chegaram e permitir retomar a simulação pelo play.

## 16. Fase 11 — Sprites direcionais e estados visuais

### Quatro direções reais

Verificar os recursos existentes do Claude Design e priorizar sprites reais de frente, costas e perfil lateral, usando espelhamento para o lado oposto quando adequado.

Cada direção deve possuir, quando disponível:

- Parado normal.
- Caminhada normal de quatro frames.
- Parado em ligação.
- Caminhada em ligação de quatro frames.

Não considerar concluído se direita e esquerda continuarem parecendo sprites frontais. Se só houver arte lateral para um lado, espelhar somente o perfil lateral. Revisar textos e acessórios assimétricos.

### Estado visual local

Criar controlador exclusivamente visual para `normal`, `working`, `thinking`, `phone` e `socializing`.

- Trabalhando ou pensando pode usar a versão em ligação/telefone conforme a linguagem visual existente.
- Ocioso usa a pose normal.
- Conversando usa pose normal orientada ao parceiro.
- O estado visual não altera status real no backend.
- Manter interface preparada para futura fonte real de status.

### Distribuição dos personagens

- Evitar que todos troquem de aparência quando um agente é adicionado.
- Usar atribuição determinística estável.
- Usar mais personagens aprovados quando existirem.
- Evitar repetição enquanto houver opções.
- Pode haver mapeamento frontend-local persistido, sem alterar modelos ou backend.
- Implementar fallback determinístico sem armazenamento local.

## 17. Fase 12 — Mais detalhes no cenário

Adicionar aproximadamente 20% a 35% mais detalhes visuais, ajustando pela área disponível.

Separar objetos em bloqueadores, não bloqueadores, decoração de parede, fundo e piso.

Exemplos: plantas, tapetes, quadros, murais, luminárias, prateleiras, armários pequenos, vasos, mesas laterais, placas de departamento, objetos temáticos, detalhes de corredor e elementos externos próximos.

### Regras

- Nunca bloquear portas, esconder agentes ou comprometer rotas.
- Não preencher todos os espaços.
- Manter áreas de respiro.
- Preferir parede e fundo quando o piso já estiver ocupado.
- Variar a decoração de forma coerente com cada setor.
- Indicar bloqueadores no debug.
- Manter decoração determinística pela seed.
- Não expandir o mapa para acomodar decoração.

## 18. Fase 13 — Desempenho

- Manter o loop principal fora de rerenders React por frame quando possível.
- Não executar A* para todos os agentes em todos os frames.
- Usar cache ou invalidação somente quando seguro.
- Limitar tentativas de destino e conversas simultâneas.
- Manter warm-start como lógica pura.
- Não carregar sprites nunca utilizados.
- Revisar impacto dos assets no bundle.
- Preservar carregamento progressivo.
- Testar com número alto de agentes.
- Não introduzir vazamentos de timers, listeners ou `requestAnimationFrame`.

## 19. Fase 14 — Acessibilidade e movimento reduzido

Com `prefers-reduced-motion`, não executar caminhada contínua, manter o escritório funcional e legível, preservar controles e evitar flashes. O retorno pode usar transição simplificada.

Os botões novos devem possuir contraste, foco de teclado, `aria-label`, estado ativo identificável e área clicável consistente.

## 20. Fase 15 — Debug visual

Expandir o `OfficeDebugOverlay` para visualizar opcionalmente:

- Grid navegável.
- Células bloqueadas.
- `occupiedCell`.
- `reservedNextCell`.
- Rotas.
- Portas.
- Slots de conversa.
- Interior das salas.
- `activity envelope`.
- Pontos de destino e retorno.
- Estado atual do agente.
- Pair ID de conversas.
- Modo global pausado ou recall.

O debug não pode aparecer em produção por padrão.

## 21. Testes automatizados obrigatórios

### Colisão

- Nenhuma célula real dos pés compartilhada em milhares de ticks.
- Agentes pausados e esperando continuam bloqueando a célula.
- Conversas usam slots diferentes.
- Agentes sem mesa ocupam uma célula.
- Capacidade global nunca ultrapassada.

### Continuidade

- Nenhum teleporte ao sair da cadeira, retornar ou falhar uma rota.
- Deslocamento por frame dentro do limite.
- Retorno só termina ao chegar fisicamente ao ponto correto.

### Salas e portas

- Agentes caminham dentro da própria sala.
- Rotas externas atravessam a porta correta.
- Nenhuma rota atravessa paredes.
- Portas acessíveis após compactação e decoração.
- Pausas não acontecem em portas.

### Área de atividade

- Nenhum destino ou posição real fora da `activity envelope`.
- Agentes sem mesa iniciam dentro da área.
- Destinos externos ficam próximos.

### Conversas

- Duas células distintas e orientações opostas.
- Timeout e cancelamento seguros.
- Reservas sempre liberadas.
- Nenhuma conversa bloqueia porta.

### Warm-start

- Primeiro snapshot contém atividade.
- Estado inicial determinístico pela seed.
- Sem colisões após pre-roll.
- Sem salto após primeiro paint.

### Pausa

- Posição, frame e estado lógico não mudam.
- Reserva não expira.
- Retomar não causa salto temporal.

### Recall

- Todos retornam ao `home` e terminam sentados ou no `homePoint`.
- Sem colisões ou teleporte.
- Sem novas interações durante recall.
- Estado final pausado.

### Layout

- Espaçamento menor que o anterior, mas maior que o mínimo navegável.
- Salas centralizadas, sem sobreposição.
- Zoom-to-fit correto.

## 22. Verificação técnica obrigatória

Executar ao final:

- Testes do frontend.
- Testes específicos do escritório.
- Lint do frontend.
- Build do frontend.
- Build geral do projeto.
- Verificação TypeScript.
- Instalação limpa em ambiente Linux.

Corrigir o lockfile caso `npm ci` limpo não instale corretamente dependências opcionais como Tailwind Oxide para Linux, binding Oxc/Oxlint para Linux e binding TypeScript nativo para Linux.

A validação deve ocorrer em clone ou diretório temporário limpo, sem depender de módulos instalados manualmente.

## 23. QA visual manual

Validar desktop largo, notebook, viewport menor, zoom mínimo e máximo, nomes ligados/desligados, pausa, movimento, conversa, recall, `prefers-reduced-motion`, poucos e muitos agentes, agentes com e sem mesa e entrada/saída de todas as salas.

Observar profundidade, `z-index`, pés no piso, relação com mesa/cadeira, travessia das portas, direções dos sprites, imagens quebradas, flicker, congestionamento, espaços vazios e excesso de decoração.

## 24. Feature flags e rollback

Preservar flags existentes e adicionar flags específicas quando necessário para simulação V2, conversas, warm-start, activity envelope, decoração expandida, sprites laterais e controles de pausa/recall.

Deve ser possível desativar a nova simulação sem afetar o dashboard. Não remover o fallback estático antes da validação final.

## 25. Ordem recomendada de commits

1. Baseline, tipos e testes de regressão.
2. Compactação do layout e activity envelope.
3. Ocupação física e reservas.
4. Correção de teleporte e rotas de cadeira/porta.
5. Destinos internos das salas.
6. Pausas intermediárias.
7. Conversas entre agentes.
8. Warm-start.
9. Controles de pausa e recall.
10. Sprites direcionais e estados visuais.
11. Decoração adicional.
12. Acessibilidade, debug e desempenho.
13. Lockfile, validação limpa e documentação.

Cada commit deve ser pequeno, coerente e testável.

## 26. Critérios finais de aceite

- [ ] O mapa está moderadamente mais compacto.
- [ ] As salas continuam centralizadas e na mesma composição.
- [ ] Os agentes não caminham para áreas vazias distantes.
- [ ] Existe uma área invisível de atividade.
- [ ] Os agentes caminham dentro das próprias salas.
- [ ] A saída da cadeira até a porta é contínua.
- [ ] Não existe teleporte visível.
- [ ] Nenhum agente atravessa paredes ou objetos.
- [ ] Nenhum agente ocupa a mesma célula de outro.
- [ ] Agentes parados continuam ocupando fisicamente suas células.
- [ ] A capacidade de movimento nunca é ultrapassada.
- [ ] Existem pausas intermediárias naturais.
- [ ] Dois agentes conseguem conversar olhando um para o outro.
- [ ] Conversas utilizam posições físicas distintas.
- [ ] O dashboard abre visualmente ativo.
- [ ] O botão de pausa congela toda a simulação.
- [ ] Retomar não causa saltos.
- [ ] O botão de retorno leva todos às cadeiras sem teleporte.
- [ ] O cenário possui mais detalhes sem ficar poluído.
- [ ] Portas e rotas permanecem livres.
- [ ] Frente, costas e laterais funcionam visualmente.
- [ ] A distribuição de personagens permanece estável.
- [ ] `prefers-reduced-motion` funciona.
- [ ] Debug e feature flags continuam disponíveis.
- [ ] Testes, lint e builds passam.
- [ ] `npm ci` funciona em ambiente Linux limpo.
- [ ] Nenhuma alteração de backend, API ou banco foi realizada.
