# Monitorar um site ou um feed a partir da rotina

Uma rotina pode, em vez de rodar sempre com a mesma entrada, **olhar uma fonte e só
executar quando ela mudou**. É o mesmo motor de automação de sempre
(`source.rss` / `source.http` → `agent.execute` → `delivery.send`); a novidade é o
checkpoint que decide se vale a pena chamar a LLM.

Não existe página nova: isso vive dentro das Rotinas do agente.

## A regra que dá sentido ao recurso

**Sem mudança, nada acontece.** A verificação lê a URL, compara com o que já tinha
visto e, se for igual, encerra ali: nenhuma LLM, nenhum token, nenhuma entrega. A
execução é gravada como sucesso `no_change` — não como erro, e sem retry, porque
não há nada para tentar de novo.

Verificar de 15 em 15 minutos e nunca achar nada é o comportamento correto, e a
lista precisa deixar isso visível para o dono distinguir calmaria de defeito.

## Contrato da API

Tudo abaixo é aninhado no agente: `/api/agents/:agentId/...`, com dono validado.

### `RoutineSource`

```ts
type RoutineSource =
  | { kind: 'fixed' }                                                    // comportamento de sempre
  | { kind: 'rss';  url: string; initialWindow: '24h'|'3d'|'7d'; focus?: string }
  | { kind: 'http'; url: string; focus?: string }
```

`url` só aceita `http:`/`https:`. `focus` é o que o dono quer que o agente olhe no
conteúdo novo; ele entra no prompt junto do objetivo da rotina.

### `GET /routines`

Cada rotina passa a devolver `source`. As que monitoram vêm também com:

```ts
monitoring: {
  lastCheckedAt: string | null   // última vez que a fonte foi consultada
  lastChangedAt: string | null   // última vez que havia algo novo
  lastResult: 'changed' | 'no_change' | 'skipped_concurrent' | 'skipped_stale' | 'failed' | null
  lastRunAt: string | null
  lastError: { kind: string; message: string } | null
}
```

`lastCheckedAt` e `lastChangedAt` são campos separados de propósito: é a diferença
entre "está funcionando e não há novidade" e "parou de verificar".

Dois desfechos são sucessos que não processaram nada, e nenhum dos dois é erro:
`skipped_concurrent` (a fonte já estava sendo verificada por outra execução, ver
**Lease**) e `skipped_stale` (a execução carregava uma fonte que não é mais a
publicada, ver **Execução que envelheceu**).

### `POST /routines` · `PATCH /routines/:id`

Aceitam `source` no corpo. **Omitir `source` num PATCH preserva a fonte atual** —
não a apaga. Rotina sem `source` compila exatamente como antes: um único passo
`agent.execute`, sem passo de fonte e sem checkpoint.

A validação de frequência usa a fonte **efetiva**, resolvida depois de carregar a
rotina — não o que veio no corpo. Um monitor que verifica de 15 em 15 minutos não
pode ser recusado como "rotina fixa" só porque o cliente omitiu `source`. Por isso a
regra mora em `createRoutine`/`updateRoutine`, e não na rota.

**Frequência curta é privilégio de quem monitora.** `minutes` e `hourly` só valem
com fonte RSS/HTTP; numa rotina de entrada fixa são recusadas com 400. Uma rotina
fixa rodando de 5 em 5 minutos chamaria a LLM 288 vezes por dia com exatamente a
mesma entrada. Quem monitora pode porque a verificação é de graça e a LLM só roda
quando há mudança. A interface já não oferece a combinação; a API recusa porque não
é a interface a única forma de chegar nela.

### `POST /routines/test-source`

```
body: { kind: 'rss'|'http', url: string, initialWindow?: '24h'|'3d'|'7d' }
resp: { ok, kind, message, itemCount?, items?, excerpt? }
```

Consulta e mostra o que a fonte devolve, **sem LLM, sem gravar nada e sem tocar no
checkpoint** — testar não pode fazer a rotina pular um item de verdade depois. Não
é auditado (não altera estado). A resposta nunca traz corpo cru nem a URL completa,
que pode carregar token em query string.

### `POST /routines/:id/check-now`

Enfileira uma verificação agora, pelo caminho normal do worker. É diferente de
"testar a fonte": esta conta como execução de verdade, avança o checkpoint e pode
entregar. Auditado como `routine/run`.

## Checkpoint

