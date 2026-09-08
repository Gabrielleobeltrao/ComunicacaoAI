# O Arquiteto e o Blueprint

O Arquiteto monta uma operação inteira a partir de uma conversa. O que o torna diferente
de um assistente que "cria coisas" é o que ele **não** faz.

## O modelo classifica; o código decide

O modelo lê o que você escreveu e produz uma **descrição** do que deveria existir. Ele não
executa nada e não escolhe identificadores. Quem cria, cria o código, a partir de chaves
estáveis — nunca de um id que o modelo tenha escrito.

A razão é direta: um modelo que inventa um `ObjectId` inventa um plausível. O sistema
aceitaria, gravaria, e a coisa apontaria para o nada — ou, pior, para outra coisa.

## O ciclo, sempre igual

1. **Pergunta ou ação?** Perguntas informativas são respondidas e acabam ali. Só o que
   muda dados entra no ciclo abaixo.
2. **Plano** — o que será criado, em que ordem, e do que depende.
3. **Validação** — o que falta, e o que já existe com esse nome.
4. **Prévia e diff** — o que muda, item a item.
5. **Impacto** — o que passa a poder o quê.
6. **Confirmação explícita** — ninguém confirma por você.
7. **Execução idempotente** — reexecutar não duplica.
8. **Auditoria** — fica registrado quem pediu, o que foi feito, e quando.

Nenhum passo é pulado quando a operação é pequena. Um fluxo que encurta "porque é só um
agente" é o fluxo que cria dois agentes quando a rede oscila.

## O que ele cria

Andares, setores, agentes, responsabilidades, conhecimento, Apps, permissões, databases,
ferramentas, fluxos, rotinas e monitores — cada um por **chave estável**, o que é o que
torna a reexecução segura.

## Rotas

    POST /api/architect/assistant/turn
    POST /api/architect/assistant/confirm
    GET  /api/architect/context
    POST /api/architect/projects
    GET  /api/architect/projects
