# Fechamento de MVP — branch `development`

Relatório de corte. Nenhum merge e nenhum deploy foram feitos.

| | |
|---|---|
| Base (HEAD remoto no início) | `d5c26c40e454` |
| HEAD ao final | `22c52dce6f37` |
| Branch | `development` |
| Divergência | `development` está 62 commits à frente de `main`; `main` tem 2 commits que `development` não tem (`5a509dc` e `c4df655`, merges de integração) |
| Working tree | limpa (`git diff --check` limpo) |

---

## 1. Gate de qualidade

Todos os comandos abaixo foram executados nesta máquina, nesta ordem, e os
números são os obtidos.

| Comando | Resultado |
|---|---|
| `npm ci` (raiz, após remover os três `node_modules`) | 390 pacotes |
| `npx tsc --noEmit` (backend) | limpo |
| `npx tsc -b --noEmit` (frontend) | limpo |
| `npm run build` | 0 erros; bundle 953 kB (270 kB gzip) |
| `npx oxlint` (frontend) | 0 erros, 18 avisos, saída 0 |
| `npm test -w backend` | **802 testes, 802 passaram** (416 sem banco + 386 com mongod) |
| `npm test -w frontend` | **183 testes, 21 arquivos, todos passaram** |
| `npx playwright test --workers=1` | **258 passaram, 17 pulados** |
| `npm run smoke` | **4 testes, todos passaram** |

Os 18 avisos do lint são de duas famílias, ambas de higiene e nenhuma de
comportamento: `react(only-export-components)` (um arquivo que exporta um
componente e também uma constante, o que só afeta o fast-refresh do dev server)
e `no-unsafe-optional-chaining` em arquivos de teste, onde um `undefined`
resultaria em falha do teste, que é o comportamento desejado. Nenhum teste foi
apagado, nenhuma asserção foi afrouxada e nenhum erro foi silenciado.

### Smoke de MVP — `npm run smoke`

Um comando. Ele sobe um `mongod` isolado (binário real, réplica de um nó, como o
Atlas), compila o frontend com as flags de produção, sobe o backend compilado
apontado para esse banco, serve o bundle com proxy de `/api` na mesma origem — o
que faz o cookie e o CORS se comportarem como em produção — e roda o Playwright
contra a pilha real. Sem `page.route`, sem stub, sem conta, banco ou chave de
ninguém.

Cobertura, em ordem e dependendo um do outro:

1. registro, sessão sobrevivendo a reload;
2. dashboard;
3. criação de andar e edição de andar;
4. troca de andar no desktop (seletor) e no celular (drawer);
5. contratação de agente pelo assistente de três passos;
6. criação de setor **com o agente dentro** — o vínculo agente-setor;
7. execução manual no playground, com resposta do adaptador falso;
8. rotina agendada criada e publicada;
9. gatilho de webhook criado, com segredo gerado pelo servidor;
10. Central de execuções e a visão de Análise;
11. log de auditoria com o rastro do que foi criado;
12. recusa do **servidor** visível na tela (excluir andar ocupado);
13. logout invalidando a rota protegida, e login de volta;
14. URL direta de App inativo não abre a página;
15. 320, 390, 768 e 1440 px em oito telas;
16. alvos de toque em contexto de toque real.

E fecha perguntando **ao servidor**, com a mesma sessão, se cada coisa que a
interface disse ter criado existe: andar, setor com membro, agente, raiz de
execução e trilha de auditoria. Um passo de tela pode passar por acidente; a
existência do dado, não.

Depois dos testes, o script ainda verifica que o motor de automações subiu, que
`/api/ready` vira **503** quando o banco cai com o processo vivo, que **SIGTERM**
encerra sozinho com código 0 e `Automation engine stopped` no log, e que o log do
backend não trouxe credencial, valor de chave nem resposta de modelo.

### LLM no smoke

`backend/src/llmFake.ts` responde de forma determinística e contabiliza tokens.
O portão é resolvido **uma vez, no carregamento do módulo**, a partir de
`NODE_ENV`:

```
FAKE_LLM_ENABLED = NODE_ENV === 'test' && LLM_FAKE === '1'
```

Um processo que subiu como `production` não tem caminho para ligá-lo: nenhuma
rota, nenhuma configuração de usuário, nenhuma variável lida depois do boot.
`backend/test/llmFakeGate.test.mjs` carrega o módulo em processos separados e
afirma as duas metades — inclusive que mexer em `process.env` **depois** do boot
não muda nada.

### CI

