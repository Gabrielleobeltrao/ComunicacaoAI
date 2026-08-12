# Deployment Readiness & Docker Separation Plan

> **Projeto-alvo:** `https://github.com/Gabrielleobeltrao/ComunicacaoAI`
>
> **Objetivo desta etapa:** auditar e preparar o sistema para um deploy futuro em VPS/Coolify, deixando frontend e backend independentes, conteinerizados e prontos para futuramente ocuparem dois repositórios Git distintos.
>
> **Não executar ainda:** criação de recursos na VPS, criação de projetos no Coolify, DNS, domínio, SSL, deploy público, migração de dados ou criação dos dois repositórios remotos.

## 1. Contexto e resultado esperado

O sistema possui um frontend React/Vite e um backend Node/Express, atualmente organizados como workspaces em um monorepo. O objetivo final será operar dois serviços separados:

1. **Frontend:** aplicação estática compilada e servida por um servidor web leve.
2. **Backend:** API, autenticação, webhooks e Socket.IO executados em processo Node independente.

Nesta etapa, os dois diretórios devem se tornar autocontidos o suficiente para que seja possível, posteriormente:

- Criar um repositório Git somente com `frontend/`.
- Criar outro repositório Git somente com `backend/`.
- Conectar cada repositório a um recurso separado no Coolify.
- Fazer build e deploy independentes.
- Atualizar um serviço sem reconstruir obrigatoriamente o outro.

O monorepo atual deve continuar funcionando durante a preparação. A separação remota será feita somente em uma etapa posterior, quando nomes dos repositórios, URLs e domínio estiverem definidos.

## 2. Regras de segurança

- Inspecionar `git status`, branch, commits locais e divergência com o remoto antes de qualquer alteração.
- A implementação do escritório e da responsividade pode estar apenas na branch local. Preservar tudo.
- Não executar `git pull`, reset, rebase, checkout destrutivo ou troca de branch antes de entender o estado local.
- Não fazer push ou merge sem autorização.
- Não criar repositórios GitHub automaticamente.
- Não conectar na VPS ou no Coolify.
- Não modificar DNS.
- Não usar URLs fictícias como valores reais de produção.
- Não criar, copiar, imprimir ou commitar segredos.
- Nunca colocar chaves privadas em `VITE_*`, pois variáveis Vite ficam expostas no bundle do navegador.
- Não incluir `.env`, banco, tokens, certificados, dumps ou dados reais na imagem Docker.
- Manter desenvolvimento local funcionando.
- Não alterar regras dos agentes ou funcionalidades visuais sem necessidade de deploy comprovada.

## 3. Estado conhecido a confirmar no código local

Na versão pública anteriormente observada:

- A raiz utiliza npm workspaces para `frontend` e `backend`.
- Existe somente um `package-lock.json` na raiz.
- Frontend utiliza React, Vite e TypeScript.
- Backend utiliza Node, Express, TypeScript, MongoDB, Better Auth e Socket.IO.
- Frontend lê `VITE_API_URL`.
- Backend lê `PORT`, `MONGODB_URI`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `CLIENT_URL`, `PUBLIC_URL`, `ENCRYPTION_KEY` e variáveis de integrações/provedores.
- CORS privado aceita uma única `CLIENT_URL` com credentials.
- Rotas públicas de widget refletem a origem sem credentials.
- Socket.IO usa `CLIENT_URL` como origem.
- Existe `/api/health`, mas ele apenas retorna `ok` e não valida MongoDB.
- Uploads observados utilizam memória; persistência final precisa ser confirmada.
- Não foram observados Dockerfiles ou documentação completa de produção.

O Claude Code deve verificar o estado local mais recente. Não assumir que esta lista continua exata.

## 4. Fora de escopo desta etapa

