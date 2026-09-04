# ADR 003 — Inventário e grafo de dependências

## Contexto

O contexto que o Arquiteto envia hoje é parcial e escolhido à mão. Para decidir entre
expandir e criar, ele precisa saber o que a conta já tem — e mandar o banco inteiro para o
modelo não é uma opção: custo, limite de contexto e vazamento.

## Decisão

Duas representações, com propósitos diferentes:

1. `OfficeInventory` — completo, owner-scoped, paginado. É lido pelo **código
   determinístico**: é ele que decide reuso, detecta duplicata e calcula diff.
2. `OfficeInventorySummary` — o mínimo da rodada atual. É o que vai para o modelo.

E um `DependencyGraph` comum:

```ts
interface ResourceNode { kind: string; id: string; ownerScope: string; label: string }
interface ResourceEdge { from: string; to: string; relation: string; required: boolean }
```

**O grafo não decide autorização.** Ele serve a duas perguntas: qual é o impacto de mexer
neste nó, e em que ordem aplicar. Quem decide acesso continua sendo o adapter de cada
domínio — App por instalação + ação + escrita autônoma, Knowledge pela política de escopo,
Database e Source pelos grants próprios.

## Consequências

Uma herança genérica de permissão no grafo seria mais simples de escrever e estaria errada
em pelo menos um domínio no primeiro mês. A duplicação aparente (grafo para impacto,
adapter para acesso) é deliberada.

O inventário é a superfície mais cara desta implementação: ele toca todos os domínios. Por
isso é paginado, resumido e tem teto — e por isso tem teste de conta cruzada.