`.github/workflows/ci.yml` ganhou o job `smoke`, que instala o Chromium e roda
`npm run smoke`. `actions/checkout` e `actions/setup-node` foram de v4 para v5;
o Node do app continua fixado em 20.19, pelo motivo que já estava documentado
ali (o bundler declara `engines.node ^20.19.0 || >=22.12.0`).

Não houve limitação técnica: o job roda o smoke completo, não uma versão
reduzida.

#### Correção de uma afirmação anterior

A primeira versão deste relatório dizia que o CI estava verde. **Não estava, e eu
não tinha olhado a execução** — reportei o resultado local como se fosse o do
runner. O job `verify` vinha falhando em "Backend tests" enquanto o `smoke`
passava.

O que os dados mostram, lidos da API do GitHub:

| commit | conteúdo | resultado |
|---|---|---|
| `d5c26c40` | só frontend (balões) | verde |
| `d8b2540c` | só frontend (balões) | vermelho |
| `41a0d300` | só frontend (balões) | vermelho |
| `b1ec7e92` | só frontend (balões) | verde |
| `233eaf4d` | **só documentação** | vermelho |

Um commit que só mexeu num arquivo `.md` derrubando os testes de backend, e o
mesmo tipo de mudança alternando entre verde e vermelho, não é regressão: é
intermitência. Localmente a suíte passa até com concorrência forçada em 24,
porque a máquina tem 8 núcleos, 9 GB e o binário do mongod em cache.

**A causa:** 29 dos 70 arquivos sobem um `mongod` real (replica set de um nó). O
`node --test` roda os arquivos em paralelo, um processo por arquivo, com
concorrência igual ao número de CPUs. No runner, menor e com cache frio, isso
significa 29 processos disputando o mesmo download de 76 MB e o mesmo lock, e
depois vários mongod simultâneos na memória disponível.

**A correção** está em `backend/scripts/run-tests.mjs`, e não é repetir o teste
que falhou nem esconder a falha:

1. o binário do mongod é baixado **uma vez**, antes de qualquer processo de teste
   existir;
2. os arquivos que sobem mongod rodam com concorrência limitada (2 no CI, até 4
   fora dele, ajustável por `MONGO_TEST_CONCURRENCY`);
3. os que não sobem continuam em paralelo total, porque não custam nada;
4. quem entra em cada grupo é decidido **lendo o arquivo**, não pelo nome — um
   teste que passe a usar mongod entra no grupo certo sozinho.

O CI também passou a guardar o binário entre execuções (`actions/cache`).

Nenhum teste foi pulado, nenhuma asserção mudou e a contagem final é a mesma:
416 sem banco + 386 com mongod = **802**. Medições locais: 40s no modo normal,
50s no modo do CI, 59s com o cache do binário apagado — este último reproduzindo
o estado de um runner novo.

---

## 2. Correções

Cada uma abaixo corrige um risco real, encontrado durante esta rodada.

### Conta nova não conseguia criar o primeiro andar — `dc129d0`

Com a flag de produção ligada, `/building` redirecionava para o dashboard, o
dashboard redirecionava para o andar ativo, e o botão "Criar andar" do seletor
apontava para o dashboard. Uma conta recém-criada não tem andar nenhum: ela caía
num dashboard sem nenhuma forma de sair dele. Com um andar já existente, também
não havia como criar o segundo.

A página que faz isso já existia e estava **órfã**: `Building.tsx` não era
importada em lugar nenhum. Ela voltou a ser a rota `/building`, o seletor aponta
para lá, e uma conta sem andar aterrissa nela. Nenhuma tela nova, nenhum
redesenho.

Encontrado pelo smoke, na primeira execução.

### A imagem do backend não construía — `d440e52`

`docker build backend` falhava em `npm ci`, com `Missing: mongodb-memory-server
from lock file`. `cron-parser` estava na mesma situação: declarados no
`package.json` do workspace e ausentes do `package-lock.json` dele.

Não aparecia porque `npm ci` na raiz resolve pelo workspace e passa. O Dockerfile
copia só `backend/package.json` + `backend/package-lock.json` e instala isolado —
que é exatamente o caminho que quebrava. Lock regenerado no mesmo isolamento.

### Dois alvos de toque abaixo do mínimo — `8a16dfe`

O botão de trocar andar do topo (exclusivo do celular) tinha 28px de altura, e os
chips de categoria do catálogo de Apps tinham 30px. Os dois crescem apenas sob
ponteiro grosso; no desktop nada muda de tamanho.

### Feature flags mortas — `9bb4fcf`

Auditoria: as **seis** flags do backend eram lidas em `config.ts` e não eram
consultadas em lugar nenhum. No frontend, três das seis estavam na mesma
situação: `VITE_AI_FLOORS_ENABLED`, `VITE_AI_SCHEDULER_ENABLED` e
`VITE_AI_DELIVERIES_ENABLED`.