- Deploy real.
- URLs definitivas.
- Certificados TLS.
- Configuração do proxy da VPS.
- Credenciais reais.
- Criação de MongoDB ou migração de cluster.
- Alteração de provedor de banco.
- Execução de migrations contra produção.
- Backup ou restauração de produção.
- Configuração real do Google OAuth, Meta, WhatsApp ou Twilio.
- Configuração real de webhooks externos.
- Observabilidade paga.
- CI/CD com acesso à VPS.

## 5. Fase 0 — Auditoria do estado local

Executar e registrar em `DEPLOYMENT_READINESS_REPORT.md`:

- `git status --short --branch`
- `git log --oneline --decorate -20`
- branch atual e HEAD.
- diferença entre HEAD local e `origin/development`.
- arquivos não rastreados e alterações não commitadas.
- versão local de Node e npm.
- estrutura de workspaces.
- scripts de build/start/test/lint.
- dependências nativas e opcionais.
- todos os arquivos `.env.example`.
- todos os usos de `process.env` e `import.meta.env`.
- todos os endpoints HTTP, webhooks e Socket.IO.
- fluxos de autenticação e cookies.
- arquivos escritos no disco em runtime.
- migrations executadas no boot.
- dependências externas e callbacks.

Executar baseline existente de testes, typecheck, lint e builds antes de alterar.

## 6. Fase 1 — Inventário de arquitetura e dependências

Criar no relatório uma tabela com:

- Serviço.
- Runtime.
- Porta interna.
- Comando de build.
- Comando de produção.
- Health endpoint.
- Dependências externas.
- Dados persistentes.
- Variáveis obrigatórias.
- Variáveis opcionais.
- URLs públicas futuras.
- Integrações que exigem callback.

### Auditar explicitamente

- MongoDB e forma de seleção do database.
- Better Auth, cookies e trusted origins.
- CORS HTTP.
- Socket.IO e CORS do WebSocket.
- `credentials: include` no frontend.
- Widget loader e widgets incorporados em domínios de terceiros.
- URLs geradas para webhooks de WhatsApp.
- Google OAuth redirect URI.
- Uploads de documentos e avatares.
- Armazenamento de chaves criptografadas.
- Migrations automáticas no boot.
- Encerramento gracioso.
- Limites de payload/upload.
- Chamadas para Anthropic, OpenAI, Voyage, Google, Meta e Twilio.

## 7. Fase 2 — Contrato de URLs (domínios definitivos)

**Atualizado:** as URLs definitivas de produção foram fornecidas (ASCII, sem
Punycode, sem barra final):

- `FRONTEND_PUBLIC_URL=https://comunicacaoai.onplataform.com`
- `BACKEND_PUBLIC_URL=https://api.comunicacaoai.onplataform.com`

> Histórico: durante a preparação os exemplos usavam o TLD reservado `.invalid`.
> Agora substituídos pelos domínios reais acima. Não usar Punycode — o DNS é
> totalmente ASCII, sem acento e sem cedilha.

Mapeamento das variáveis para o contrato:

### Frontend

- `VITE_API_URL`: origem pública completa do backend, sem barra final.

### Backend

- `PORT`: porta interna do container.
- `CLIENT_URL` ou nova allowlist equivalente: origem pública do frontend.
- `BETTER_AUTH_URL`: origem pública do backend.
- `PUBLIC_URL`: origem pública do backend usada em webhooks.
- `GOOGLE_REDIRECT_URI`: callback completo quando Google for configurado.

Centralizar normalização de URLs:

- Remover barra final de maneira controlada.
- Validar protocolo e formato no startup.
- Falhar cedo em produção quando variável obrigatória estiver ausente.
- Não aplicar defaults localhost silenciosos quando `NODE_ENV=production`.
- Manter defaults locais somente em desenvolvimento/teste.

## 8. Fase 3 — Fronteira real entre os dois serviços

Verificar se `frontend/` importa qualquer código da raiz ou de `backend/`, e vice-versa.

O resultado obrigatório é:

