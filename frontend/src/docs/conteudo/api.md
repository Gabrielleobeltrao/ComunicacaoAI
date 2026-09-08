# A API

REST sobre JSON. Toda rota privada exige sessão, e **o escopo de conta entra no filtro do
banco** — não é um `if` depois da consulta. Um identificador de outra conta responde 404,
igual a um que não existe: a diferença entre "não é seu" e "não existe" é exatamente o que
um inventário de contas alheias precisaria.

## Prontidão

Duas rotas, e elas respondem coisas diferentes.

    GET /api/health   → o processo está de pé
    GET /api/ready    → o processo está PRONTO para receber tráfego

`/api/ready` cobre banco **e** motor de automações. Uma instância que não consegue rodar
rotina não recebe tráfego como se conseguisse:

```json
{ "status": "ready", "mongo": "ok", "engine": "embedded" }
```

Com o banco fora, ela responde **503** — e não 200 com um campo dizendo que algo está
errado, que é o formato que ninguém lê.

## Os recursos

    GET    /api/floors                     lista os andares
    POST   /api/floors                     cria um andar
    GET    /api/floors/:floorId            um andar
    PATCH  /api/floors/:floorId            altera

    GET    /api/databases                  lista os databases
    POST   /api/databases                  cria
    GET    /api/databases/:id              um database

    GET    /api/monitors                   lista os monitores
    POST   /api/monitors                   cria
    POST   /api/monitors/:id/publish       publica (só publicado dispara)
    POST   /api/monitors/:id/pause         pausa

    GET    /api/knowledge/graph            o mapa de conhecimento de um andar
    GET    /api/resources                  o inventário, por tipo e escopo
    GET    /api/executions                 o que rodou, com custo

## Consultar um Database

O agente não recebe um console de banco. Ele monta uma consulta declarada, e o servidor a
valida antes de executar:

```
POST /api/databases/:id/datasets/:key/query
{
  "filter": { "field": "ticker", "op": "eq", "value": "PETR4" },
  "limit": 50,
  "skip": 0
}
```

A resposta separa **quantos vieram** de **quantos existem** — a diferença muda a conclusão
de quem lê:

```json
{ "rows": [], "total": 137, "returned": 50, "truncated": true, "freshness": "2026-09-07T12:00:00.000Z" }
```

O limite tem teto de 500 e padrão de 50. Um filtro que devolveria a tabela inteira é
recusado, e não silenciosamente truncado.

## Erros

Recusa diz o motivo **acionável**, e nunca ecoa segredo:

```json
{ "code": "conexao_expirada", "message": "Reconecte \"Canal de vendas\" em Apps." }
```
