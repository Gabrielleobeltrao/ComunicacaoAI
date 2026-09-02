# Sandbox Runner

O lugar onde código de extensão roda — **fora** do processo que tem o banco, as chaves
decifradas e a rede interna.

## Por que ele existe separado

O backend não pode executar código de terceiro. Não é uma questão de disciplina: qualquer
`eval`, `vm`, `child_process` ou Python local dentro dele roda o código do outro no mesmo
processo que segura a conexão com o Mongo e as credenciais decifradas dos Apps. O
isolamento que interessa é o que existe **antes** de o código começar.

Por isso este é um serviço próprio, deployável sozinho, que não conhece conta, agente, App
nem banco. Ele recebe código, entrada e limites; devolve resultado e métricas.

## O que o código do autor não consegue fazer

Cada execução é um processo filho novo, com:

| Mecanismo | O que ele nega |
| --- | --- |
| `--permission` | filesystem, subprocesso, worker threads e addon nativo — negados dentro do próprio Node |
| `--disallow-code-generation-from-strings` | `eval` e `new Function` |
| `--max-old-space-size` | teto de heap; estourar mata o processo |
| `-e` com o programa inteiro | não há arquivo para ler nem nada em disco para sobrar |
| `env: { PATH }` | nenhuma variável do runner atravessa |
| `SIGKILL` no timeout | laço infinito não responde a pedido educado |
| corte de saída | resposta gigante é interrompida, não bufferizada |

O que o processo **não** consegue garantir sozinho é rede: o modelo de permissão do Node
não cobre socket. Quem nega isso é o container — e o runner **mede** em vez de afirmar
(`profile.mjs` tenta uma conexão de saída e reporta o resultado).

## O perfil é medido, não declarado

`GET /health` devolve o perfil real:

```json
{ "ok": true, "profile": { "nonRoot": true, "readOnlyRootFs": true, "networkDenied": true,
  "noNewPrivileges": true, "seccomp": true, "ephemeral": true, "verifiedCleanup": true,
  "permissionModel": true, "tmpWritable": true }, "runtimes": ["javascript"] }
```

O backend exige **todos** os itens. Numa máquina de desenvolvimento, `networkDenied` e
`ephemeral` dão `false` — e é isso que mantém código desligado sem ninguém precisar
lembrar de uma flag.

`ephemeral`, `noNewPrivileges` e `seccomp` vêm de variáveis de ambiente porque o processo
não consegue provar o que o orquestrador faz com o container dele. Falsos por omissão.

## Autenticação

Serviço, nunca navegador. Cada requisição carrega:

- `x-sandbox-timestamp` — janela de 60 s;
- `x-sandbox-nonce` — vale uma vez;
- `x-sandbox-signature` — HMAC-SHA256 de `timestamp.nonce.body` com `SANDBOX_RUNNER_SECRET`.

Sem `SANDBOX_RUNNER_SECRET`, o runner responde 503 a todo mundo: um runner aberto é pior
que um runner ausente.

## Variáveis

| Variável | Padrão | O que faz |
| --- | --- | --- |
| `SANDBOX_RUNNER_SECRET` | — | **Obrigatória.** O segredo compartilhado com o backend. Sem ela nada é atendido |
| `PORT` | `4300` | Porta HTTP |
| `SANDBOX_CONCURRENCY` | `1` | Execuções simultâneas. Acima disso o runner recusa em vez de enfileirar |
| `SANDBOX_EPHEMERAL` | — | `1` quando o orquestrador descarta o container a cada execução |
| `SANDBOX_NO_NEW_PRIVILEGES` / `SANDBOX_SECCOMP` | — | `1` quando o container aplica essas travas |
| `SANDBOX_NET_PROBE_HOST` / `_PORT` | `1.1.1.1:443` | Alvo do probe de rede |

E do lado do backend:

| Variável | O que faz |
| --- | --- |
| `SANDBOX_RUNNER_URL` | Endereço do runner. **Vem da configuração do servidor, nunca de um pedido** |
| `SANDBOX_RUNNER_SECRET` | O mesmo segredo |
| `SANDBOX_RUNNER_TIMEOUT_MS` | Teto do lado do backend (padrão 20 s) |

## Rodar

```bash
SANDBOX_RUNNER_SECRET=$(openssl rand -hex 32) npm start --prefix runner
npm test --prefix runner
```

## O que ainda não existe

- **Python.** `runtimes` responde `["javascript"]`, e um pedido de Python é recusado como
  indisponível em vez de adivinhado.
- **Canal do capability broker.** O backend emite bilhetes de curta duração e os revoga no
  fim, mas o código dentro da sandbox ainda não tem por onde usá-los: a rede está negada, e
  o caminho de volta precisa ser um relay do runner para o backend. Enquanto isso não
  existir, uma ferramenta de código roda pura — entrada e saída, sem alcançar App nem
  Database.