- Frontend compilável usando somente arquivos contidos em `frontend/`.
- Backend compilável e executável usando somente arquivos contidos em `backend/`.
- Nenhum import relativo atravessando a fronteira dos diretórios.
- Nenhuma dependência runtime escondida no `package.json` da raiz.
- Nenhum script de produção dependendo de `concurrently`.
- Assets necessários incluídos no diretório correto.

### Locks independentes

Cada serviço deve possuir lockfile próprio e verificável:

- `frontend/package-lock.json`
- `backend/package-lock.json`

Gerar os locks de forma compatível com Linux e com a versão de npm definida pelo projeto. Testar `npm ci` dentro de cada diretório isoladamente.

Preservar os scripts/workspaces da raiz para desenvolvimento local, se ainda forem úteis. Documentar como evitar divergência entre o lockfile da raiz e os locks dos serviços. Se manter três lockfiles causar risco real, propor e implementar a estratégia mais segura que permita builds isolados, explicando a decisão no relatório.

## 9. Fase 4 — Dockerfile do frontend

Criar `frontend/Dockerfile` com multi-stage build.

### Build stage

- Usar imagem Node LTS específica, fixada ao menos por major/minor apropriado.
- Definir `WORKDIR` não privilegiado.
- Copiar primeiro `package.json` e lockfile para aproveitar cache.
- Executar `npm ci`.
- Copiar somente arquivos necessários.
- Receber `VITE_API_URL` como build argument ou variável de build explicitamente documentada.
- Executar typecheck/build de produção.
- Não carregar segredos no build.

### Runtime stage

- Servir `dist/` com Nginx unprivileged, Caddy ou servidor estático equivalente, justificando a escolha.
- Preferir processo não-root.
- Incluir configuração de SPA fallback para `index.html`.
- Não encaminhar `/api` ao próprio frontend quando o contrato escolhido usa backend em outro subdomínio.
- Definir cache longo para assets com hash.
- Definir cache curto/sem cache agressivo para `index.html`.
- Preservar `widget-loader.js` e rotas de widget.
- Adicionar endpoint simples `/healthz` do container web.
- Incluir headers seguros compatíveis com a aplicação, sem quebrar widget, fontes ou integrações.
- Não expor arquivos de source map publicamente sem decisão documentada.
- Adicionar `HEALTHCHECK` somente se funcionar na imagem escolhida e estiver testado.

### Requisito independente

O comando abaixo deve funcionar usando somente a pasta frontend como contexto:

`docker build -t comunicacaoai-frontend:test frontend`

Se a ferramenta local usa Podman, testar comando equivalente e documentar.

## 10. Fase 5 — Dockerfile do backend

Criar `backend/Dockerfile` com multi-stage build.

### Build stage

- Usar Node LTS compatível e fixado.
- Copiar package e lock antes do restante.
- Executar `npm ci`.
- Compilar TypeScript.
- Garantir que bindings opcionais Linux necessários sejam instalados pelo lock.

### Runtime stage

- Copiar somente `dist`, package metadata e dependências de produção necessárias.
- Não incluir TypeScript, source files ou dev dependencies sem necessidade.
- Definir `NODE_ENV=production`.
- Executar como usuário não-root.
- Expor apenas a porta interna documentada.
- Usar `node dist/index.js` diretamente, sem watcher.
- Configurar sinalização correta para que Node receba SIGTERM.
- Não embutir nenhuma variável real na imagem.
- Adicionar `HEALTHCHECK` apenas com ferramenta disponível e teste real.
- Manter imagem razoavelmente pequena sem usar Alpine se alguma dependência nativa não for compatível; priorizar confiabilidade.

### Requisito independente

O comando abaixo deve funcionar usando somente a pasta backend como contexto:

`docker build -t comunicacaoai-backend:test backend`

## 11. Fase 6 — Dockerignore e conteúdo das imagens

Criar `.dockerignore` em cada serviço.

