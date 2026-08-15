# Deploy no Coolify — quatro recursos

Produção **não** é "frontend + backend". São **quatro** recursos, e faltar um deles
não derruba o site: faz as rotinas agendadas simplesmente nunca acontecerem, em
silêncio. Foi exatamente isso que aconteceu antes — 3 rotinas ativas e zero
execuções na história do banco.

| # | Recurso | O que é | Porta pública |
|---|---------|---------|---------------|
| 1 | `frontend` | Bundle estático servido por nginx | 8080 (via proxy do Coolify) |
| 2 | `backend-api` | API HTTP + Socket.IO | 4000 (via proxy do Coolify) |
| 3 | `backend-worker` | Fila de execuções + agendador | **nenhuma** |
| 4 | `redis` | Broker da fila | **nenhuma — privado** |

> **API e worker são a MESMA imagem**, construída de `backend/Dockerfile`. O que
> muda é só o comando de start. Nunca rode os dois com `concurrently` num único
> container: eles precisam reiniciar, escalar e ser observados separadamente.

Nenhum segredo real aparece neste arquivo. Todos os valores abaixo são
espaços reservados — preencha no painel do Coolify.

---

## 1. frontend

| Campo | Valor |
|---|---|
| Build context | `frontend/` |
| Dockerfile | `frontend/Dockerfile` |
| Porta interna | `8080` |
| Domínio | `https://comunicacaoai.oneplataforma.com` |
| Healthcheck | `GET /healthz` |
| Start command | (padrão da imagem) |

Variável de **build** (entra no bundle do navegador, não é segredo):

```
VITE_API_URL=https://api.comunicacaoai.oneplataforma.com
```

## 2. backend-api

| Campo | Valor |
|---|---|
| Build context | `backend/` |
| Dockerfile | `backend/Dockerfile` |
| **Start command** | `npm run start:api` |
| Porta interna | `4000` |
| Domínio | `https://api.comunicacaoai.oneplataforma.com` |
| Healthcheck | `GET /api/ready` (200 só quando o MongoDB responde) |

Variáveis obrigatórias:

```
NODE_ENV=production
PORT=4000
MONGODB_URI=<string de conexão do Atlas>
REDIS_URL=redis://<nome-interno-do-redis>:6379
BETTER_AUTH_SECRET=<openssl rand -hex 32>
ENCRYPTION_KEY=<openssl rand -hex 32>
CLIENT_URL=https://comunicacaoai.oneplataforma.com
BETTER_AUTH_URL=https://api.comunicacaoai.oneplataforma.com
PUBLIC_URL=https://api.comunicacaoai.oneplataforma.com
```

Opcionais (chaves de provedor; o app sobe sem elas):
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `VOYAGE_API_KEY`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

## 3. backend-worker

| Campo | Valor |
|---|---|
| Build context | `backend/` (o **mesmo** do item 2) |
| Dockerfile | `backend/Dockerfile` |
| **Start command** | `npm run start:worker` |
| Porta interna | **nenhuma** — não expor domínio nem porta |
| Healthcheck | nenhum HTTP; veja "Como saber se está vivo" abaixo |

Variáveis: **exatamente as mesmas do `backend-api`**, menos `PORT` (não escuta
HTTP). `MONGODB_URI` e `REDIS_URL` são indispensáveis — sem elas o processo morre
na largada com a mensagem dizendo qual dependência não respondeu, em vez de ficar
de pé sem fazer nada.

## 4. redis (privado)

| Campo | Valor |
|---|---|
| Tipo | Redis (recurso de banco do Coolify) |
| Imagem | `redis:7-alpine` ou a padrão do Coolify |
| Porta pública | **nenhuma** |
| Acesso | somente pela rede interna, como `redis://<nome-interno>:6379` |

Não publique porta nem domínio. A fila carrega instruções de execução das
automações do usuário; ela não pertence à internet.

---

## Como saber se o worker está vivo e trabalhando

O worker não serve HTTP, então não há URL para checar. Ele fala pelos logs:

```
Worker: MongoDB reachable
Worker: Redis reachable (automation-runs / automation-schedules)
Automation worker up (concurrency 4) — runs + scheduler
Schedules reconciled: +3 -0 (3 active)     # sempre que o conjunto muda
```

- **Não subiu?** O processo sai com erro nomeando a dependência
  (`MongoDB did not answer within 10000ms` / `Redis did not answer...`). Um worker
  "rodando" já significa "conectado".
- **Está processando?** Falhas de job aparecem como `run job <id> failed: <motivo>`.
  Nenhum payload, credencial ou conteúdo de usuário é registrado.
- **Encerrando?** `Received SIGTERM, draining worker...` e, ao final,
  `Worker shutdown complete`. Ele drena os jobs em andamento antes de fechar.

Confirmação de ponta a ponta pelo produto: crie uma rotina para daqui a poucos
minutos na página do agente e veja a execução aparecer em **Execuções**.

## Checklist de corte

- [ ] Os quatro recursos existem e estão verdes.
- [ ] `redis` sem porta e sem domínio públicos.
- [ ] `backend-worker` sem domínio, com start command `npm run start:worker`.
- [ ] `backend-api` e `backend-worker` com o **mesmo** `MONGODB_URI` e `REDIS_URL`.
- [ ] Log do worker mostrando `Automation worker up`.
- [ ] `GET https://api.comunicacaoai.oneplataforma.com/api/ready` respondendo 200.

## Validando localmente antes de subir

`compose.production-test.yml` reproduz os quatro serviços com o mesmo desenho
(Redis privado, worker sem porta, API como única publicada):

```
cp compose.production-test.env.example compose.production-test.env
# preencha com valores de TESTE — nunca segredos de produção
docker compose -f compose.production-test.yml --env-file compose.production-test.env up --build
```