Era isso que fazia o template de produção combinar `BUILDING=true` com
`FLOORS=false` sem consequência: uma chave que não abre porta nenhuma. Ficaram
três, todas com consumidor: `aiBuilding`, `aiAutomations`, `aiOfficeLiveStatus`.

**Compatibilidade:** não há o que preservar, porque não havia comportamento.
Definir as variáveis antigas no ambiente continua sendo inofensivo — elas são
ignoradas. Exemplos, template de produção e `frontend/Dockerfile` atualizados.
`frontend/src/__tests__/featureFlags.test.ts` falha se uma flag voltar sem
consumidor, ou se um exemplo documentar uma que o código não lê.

### Contrato HTTP coberto por teste — `085b6e9`

`backend/test/httpContract.integration.test.mjs` sobe o mesmo `dist/index.js` que
a imagem roda, com mongod isolado e os domínios do `COOLIFY_DEPLOYMENT.md`, e
verifica: origem documentada aceita com credencial; origem de fora não ecoada nem
`*`; preflight de rota privada; rota pública do widget aceitando qualquer origem
**sem** credencial; cookie de sessão `HttpOnly` com `Path=/`; rota privada sem
sessão em 401; Socket.IO usando a mesma lista de origens; webhook sem credencial
recusado sem contar o que existe do outro lado. Nenhuma chamada sai da máquina.

---

## 3. Regressões confirmadas

| Item | Como foi confirmado |
|---|---|
| `checkCollaboration` é a decisão única | `gateWiring.integration.test.mjs` — descoberta, preview e runtime dão a mesma resposta para todo alvo; nenhuma outra decisão de colaboração fora do gate |
| Apps privados owner-scoped | `privateApps.integration.test.mjs` — catálogo é sistema + os do dono; App de outra conta não resolve |
| WhatsApp ativo só com canal real | `channelApps.integration.test.mjs` — sem `provider` + `encryptedConfig` a instalação vira `needs_reauth` com `invalidReason: 'sem_canal'` |
| Raiz para manual, canal, agenda, webhook e delegação | `executionRoots.integration.test.mjs` — 18 testes, incluindo uma execução cruzando dois andares |
| Métricas sem duplicar raiz | mesmo arquivo — prédio conta uma vez; somar os andares dá o total; `participatedExecutions` é métrica separada |

Total das suítes de domínio: **87 testes, todos passando**.

### Responsivo

320, 390, 768 e 1440 px em: prédio, andar (com o mapa), agentes, agente, setores,
setor, execuções e Apps. Nenhuma rolagem lateral da página, nenhum elemento
cortado à esquerda. Dois alvos de toque corrigidos (acima).

**Exclusão declarada:** os personagens do mapa ficam fora da regra de 44px. São
figuras de um diagrama, dimensionadas em tiles; forçar 44px mudaria a escala do
escritório inteiro, que é o visual do produto. Quem quer abrir um agente pelo
toque tem a lista de agentes, e o mapa tem zoom. Os **controles** do mapa
continuam sujeitos à regra.

### Balões

Não revertidos. Continuam rentes ao personagem, podendo se sobrepor, e a pose do
personagem não foi alterada.

---

## 4. Pendências reais

**1. Os containers não foram subidos.** Docker não está instalado nesta máquina
(`docker` não existe no PATH, sem socket em `/var/run/docker.sock`). Portanto
**não declaro os Dockerfiles aprovados**.

O que foi possível verificar sem daemon, e foi:

- o caminho de build de cada imagem, reproduzindo o que o Dockerfile copia num
  diretório isolado: `npm ci --include=dev && npm run build` produzindo
  `dist/index.js` + `dist/worker.js` no backend e `dist/index.html` no frontend
  (foi assim que o lockfile quebrado apareceu);
- `/api/ready` respondendo 503 com o banco fora e o processo vivo;
- SIGTERM encerrando sozinho, com o motor drenando;
- o SPA fallback do `nginx.conf`, por leitura (`try_files $uri $uri/ /index.html`);
- o `compose.production-test.yml`: dois serviços, `stop_grace_period: 30s` acima
  do orçamento interno de dreno, healthcheck do backend em `/api/ready` e do
  frontend em `/healthz`.

Falta, numa máquina com Docker:

```
cp compose.production-test.env.example compose.production-test.env
# preencher com valores de TESTE — nunca segredos de produção
docker compose -f compose.production-test.yml --env-file compose.production-test.env up --build
```

