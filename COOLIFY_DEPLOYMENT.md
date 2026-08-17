# Deploy no Coolify — dois recursos

Produção é **frontend + backend**. Mais nada.

| # | Recurso | O que é | Porta pública |
|---|---------|---------|---------------|
| 1 | `frontend` | Bundle estático servido por nginx | 8080 (via proxy do Coolify) |
| 2 | `backend` | API HTTP + Socket.IO **+ motor de automações** | 4000 (via proxy do Coolify) |

O MongoDB (Atlas) é externo, como sempre foi. **Não existe Redis, nem worker
separado**: o motor que dispara rotinas e executa as automações roda dentro do
próprio processo da API, sobre o Mongo.

> **Histórico.** Por um tempo isto exigiu quatro recursos (o worker era um
> processo à parte e a fila era BullMQ sobre Redis). O resultado prático foi um
> deploy só com a API: o site funcionava e **nenhuma rotina jamais executou** —
> 3 rotinas ativas e zero execuções no banco. A fila passou para o MongoDB e o
> motor foi para dentro da API justamente para que essa configuração pela metade
> deixe de ser possível.

Nenhum segredo real aparece aqui. Tudo abaixo é espaço reservado.

---

## 1. frontend

| Campo | Valor |
|---|---|
| Build context | `frontend/` |
| Dockerfile | `frontend/Dockerfile` |
| Porta interna | `8080` |
| Domínio | `https://comunicacaoai.onplataform.com` |
| Healthcheck | `GET /healthz` |

Variável de **build** (entra no bundle do navegador, não é segredo):

```
VITE_API_URL=https://api.comunicacaoai.onplataform.com
```

## 2. backend

| Campo | Valor |
|---|---|
| Build context | `backend/` |
| Dockerfile | `backend/Dockerfile` |
| Start command | (padrão da imagem — não precisa mexer) |
| Porta interna | `4000` |
| Domínio | `https://api.comunicacaoai.onplataform.com` |
| Healthcheck | `GET /api/ready` (200 só quando o MongoDB responde **e** o motor de automações está de pé) |

Variáveis obrigatórias:

```
NODE_ENV=production
PORT=4000
MONGODB_URI=<string de conexão do Atlas>
BETTER_AUTH_SECRET=<openssl rand -hex 32>
ENCRYPTION_KEY=<openssl rand -hex 32>
CLIENT_URL=https://comunicacaoai.onplataform.com
BETTER_AUTH_URL=https://api.comunicacaoai.onplataform.com
PUBLIC_URL=https://api.comunicacaoai.onplataform.com
```

Opcionais (chaves de provedor; o app sobe sem elas):
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `VOYAGE_API_KEY`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

Ajustes finos do motor (todos com padrão seguro, mexa só se precisar):
`WORKER_CONCURRENCY`, `RUN_POLL_MS`, `SCHEDULER_POLL_MS`, `RUN_LEASE_MS`,
`MAX_RUN_CLAIMS`.

---

## Como saber que as rotinas estão rodando

No log do backend, logo depois de subir:

```
Automation engine up (<id>, concurrency 4) — runs a cada 3000ms, agendador a cada 15000ms
Schedules: 1 disparada(s)        # quando alguma vence
```

E no encerramento, `Automation engine stopped` — ele espera as execuções em
andamento terminarem antes de fechar (até `SHUTDOWN_TIMEOUT_MS`, 25s por padrão,
sempre abaixo do `stop_grace_period` de 30s do orquestrador).

Se o motor **não** subir, o `/api/ready` responde `503` com `{"engine":"down"}` e o
recurso fica vermelho: um backend que aceita rotinas sem conseguir executá-las não
pode passar por saudável. O motivo da falha sai no log como
`Automation engine failed to start`.

Com `EMBEDDED_WORKER=false` o motor roda em um processo separado
(`npm run start:worker`); aí o `/api/ready` responde `{"engine":"separate"}` e passa
a cobrir só o banco — o log deixa isso explícito no boot.

Confirmação pelo produto: crie uma rotina para daqui a poucos minutos na página do
agente e veja a execução aparecer em **Execuções**. O disparo tem precisão de
~15 segundos, o que para rotinas diárias e semanais é imperceptível.

## Se um dia quiser separar o worker

Só faz sentido em escala bem maior. O caminho existe e não muda o comportamento:

1. `EMBEDDED_WORKER=false` no backend;
2. um segundo recurso, mesma imagem, start command `npm run start:worker`, sem
   domínio e sem porta, com as mesmas variáveis.

Várias instâncias são seguras: a reivindicação de execução é uma única operação
atômica no Mongo e cada disparo agendado carrega uma chave de idempotência única.

## Checklist de corte

- [ ] Os dois recursos verdes.
- [ ] `GET https://api.comunicacaoai.onplataform.com/api/ready` → 200.
- [ ] Log do backend mostrando `Automation engine up`.
- [ ] Nenhum Redis e nenhum recurso de worker (se você criou antes, pode apagar).

## Validando localmente antes de subir

```
cp compose.production-test.env.example compose.production-test.env
# preencha com valores de TESTE — nunca segredos de produção
docker compose -f compose.production-test.yml --env-file compose.production-test.env up --build
```

Com um Mongo apontado por você (Atlas de teste, ou um local), é só isso. Sem banco à mão,
some o override do CI e um mongod efêmero sobe junto — mesmo caminho que o CI exercita:

```
docker compose -f compose.production-test.yml -f compose.ci-smoke.yml \
  --env-file compose.production-test.env up --build
docker compose -f compose.production-test.yml -f compose.ci-smoke.yml down -v
```

O banco do override não tem volume nem porta publicada: `down -v` leva tudo, e nenhuma
credencial entra no repositório.