Coleção `source_checkpoints`, única por `{ownerId, automationId, stepId}`.

| Fonte | Como decide se mudou |
|-------|----------------------|
| RSS/Atom | chave estável do item: `guid`, senão `link`, senão hash de `título+data` |
| HTTP | SHA-256 do conteúdo normalizado (sem script, style, comentário, marcação; espaços colapsados) |

### A primeira leitura

É o caso delicado, e as duas metades fazem coisas diferentes:

- a **janela** (24h/3d/7d) decide o que vai para o agente. Sem ela, assinar um feed
  antigo despejaria o arquivo inteiro numa execução só;
- o **checkpoint** recebe o feed inteiro, item velho incluído. Se guardasse só o que
  foi entregue, um item de duas semanas atrás voltaria como "novo" na volta
  seguinte, quando a janela deixa de ser aplicada.

Sem item recente na estreia: nenhuma LLM, resultado `no_change` — **e a linha de
base é gravada mesmo assim**. Não há etapa nenhuma para falhar depois, então não há
o que perder, e sem isso o feed inteiro seria relido como novidade.

`initialized` é um campo próprio, e não `seenKeys.length === 0`: um feed
legitimamente vazio tem zero chaves e **está** inicializado. Sem a distinção ele
reaplicaria a janela para sempre, e o primeiro item a aparecer — se tivesse data
antiga — cairia fora dela e sumiria.

Em HTTP a primeira leitura conta como mudança: é a linha de base.

### Avanço

- `seenKeys` tem teto de 500 chaves; o que sai é o mais antigo.
- **O checkpoint só avança depois que tudo deu certo.** Falha na entrega, na LLM ou
  na rede deixa o checkpoint onde estava, e a próxima volta reprocessa. Perder um
  item é pior que repetir um. (A exceção é a linha de base acima, onde nada seria
  processado de qualquer forma.)
- O avanço é uma única operação atômica no Mongo, e nunca cria o documento: quem
  avança é sempre uma verificação que já foi aberta.

### Identidade da fonte

`sourceFingerprint` = SHA-256 de `tipo|URL normalizada` (host em minúsculas, sem
fragmento). É hash, e não a URL, porque a URL pode carregar token em query string.

Quando ele muda — outra URL, ou RSS ↔ HTTP — o checkpoint recomeça: `seenKeys` e
`contentHash` zerados, janela inicial valendo de novo. Trocar **foco, horário,
formato ou destino não muda nada disto**: nenhum deles entra no fingerprint.

O fingerprint também vai no **filtro** do avanço. Uma execução que começou com a URL
antiga e terminou depois da troca não casa o filtro, não grava nada, e o conteúdo de
uma fonte não contamina o checkpoint da outra.

### A "vez" do monitoramento

`instanceId` na configuração da etapa de fonte, e dentro do fingerprint quando
existe. Ele responde ao que a URL sozinha não distingue: **desligar o monitoramento
e religar na mesma URL**. No meio do desligamento o feed andou; quem religa quer
saber o que há agora — nem receber de uma vez tudo que passou, nem ficar em silêncio
porque aquilo "já foi visto".

| Mudança | Vez |
|---------|-----|
| foco, horário, formato, destino, janela inicial | a mesma |
| URL ou tipo | outra |
| `fixed` → RSS/HTTP (religar) | outra |

Rotinas anteriores ao campo não têm `instanceId`, e aí o fingerprint é exatamente o
de antes — é assim que o checkpoint delas continua valendo **sem migração de dados**.

## Execução que envelheceu

Uma execução é enfileirada às 10h00 com a URL de então; o dono troca a URL às 10h01;
o worker só pega a execução às 10h02. Ela carrega uma fonte que já não existe.

O filtro do avanço não resolve isso, porque o estrago acontece antes: o `beginCheck`
dela veria "fingerprint diferente" e **redefiniria para a fonte antiga** o checkpoint
que a fonte nova acabou de criar.

Então, antes de qualquer coisa — antes de buscar, antes de tocar no checkpoint,
antes de tomar lease — a etapa de fonte pergunta se o seu fingerprint é **igual** ao
da definição publicada. Se não for: `skipped_stale`, sem busca, sem LLM, sem
entrega, sem checkpoint.

