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
| Domínio | `https://comunicacaoai.oneplataforma.com` |
| Healthcheck | `GET /healthz` |

Variável de **build** (entra no bundle do navegador, não é segredo):

```
VITE_API_URL=https://api.comunicacaoai.oneplataforma.com
```

## 2. backend

| Campo | Valor |
|---|---|
| Build context | `backend/` |
| Dockerfile | `backend/Dockerfile` |
| Start command | (padrão da imagem — não precisa mexer) |
| Porta interna | `4000` |
| Domínio | `https://api.comunicacaoai.oneplataforma.com` |
| Healthcheck | `GET /api/ready` (200 só quando o MongoDB responde) |

Variáveis obrigatórias:

```
NODE_ENV=production
PORT=4000
MONGODB_URI=<string de conexão do Atlas>
BETTER_AUTH_SECRET=<openssl rand -hex 32>
ENCRYPTION_KEY=<openssl rand -hex 32>
CLIENT_URL=https://comunicacaoai.oneplataforma.com
BETTER_AUTH_URL=https://api.comunicacaoai.oneplataforma.com
PUBLIC_URL=https://api.comunicacaoai.oneplataforma.com
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
andamento terminarem antes de fechar.

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
- [ ] `GET https://api.comunicacaoai.oneplataforma.com/api/ready` → 200.
- [ ] Log do backend mostrando `Automation engine up`.
- [ ] Nenhum Redis e nenhum recurso de worker (se você criou antes, pode apagar).

## Validando localmente antes de subir

```
cp compose.production-test.env.example compose.production-test.env
# preencha com valores de TESTE — nunca segredos de produção
docker compose -f compose.production-test.yml --env-file compose.production-test.env up --build
```