E conferir: `/healthz` no frontend, `/api/ready` no backend, migração no log,
`Automation engine up`, `docker compose stop` drenando dentro dos 30s, e uma rota
profunda (`/floors/<id>`) devolvendo o index em vez de 404.

**2. 17 testes E2E continuam pulados.** Dependem de variáveis (`E2E_FLOOR_A` e
afins) de uma conta semeada por fora. Já estavam nessa condição antes desta
rodada; o smoke cobre o mesmo terreno de forma hermética.

**3. Cinco estados de balão sem fonte emitida.** `researching`,
`waiting_external`, `waiting_input`, `responding` e `generating_output` existem no
enum e não são emitidos, porque não há evento verificável por trás. É o
comportamento correto e está travado por teste (`agentBubbleSources.test.mjs`).

---

## 5. Variáveis exigidas

Nomes apenas. Nenhum valor aparece aqui, e nenhum `.env` real foi lido ou
alterado durante esta rodada.

### Backend (runtime)

Obrigatórias — o processo **recusa subir** em produção sem qualquer uma delas
(`config.ts` falha rápido, sem cair para localhost em silêncio):

```
NODE_ENV
PORT
MONGODB_URI
BETTER_AUTH_SECRET
ENCRYPTION_KEY
CLIENT_URL
BETTER_AUTH_URL
PUBLIC_URL
```

Opcionais — o app sobe sem elas:

```
ANTHROPIC_API_KEY  OPENAI_API_KEY  VOYAGE_API_KEY
GOOGLE_CLIENT_ID   GOOGLE_CLIENT_SECRET
```

Ajuste fino do motor, todos com padrão seguro:

```
WORKER_CONCURRENCY  RUN_POLL_MS  SCHEDULER_POLL_MS  RUN_LEASE_MS
MAX_RUN_CLAIMS      SHUTDOWN_TIMEOUT_MS  EMBEDDED_WORKER
```

### Frontend (build)

Entram no bundle no momento do build; mudar qualquer uma exige **rebuild**.
Nenhuma é segredo.

```
VITE_API_URL
VITE_AI_BUILDING_ENABLED
VITE_AI_AUTOMATIONS_ENABLED
VITE_AI_OFFICE_LIVE_STATUS_ENABLED
```

---

## 6. Checklist de deploy

Antes:

- [ ] CI verde nos dois jobs (`verify` e `smoke`) — **conferir a execução no
      GitHub, não o resultado local**. Foi exatamente essa confusão que produziu
      a afirmação errada corrigida na seção 1.
- [ ] Os containers subidos e verificados numa máquina com Docker (pendência 1).
- [ ] As três `VITE_*` de flags definidas como variáveis de **build** no Coolify,
      as três em `true`.
- [ ] As oito obrigatórias do backend preenchidas.
- [ ] `MONGODB_URI` apontando para o Atlas de produção.

Depois:

- [ ] `GET https://api.comunicacaoai.oneplataforma.com/api/ready` → 200.
- [ ] Log do backend com `Automation engine up`.
- [ ] `GET https://comunicacaoai.oneplataforma.com/healthz` → 200.
- [ ] Uma rota profunda do SPA carregando (não 404).
- [ ] Nenhum recurso de Redis e nenhum worker separado.
- [ ] Criar uma rotina para dali a poucos minutos e ver a execução aparecer em
      **Execuções** — é o teste que prova que o motor está de fato rodando.

### Rollback

O deploy é por imagem: voltar é redeployar a tag anterior nos **dois** recursos.

Nada aqui exige rollback de dados. As migrações desta rodada são as que já
existiam e são idempotentes — `migrationFixture.integration.test.mjs` roda a
migração completa contra um banco no formato antigo e afirma que nenhuma
coleção perde documento. **Nenhuma migração nova foi introduzida.**

Se o rollback for por causa do frontend, lembre que as `VITE_*` estão assadas na
imagem: voltar a imagem volta as flags junto.

---

## 7. Caminho seguro `development` → `main`

Não executei. `main` tem **dois commits que `development` não tem** (`5a509dc` e
`c4df655`, merges de integração), então um `git push --force` ou um reset
destruiria história.

O caminho que preserva os dois lados:

```
git checkout main
git pull --ff-only origin main
git merge --no-ff development -m "Merge branch 'development' — MVP de produção"
# resolver conflito, se houver, preservando o que está em main
npm ci && npm run build && npm test -w backend && npm test -w frontend && npm run smoke
git push origin main          # sem --force, nunca
```

O merge (e não rebase) é o que mantém os commits exclusivos de `main` intactos. O
gate roda **depois** do merge e antes do push, porque é o resultado do merge que
vai para produção — não o de nenhum dos lados isolado.