**Fecha na dúvida.** Só segue quem bate exatamente. Rotina apagada, versão publicada
que sumiu, ponteiro de publicação vazio, monitoramento desligado para `fixed`: em
todos, a fonte que a execução carrega não é mais a que a rotina publica, e continuar
seria buscar um endereço que ninguém mais pediu para vigiar. Descartar uma execução
obsoleta não cala a rotina — a definição atual continua disparando no horário dela.

Uma execução **sem** monitoramento não pergunta nada: ela roda o snapshot dela, que
é o que preserva a reprodutibilidade.

## Lease

O `$push` atômico protege a escrita, não o processamento: o agendador dispara às
10h00, o dono clica em "Verificar agora" no mesmo segundo, as duas execuções leem o
mesmo checkpoint, veem o mesmo item novo e chamam a LLM. Dois custos, duas entregas
do mesmo conteúdo.

Coleção `source_leases`, única por `{ownerId, automationId, stepId,
sourceFingerprint}`. A tomada é uma escrita só: o filtro exige um lease vencido, e
quem perde a corrida recebe erro de chave duplicada — não uma leitura que pode
envelhecer entre o "tem alguém aqui?" e o "então sou eu".

- Quem perde encerra como `skipped_concurrent`: sem LLM, sem entrega, sem erro.
- O lease é devolvido no sucesso **e na falha** — se ficasse só no caminho feliz,
  um erro de um segundo calaria a rotina por quinze minutos.
- Expira em 15 minutos. É o que devolve a fonte depois de um crash: um processo que
  morre no meio não libera nada.
- Não se toma lease quando não há o que processar: verificar é barato e acontece o
  tempo todo.

## Segurança

A URL vem do usuário e quem busca é o servidor — isto é a definição de SSRF, e é a
parte que não pode falhar.

- Preview e worker passam pelo **mesmo `safeFetch`**. Testar com regra mais frouxa
  que a execução seria pior que não testar; há um teste que trava essa arquitetura.
- Bloqueados: protocolo que não seja http/https, loopback, `.local`/`.internal`,
  faixas privadas, link-local e metadata da nuvem — revalidados **a cada redirect**.
- Timeout, teto de bytes e allowlist de Content-Type.
- **Fonte aceita só 2xx.** Uma página de erro tem conteúdo próprio — timestamp, id
  de requisição — que muda sozinho; sem esta porteira, cada instabilidade do
  servidor seria lida como "o site mudou". A ferramenta HTTP genérica do agente
  continua vendo o 404 e o 500: são a resposta que ela foi buscar. A diferença é a
  opção `requireOk`, pedida só pela camada de fontes.
- **2xx sem conteúdo é falha, não `no_change`.** Uma página que só monta no
  navegador chega vazia depois de tirar a marcação. Comparar vazio com vazio diria
  "não mudou" para sempre; mandar vazio para a LLM gastaria tokens com nada. A
  mensagem diz o motivo real — a URL está certa, o que falta é JavaScript, que não
  roda aqui. Vale igual no preview e na execução, e não é retry: a página não vai
  encher sozinha.
- **Feed que não é feed é falha, não `no_change`.** Uma página de login ou de
  manutenção responde 200 com zero item; chamar isso de "sem novidade" faria a
  rotina jurar para sempre que está tudo bem. Um feed legítimo e realmente vazio tem
  raiz de feed e passa.
- O audit log nunca recebe credencial, query string nem conteúdo integral.
- Nesta fase não há JavaScript remoto nem navegador headless: página que só monta
  no cliente chega vazia, e o preview diz isso em vez de fingir sucesso.
- O conteúdo buscado entra no prompt marcado como não confiável.

## Migração

`backfillSourceFingerprints` carimba a identidade da fonte nos checkpoints gravados
antes do campo existir, lendo a URL da própria definição publicada. Sem ela, o
primeiro `beginCheck` veria "fingerprint diferente" (ausente ≠ o atual), zeraria o
checkpoint e reentregaria o que já tinha sido entregue. Nada é apagado, e rodar duas
vezes não faz nada na segunda. Checkpoint cuja fonte não dá para identificar fica
como está: um fingerprint errado custaria silêncio, recomeçar custa uma reentrega.

## O que não mudou

Gatilhos webhook são outra coisa e continuam iguais — monitoramento pergunta de
tempos em tempos, webhook é avisado. Rotinas criadas antes disto tudo não têm
`source`, compilam como sempre compilaram e não criam checkpoint.

Nenhuma variável de ambiente nova.