Excluir pelo menos, quando aplicável:

- `.git`
- `.env` e variantes reais.
- `node_modules`
- `dist` local.
- logs.
- caches.
- coverage.
- screenshots e relatórios não necessários ao runtime.
- arquivos do editor.
- testes E2E e artefatos Playwright, caso não façam parte do build.

Não excluir assets necessários, migrations necessárias, arquivos públicos ou package lock.

Inspecionar imagens com `docker history` e/ou export equivalente para confirmar que não contêm `.env`, tokens ou arquivos locais sensíveis.

## 12. Fase 7 — Configuração runtime do backend

Criar um módulo central de configuração tipada, se ainda não existir, sem adicionar framework pesado desnecessário.

### Validação de startup

Em produção, validar:

- `PORT` numérica e válida.
- `MONGODB_URI` presente.
- `BETTER_AUTH_SECRET` forte e não igual ao placeholder.
- `BETTER_AUTH_URL` HTTPS e válida.
- `CLIENT_URL`/allowlist válida.
- `PUBLIC_URL` HTTPS e válida.
- `ENCRYPTION_KEY` presente e apropriada.
- URLs sem barra final ambígua.

Variáveis de provedores e integrações opcionais não devem impedir startup quando o recurso estiver desabilitado.

Mensagens de erro devem citar o nome da variável ausente sem imprimir seu conteúdo.

## 13. Fase 8 — CORS, cookies e Better Auth

Frontend e backend estarão em origens diferentes. Fazer uma revisão completa, não apenas trocar uma string.

### CORS privado

- Usar allowlist exata de origens.
- Suportar ao menos frontend de produção e localhost de desenvolvimento por configuração explícita.
- Se necessário, aceitar lista separada por vírgulas em `CLIENT_URLS`, mantendo compatibilidade documentada com `CLIENT_URL`.
- Normalizar as origens sem aceitar curingas.
- Responder preflight corretamente.
- Permitir credentials somente para origem aprovada.
- Não combinar `Access-Control-Allow-Origin: *` com credentials.
- Rejeitar origem desconhecida de maneira previsível.

### Rotas públicas de widget

- Manter acesso cross-origin apenas para endpoints realmente públicos.
- Não habilitar credentials nessas rotas.
- Confirmar que endpoints protegidos não podem ser alcançados pela política pública.
- Revisar cache e rate-limit readiness, sem implementar infraestrutura externa ainda.

### Socket.IO

- Aplicar a mesma allowlist usada na API privada.
- Testar polling e websocket upgrade.
- Testar cookies/sessão no `join-owner`.
- Não permitir origens arbitrárias para canais autenticados.

### Better Auth e cookies

- Configurar trusted origins com a mesma allowlist.
- Confirmar `BETTER_AUTH_URL` correto.
- Preferir frontend e backend como subdomínios HTTPS do mesmo domínio registrável, por exemplo `app.dominio` e `api.dominio`, para reduzir problemas de cookies.
- Revisar `Secure`, `HttpOnly`, `SameSite`, domínio e path dos cookies para o arranjo final.
- Não definir domínio de cookie fictício agora.
- Criar uma seção no relatório explicando qual decisão será necessária assim que as URLs forem fornecidas.
- Testar login, refresh de sessão, logout e rota protegida com duas origens locais equivalentes.

## 14. Fase 9 — Health, readiness e encerramento gracioso

Separar, se necessário:

- `/api/health` ou `/healthz`: liveness, confirma que o processo responde.
- `/api/ready` ou `/readyz`: readiness, confirma que dependências essenciais estão prontas.

### Readiness do backend

- Confirmar conexão MongoDB com ping de baixo custo.
- Retornar status apropriado sem vazar URI, banco, credenciais ou stack trace.
- Considerar migrations/índices essenciais antes de marcar pronto.
- Aplicar timeout curto.

### Encerramento

