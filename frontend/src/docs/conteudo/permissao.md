# Permissão e alcance

A pergunta é sempre a mesma: **este agente alcança esta coisa, e por quê?** A resposta tem
quatro partes, e a última é a que costuma faltar nos outros sistemas.

```json
{
  "allowed": false,
  "capabilities": ["discover"],
  "origin": "direct",
  "reason": "a ferramenta está desligada",
  "pending": { "code": "tool_desligada", "message": "Ligue a ferramenta em Ferramentas para o agente poder usá-la." }
}
```

- **allowed** — pode ou não.
- **capabilities** — o que exatamente pode: descobrir que existe é diferente de ler, que é
  diferente de escrever.
- **origin** — de onde vem a permissão: `direct`, `sector`, `floor`, `building`,
  `specialized_policy`, `owner` ou `none`.
- **pending** — o que fazer para destravar. Uma recusa sem isto é um beco.

## Por que a cadeia DELEGA em vez de generalizar

A tentação seria escrever uma regra genérica de herança — agente → setor → andar → prédio
— e aplicá-la a tudo. Ela produziria respostas plausíveis e erradas.

O portão de um **App** não é herança: é instalação utilizável, **mais** ação concedida,
**mais** autorização de escrita. O de **Conhecimento** é uma política com quatro modos de
setor. Uma regra genérica por cima desses dois só poderia afrouxá-los — e uma abstração
que enfraquece o portão para caber num formato genérico é pior do que não ter abstração.

O que é comum é a **forma da resposta**, não a regra. Cada tipo responde pela sua, e a
camada comum delega. É isso que a torna confiável.

## O agente é resolvido contra a conta antes de tudo

Perguntar "o agente X pode?" com um identificador de outra conta devolveria a política
daquele agente. Isso já é um vazamento, mesmo sem executar nada. Por isso o agente é
resolvido contra a conta **antes** de qualquer avaliação.

## Ver o que um agente alcança

    GET /api/agents/:agentId/resource-access

Devolve tudo o que existe com a decisão de cada item — **inclusive as negativas**, com o
motivo. Uma matriz que só lista o permitido não responde a pergunta que levou alguém até
ela, que quase sempre é "por que ele não consegue?".
