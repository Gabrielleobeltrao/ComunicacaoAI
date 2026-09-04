# Threat model — execução de código de terceiro

Este documento existe para uma pergunta: **o que acontece quando alguém publica código
malicioso no Marketplace e outra conta o instala?**

Ele descreve o que está implementado, o que cada trava cobre, e — a parte que costuma
faltar — **o que continua descoberto**.

## 1. A fronteira

```
navegador → backend (Express)          runner (serviço separado)
              │  HMAC + nonce + janela    │
              │ ─────────────────────────▶│  processo filho por execução
              │                            │  --permission, sem rede, sem disco
              │◀───────────────────────────│  resultado + métricas
              ▼
           Mongo, chaves cifradas, rede interna
```

O backend **nunca** executa código de terceiro. Isso é afirmado por um teste que lê o fonte
de `backend/src/` inteiro procurando `eval`, `new Function`, `node:vm`, `child_process`,
`worker_threads`, `execSync`, `spawnSync`, `execFile` e `fork` — mais de cem arquivos, a
cada execução da suíte.

## 2. Ativos

| Ativo | Onde mora | Por que interessa a um atacante |
| --- | --- | --- |
| Credenciais de App | `connections`, cifradas com `ENCRYPTION_KEY` | acesso às contas de terceiros dos clientes |
| Dados de conta | Mongo | conteúdo privado de outras empresas |
| Chaves de provedor | ambiente do backend | custo e acesso a modelos |
| Rede interna | VPC | pivô para o banco e para outros serviços |
| A própria plataforma | processo do backend | executar o que quiser como a aplicação |

## 3. Atacantes considerados

1. **Autor malicioso** — publica um pacote com código hostil.
2. **Autor negligente** — publica código com dependência ou lógica insegura.
3. **Autor que muda de ideia** — publica uma versão boa, é aprovado, e tenta trocar o
   conteúdo depois.
4. **Quem intercepta backend↔runner** — tenta trocar o corpo ou repetir uma requisição.
5. **Conta instalada hostil** — instala um pacote e tenta usá-lo para alcançar o que a
   conta dela não alcança.

## 4. As travas, e o que cada uma cobre

| Ameaça | Trava | Onde | Cobertura |
| --- | --- | --- | --- |
| Código lê arquivos do host | `--permission` sem `--allow-fs-*` | `runner/src/execute.mjs` | **completa** para o processo filho |
| Código abre subprocesso | `--permission` | idem | completa |
| Código carrega addon nativo | `--permission` (`ERR_DLOPEN_DISABLED`) | idem | completa |
| Código usa `eval` / `new Function` | `--disallow-code-generation-from-strings` | idem | completa |
| Código abre worker para escapar | `--permission` | idem | completa |
| Código lê segredo do ambiente | `env: { PATH }` no spawn | idem | completa |
| Laço infinito | SIGKILL após `wallMs` | idem | completa |
| Estouro de memória | `--max-old-space-size` | idem | completa |
| Resposta gigante | corte por `outputBytes` com SIGKILL | idem | completa |
| Código abre socket | **container** (`--network none` / egress negado) | deploy | **medida, não imposta pelo processo**: `profile.mjs` tenta conectar e reporta; o backend recusa habilitar se a rede não estiver negada |
| Autor se auto-aprova | registro `extension_reviews`, imutável, papel em `PLATFORM_REVIEWERS` | `backend/src/extensionRuntime/review.ts` | completa |
| Aprovar um código e publicar outro | aprovação presa ao **hash** do fonte | idem | completa |
| Trocar o corpo entre backend e runner | HMAC sobre o corpo + hash conferido no runner | `httpProvider.ts`, `execute.mjs` | completa |
| Repetir uma requisição | nonce de uso único + janela de 60 s | `runner/src/auth.mjs` | completa |
| Cliente escolher o runner | URL vem de `SANDBOX_RUNNER_URL`, do servidor | `httpProvider.ts` | completa |
| Pacote comprometido em produção | kill switch por pacote, versão ou hash | `gate.ts` | completa |
| Código alcançar App/Database | capability broker: bilhete curto, uso contado, preso à execução, permissão reconferida no resolvedor canônico | `broker.ts` | **parcial** — ver §6 |
| Instalação copiar dados do autor | manifesto só carrega forma; peneira de segredo na publicação | `packages.ts`, `materialize.ts` | completa |
| Escalar por atualização | diff de permissão exige aprovação explícita | `installs.ts` | completa |

## 5. Fail-closed, item a item

Habilitar código exige **todas** estas coisas ao mesmo tempo:

1. `CODE_TOOLS_ENABLED=1`;
2. um `SandboxRuntimeProvider` registrado (sem `SANDBOX_RUNNER_URL` + `SANDBOX_RUNNER_SECRET`, nenhum é);
3. `health()` respondendo `ok`;
4. **todos** os sete itens do perfil verdadeiros: `nonRoot`, `readOnlyRootFs`,
   `networkDenied`, `noNewPrivileges`, `seccomp`, `ephemeral`, `verifiedCleanup`;
5. scanner sem bloqueio;
6. aprovação de revisor no registro, para **este** hash;
7. nada de kill switch para o pacote, a versão ou o hash.

Falhar qualquer um recusa. Numa máquina de desenvolvimento, o item 4 falha sozinho — e há
um teste que afirma exatamente isso.

## 6. O que continua descoberto

Escrito aqui porque um threat model que só lista vitórias não serve para nada.

- **Rede depende do deploy.** O modelo de permissão do Node não cobre socket. Se o
  container for para o ar com egress liberado, o código pode abrir conexões — o `health()`
  vai dizer `networkDenied: false` e o backend vai recusar habilitar, mas quem forçar a
  flag e ignorar o health está por conta própria.
- **Um runner, vários tenants.** O isolamento entre execuções é o processo filho. Com
  `SANDBOX_CONCURRENCY=1` (padrão) e `SANDBOX_EPHEMERAL=1`, cada execução é um processo
  novo em container descartável. Com concorrência maior, duas execuções de contas
  diferentes compartilham o processo do runner — não o do código, mas o do servidor.
- **O capability broker não tem canal de volta.** Os bilhetes são emitidos e revogados,
  mas o código dentro da sandbox não tem por onde usá-los: a rede está negada. Uma
  ferramenta de código roda pura hoje — entrada e saída. Ligar isso exige um relay do
  runner para o backend, e ele ainda não existe.
- **O scanner é léxico, não AST.** Ele é derrotável por ofuscação. É a primeira peneira,
  não a defesa — está dito no próprio arquivo e nos testes.
- **Python não existe.** `runtimes` responde `["javascript"]`, e um pedido de Python é
  recusado como indisponível em vez de adivinhado.
- **Canal lateral por tempo e memória.** Nada impede o código de medir o próprio tempo.
  Sem rede e sem disco, ele não tem para onde mandar o que medir — mas isso é uma
  consequência das outras travas, não uma defesa própria.

## 7. Suíte de abuso

`backend/test/sandboxRuntime.integration.test.mjs`, `backend/test/sandboxEndToEnd.integration.test.mjs`
e `runner/test/runner.test.mjs` cobrem, com execução real: disco, subprocesso, addon
nativo, worker, `eval`, `fetch`, variável de ambiente, laço infinito, estouro de memória,
saída gigante, hash trocado, assinatura errada, replay, requisição velha, runtime
inexistente, runner fora do ar e kill switch.