Tratar SIGTERM e SIGINT:

1. Marcar serviço como não pronto.
2. Parar de aceitar novas conexões.
3. Encerrar HTTP/Socket.IO.
4. Fechar MongoDB.
5. Sair dentro de timeout definido.

Evitar executar migration concorrente de forma insegura caso duas réplicas iniciem. Auditar idempotência e documentar limitação para o primeiro deploy com uma réplica.

## 15. Fase 10 — Persistência e dados

Auditar todos os pontos de escrita:

- MongoDB.
- Uploads.
- Avatares.
- Documentos/RAG.
- Cache de modelos.
- Logs.
- Arquivos temporários.
- Sessões.

Classificar cada item como:

- Persistido em MongoDB.
- Apenas memória e descartável.
- Arquivo temporário.
- Volume obrigatório.
- Serviço externo.

Se não houver escrita persistente em filesystem, documentar que o backend pode ser stateless e não criar volume desnecessário. Se existir escrita persistente, não mascarar: definir volume, ownership, backup e restore no plano posterior.

Não mover dados nem trocar armazenamento nesta etapa.

## 16. Fase 11 — Compose local de produção

Criar `compose.production-test.yml` na raiz atual para validar os dois containers juntos antes do deploy.

### Requisitos

- Serviço `frontend` construído de `frontend/`.
- Serviço `backend` construído de `backend/`.
- Portas locais configuráveis e sem conflito.
- Rede interna explícita.
- Health/readiness checks.
- Dependência baseada em health quando suportada.
- Variáveis vindas de um arquivo local não commitado.
- Arquivo de exemplo sem segredos.
- MongoDB Atlas/external por padrão, se essa for a arquitetura atual.
- Não adicionar Mongo local automaticamente sem necessidade.
- Restart policy apropriada para teste, não vendida como configuração final do Coolify.

O compose deve servir apenas para validação local production-like. Coolify deve criar e gerenciar os dois serviços separadamente mais tarde.

## 17. Fase 12 — Matriz de variáveis

Atualizar:

- `frontend/.env.example`
- `backend/.env.example`

Criar `DEPLOYMENT_ENVIRONMENT_MATRIX.md` com colunas:

- Variável.
- Serviço.
- Obrigatória ou opcional.
- Build-time ou runtime.
- Sensível ou pública.
- Exemplo seguro `.invalid`.
- Origem do valor.
- Quando deve ser rotacionada.
- Consequência se ausente.

### Regras

- Nunca incluir valor real.
- Explicar que `VITE_API_URL` é pública e incorporada no build.
- Marcar secrets do backend como runtime-only.
- Distinguir `BETTER_AUTH_SECRET` de `ENCRYPTION_KEY`.
- Incluir `PUBLIC_URL` no example se for usada.
- Incluir callback Google opcional.
- Mapear Anthropic, OpenAI, Voyage, Google, WhatsApp/Meta/Twilio e quaisquer novas integrações encontradas.
- Não inventar variável não utilizada sem implementar e documentar seu consumo.

## 18. Fase 13 — Preparação para dois repositórios

Criar `REPOSITORY_SPLIT_GUIDE.md`.

O guia deve explicar:

- Estrutura esperada do futuro repositório frontend.
- Estrutura esperada do futuro repositório backend.
- Quais arquivos da raiz devem ser copiados ou recriados em cada um.
- Como preservar histórico Git usando `git subtree split` ou `git filter-repo`, apresentando opções sem executá-las.
- Como manter autoria e histórico.
- Como verificar que nenhum segredo entra no histórico.
- Como configurar branch principal e branch de desenvolvimento futuramente.
- Como apontar cada repo para um recurso independente no Coolify.
- Como coordenar mudanças de contrato entre frontend e backend.
- Como versionar API ou manter compatibilidade durante deploys separados.
- Como fazer rollback independente.

### Condição de independência

