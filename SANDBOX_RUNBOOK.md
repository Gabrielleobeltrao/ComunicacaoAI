# Runbook — Sandbox Runner

## Subir

```bash
# 1. o segredo compartilhado, gerado uma vez por ambiente
openssl rand -hex 32

# 2. o runner, com o cerco fechado pelo orquestrador
docker run -d --name sandbox-runner \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,size=32m \
  --cap-drop=ALL --security-opt no-new-privileges \
  --network sandbox-interna \
  --memory 256m --cpus 0.5 --pids-limit 64 \
  -e SANDBOX_RUNNER_SECRET=<o segredo> \
  sandbox-runner

# 3. o backend, apontando para ele
SANDBOX_RUNNER_URL=http://sandbox-runner:4300
SANDBOX_RUNNER_SECRET=<o mesmo segredo>
```

`sandbox-interna` precisa ligar **apenas** backend↔runner, sem saída para a internet.

## Conferir que está mesmo isolado

```bash
curl -s $BACKEND/api/health   # o backend responde
# e, do backend, o gate:
#   canExecuteCode(...) precisa devolver ok
```

O jeito honesto de conferir é olhar o perfil. Todos os sete precisam ser `true`:

| Item | Se estiver `false` |
| --- | --- |
| `nonRoot` | o container está rodando como root — corrija o `USER` |
| `readOnlyRootFs` | falta `--read-only` |
| `networkDenied` | **o mais importante**: o container tem saída para a internet |
| `noNewPrivileges` | falta a flag, ou falta `SANDBOX_NO_NEW_PRIVILEGES=1` |
| `seccomp` | falta o perfil, ou falta `SANDBOX_SECCOMP=1` |
| `ephemeral` | falta `SANDBOX_EPHEMERAL=1` (e o orquestrador precisa realmente descartar) |
| `verifiedCleanup` | o `/tmp` não é gravável, ou o container não é efêmero |

Enquanto qualquer um for `false`, **código não roda** — e é assim que deve ser.

## Incidente: um pacote está fazendo algo que não devia

```
1. Desligue pelo hash (mais preciso, vale em todas as contas):
     killSwitch({ sha256, reason, createdBy })
2. Se o autor for o problema, desligue o pacote inteiro:
     killSwitch({ packageId, reason, createdBy })
3. Suspenda o pacote no catálogo (bloqueia instalação nova na hora, com motivo visível):
     POST /api/extensions/packages/:id/status { status: 'suspended', reason }
```

Nada disso apaga instalação ou histórico. Quem já instalou para de executar e **vê o
motivo**.

## Incidente: o runner não responde

O backend trata isso como **indisponibilidade**, não como falha de quem escreveu o código:
a execução devolve `not_configured` e a ferramenta diz que o runtime não respondeu. Nenhuma
execução fica pendurada — há teto de tempo dos dois lados.

```
1. docker logs sandbox-runner    # o log tem correlationId, hash, ok, kind e wallMs — nunca fonte, entrada ou saída
2. reinicie o container
3. se persistir, remova SANDBOX_RUNNER_URL: o backend volta ao padrão fail-closed
```

## Girar o segredo

```
1. gere o novo
2. suba um runner novo com ele
3. aponte SANDBOX_RUNNER_URL para o novo
4. derrube o antigo
```

Não há sessão para invalidar: cada requisição é assinada por conta própria.

## Nomear um revisor

```
PLATFORM_REVIEWERS=<accountId>,<accountId>
```

Sem a variável, **ninguém** revisa — e código não publica. Isso é o padrão.

Um revisor nomeado enxerga `GET /api/extensions/review/queue` e grava decisões em
`POST /api/extensions/review/decisions`. A decisão é imutável e presa ao hash: aprovar um
código não aprova o próximo com o mesmo número de versão.

## O que os logs contêm

| Log | Contém | Nunca contém |
| --- | --- | --- |
| runner | `correlationId`, `sha256`, `ok`, `kind`, `wallMs` | fonte, entrada, saída, segredo |
| `tool_version_calls` | ferramenta, versão, hash, risco, duração, ok/recusa | argumento, resposta |
| `extension_reviews` | quem decidiu, o quê, sobre qual hash | o código |
| auditoria | quem fez, em quê, quando | conteúdo |
