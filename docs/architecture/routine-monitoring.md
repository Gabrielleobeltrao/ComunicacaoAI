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
  lastResult: 'changed' | 'no_change' | 'failed' | null
  lastRunAt: string | null
  lastError: { kind: string; message: string } | null
}
```

`lastCheckedAt` e `lastChangedAt` são campos separados de propósito: é a diferença
entre "está funcionando e não há novidade" e "parou de verificar".

### `POST /routines` · `PATCH /routines/:id`

Aceitam `source` no corpo. **Omitir `source` num PATCH preserva a fonte atual** —
não a apaga. Rotina sem `source` compila exatamente como antes: um único passo
`agent.execute`, sem passo de fonte e sem checkpoint.

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

- A **primeira** verificação aplica a janela escolhida (24h/3d/7d). As seguintes não
  — senão um item sem data, ou com data antiga, se perderia para sempre.
- Em HTTP a primeira volta conta como mudança: é a linha de base.
- `seenKeys` tem teto de 500 chaves; o que sai é o mais antigo.
- **O checkpoint só avança depois que tudo deu certo.** Falha na entrega, na LLM ou
  na rede deixa o checkpoint onde estava, e a próxima volta reprocessa. Perder um
  item é pior que repetir um.
- Apagar a rotina apaga o que ela viu.

## Segurança

A URL vem do usuário e quem busca é o servidor — isto é a definição de SSRF, e é a
parte que não pode falhar.

- Preview e worker passam pelo **mesmo `safeFetch`**. Testar com regra mais frouxa
  que a execução seria pior que não testar; há um teste que trava essa arquitetura.
- Bloqueados: protocolo que não seja http/https, loopback, `.local`/`.internal`,
  faixas privadas, link-local e metadata da nuvem — revalidados **a cada redirect**.
- Timeout, teto de bytes e allowlist de Content-Type.
- O audit log nunca recebe credencial, query string nem conteúdo integral.
- Nesta fase não há JavaScript remoto nem navegador headless: página que só monta
  no cliente chega vazia, e o preview diz isso em vez de fingir sucesso.
- O conteúdo buscado entra no prompt marcado como não confiável.

## O que não mudou

Gatilhos webhook são outra coisa e continuam iguais — monitoramento pergunta de
tempos em tempos, webhook é avisado. Rotinas criadas antes disto tudo não têm
`source`, compilam como sempre compilaram e não criam checkpoint.

Nenhuma variável de ambiente nova.