Antes de considerar pronto, copiar `frontend/` e `backend/` para dois diretórios temporários fora do monorepo e executar em cada um:

- `npm ci`
- testes disponíveis.
- typecheck/lint disponível.
- build.
- `docker build`.

Nenhum dos dois pode depender de arquivo localizado na raiz original.

## 19. Fase 14 — Segurança básica dos containers

- Usuário não-root.
- Imagens oficiais e versões fixadas.
- Sem shells/process managers desnecessários.
- Sem segredos em ARG, layers ou logs.
- Sem porta de banco exposta.
- Sem diretório inteiro do repositório copiado por conveniência.
- Dependências de produção auditadas com resultado registrado, sem atualizar major automaticamente.
- Headers HTTP revisados.
- `trust proxy` configurado de maneira adequada ao proxy do Coolify, sem confiar cegamente em qualquer cadeia quando isso afetar segurança.
- Limites de body/upload preservados.
- Erros de produção sem stack trace para o cliente.
- Logs estruturados mínimos para startup, shutdown e falhas, sem dados sensíveis.
- Endpoint de health sem informações internas.

Não adicionar Kubernetes, service mesh ou infraestrutura incompatível com a escala atual.

## 20. Fase 15 — Testes obrigatórios

### Build isolado

- `npm ci` no frontend isolado.
- Build frontend isolado com URL `.invalid`.
- `npm ci` no backend isolado.
- Build backend isolado.
- Build das duas imagens Docker sem cache pelo menos uma vez.

### Frontend container

- `/` retorna aplicação.
- Rota SPA direta, como `/dashboard`, retorna `index.html` e não 404.
- Assets retornam MIME correto.
- Cache de assets e index está correto.
- `/healthz` responde.
- `widget-loader.js` está acessível.
- Bundle contém somente a URL pública de teste esperada, sem secrets.

### Backend container

- Processo inicia com configuração válida.
- Falha cedo com configuração obrigatória ausente.
- Liveness responde.
- Readiness fica indisponível sem Mongo e disponível com Mongo.
- SIGTERM encerra corretamente.
- Nenhuma escrita inesperada em filesystem read-only, quando testável.

### Comunicação

- Frontend chama API usando `VITE_API_URL`.
- Preflight de origem aprovada funciona.
- Origem privada não aprovada é rejeitada.
- Rotas públicas de widget funcionam sem credentials.
- Rotas privadas mantêm credentials.
- Socket.IO conecta de origem aprovada e rejeita origem indevida.
- Login, sessão e logout funcionam no cenário de duas origens.
- Upload de arquivo dentro do limite funciona.
- URL de webhook é gerada a partir do backend público.

### Regressão

- Testes existentes.
- Testes do escritório.
- Testes responsivos.
- Typecheck.
- Lint.
- Builds gerais.

## 21. Fase 16 — Teste production-like sem deploy

Com variáveis exclusivamente locais/de teste:

1. Construir as duas imagens.
2. Iniciar pelo compose de teste.
3. Esperar health/readiness.
4. Abrir frontend.
5. Testar autenticação.
6. Navegar por páginas protegidas.
7. Verificar escritório e responsividade.
8. Testar API e Socket.IO.
9. Testar widget público.
10. Testar desligamento e reinício.
11. Confirmar que dados persistidos no Mongo continuam após recriar o backend.
12. Registrar logs relevantes sem segredos.

Não expor esse ambiente na internet.

## 22. Artefatos esperados

Ao final, devem existir, sujeitos à confirmação da arquitetura local:

- `frontend/Dockerfile`
- `frontend/.dockerignore`
- `frontend/package-lock.json`
- Configuração do servidor estático do frontend.
- `frontend/.env.example` atualizado.
- `backend/Dockerfile`
- `backend/.dockerignore`
- `backend/package-lock.json`
- `backend/.env.example` atualizado.
- Módulo de configuração validada do backend.
- Health/readiness e graceful shutdown.
- `compose.production-test.yml`
- Exemplo de env local do compose sem segredos.
- `DEPLOYMENT_READINESS_REPORT.md`
- `DEPLOYMENT_ENVIRONMENT_MATRIX.md`
- `REPOSITORY_SPLIT_GUIDE.md`
- Testes adicionados ou atualizados.

Se algum artefato não for apropriado, explicar tecnicamente no relatório e implementar alternativa equivalente.

## 23. Ordem sugerida de commits

1. `docs(deploy): audit runtime and service boundaries`
2. `build(frontend): make service independently installable`
3. `build(backend): make service independently installable`
4. `build(frontend): add production container`
5. `build(backend): add production container`
6. `fix(config): validate production URLs and environment`
7. `fix(security): harden cors auth and socket origins`
8. `feat(ops): add readiness and graceful shutdown`
9. `test(deploy): add production-like compose validation`
10. `docs(deploy): add env matrix and repository split guide`

Não criar commits vazios. Preservar os commits anteriores e adaptar a divisão se o worktree exigir.

## 24. Critérios finais de aceite

- [ ] Estado local e divergência com remoto foram registrados.
- [ ] Implementações anteriores foram preservadas.
- [ ] Nenhum deploy, DNS, push ou criação de repo remoto foi realizado.
- [ ] Frontend é instalável e compilável isoladamente.
- [ ] Backend é instalável, compilável e executável isoladamente.
- [ ] Cada serviço possui lockfile próprio confiável.
- [ ] Cada serviço possui Dockerfile multi-stage.
- [ ] Cada serviço usa somente sua própria pasta como Docker context.
- [ ] Frontend possui SPA fallback e cache correto.
- [ ] Backend executa como processo Node de produção e usuário não-root.
- [ ] Imagens não contêm `.env` ou segredos.
- [ ] Configuração de produção falha cedo quando obrigatória estiver ausente.
- [ ] Nenhum default localhost silencioso é usado em produção.
- [ ] CORS privado usa allowlist exata com credentials.
- [ ] CORS público está limitado às rotas públicas de widget.
- [ ] Socket.IO usa allowlist segura.
- [ ] Better Auth e cookies foram auditados para origens separadas.
- [ ] Decisões pendentes de cookie aguardando URLs estão documentadas.
- [ ] Liveness e readiness estão separados e testados.
- [ ] Readiness verifica MongoDB sem vazar dados.
- [ ] SIGTERM encerra HTTP, Socket.IO e MongoDB corretamente.
- [ ] Persistência foi classificada e volumes desnecessários não foram criados.
- [ ] Compose local production-like funciona.
- [ ] Variáveis estão documentadas sem valores reais.
- [ ] `VITE_API_URL` está claramente marcada como build-time e pública.
- [ ] Guia de separação em dois repositórios está completo.
- [ ] Builds isolados foram testados fora do monorepo.
- [ ] Containers foram testados juntos localmente.
- [ ] Login, sessão, API, Socket.IO e widget público funcionam no teste de duas origens.
- [ ] Testes existentes, responsivos, lint, typecheck e builds passam.
- [ ] Relatório lista bloqueios e valores que ainda dependem das URLs definitivas.

## 25. Entrega final do Claude Code

Ao terminar, responder com:

1. Branch, HEAD e relação com `origin/development`.
2. Diagnóstico inicial encontrado.
3. Arquivos criados e alterados.
4. Como frontend e backend foram tornados independentes.
5. Comandos exatos para construir cada imagem localmente.
6. Comando para executar o compose de teste.
7. Portas e health endpoints.
8. Variáveis que continuarão aguardando as URLs definitivas.
9. Resultados de testes, builds e testes Docker.
10. Tamanho aproximado das imagens.
11. Pendências ou riscos restantes.
12. Commits criados.
13. Confirmação de que não houve push, merge, criação de repo remoto ou deploy.

