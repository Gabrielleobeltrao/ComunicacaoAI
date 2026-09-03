# ADR 006 — Como o V2 entra, e como ele sai

## Contexto

O Blueprint V2 acrescenta recursos e operações ao que a proposta desenha: Databases,
datasets, fontes, destinos ao vivo, históricos, monitores e Flows. Ligá-lo de uma vez mudaria
o que **toda conta existente** recebe ao continuar uma conversa antiga — e o caminho de volta
seria um deploy, não uma variável.

Há também um problema concreto de convivência. Enquanto o V2 rola, quem cria andares e
agentes continua sendo a saga do V1, a partir do plano V1. Os dois compiladores derivam do
mesmo Brief, mas divergiam numa coisa: o V1 usa sempre a chave de andar `operacao`, e o V2
gera **uma por área**. Com os dois rodando juntos, um Flow do V2 apontaria para
`floor:atendimento` enquanto a saga criou `floor:operacao`.

## Decisão

**1. Uma flag de ambiente, lida a cada compilação.** `ARCHITECT_BLUEPRINT_V2`, com `1`,
`true` ou `on` ligando e qualquer outra coisa — inclusive a ausência — deixando desligado.
Lida a cada chamada, não no boot: mudar a variável e reiniciar basta, não há cache a limpar.

Desligada, **nada muda**: o projeto não ganha `blueprintV2`, a saga não roda o passo do V2, e
o hash é exatamente o que já era.

**2. Uma organização, dois documentos.** `compileBriefV2` passa a aceitar **andares decididos
fora** e a usá-los como estão, sem inventar `key` nenhuma. Quem decide a organização é quem a
aplica.

**3. O hash cobre os dois planos.** `computeBlueprintHash(v1, v2?)`. Sem isso, mudar só os
monitores deixaria o hash do V1 igual, e um clique feito olhando a revisão anterior aplicaria
uma operação que ninguém leu. Projetos sem V2 continuam com exatamente o hash que já tinham.

**4. Sem backfill.** Projetos antigos não são convertidos em massa. A conversão V1→V2
preserva `key` e `resourceId`, mas o V2 exige campos que o V1 não tem — função, gatilho,
contrato de entrada e de saída de cada agente — e o conversor **não os inventa**: ele os
deixa vazios e declara a pendência. Rodar isso em lote encheria as contas de pendências que
ninguém pediu, num plano que talvez nunca seja aplicado de novo.

A conversão acontece sob demanda, no único momento em que a pendência tem para quem
aparecer: a instalação de um template da Comunidade, por exemplo.

## Alternativas descartadas

**Migração destrutiva com backfill.** Não há o que reverter porque não há o que migrar: o
campo é novo e opcional. Uma migração criaria a necessidade de um rollback que hoje não
existe.

**Flag por conta, no banco.** Mais poder do que este rollout precisa, e mais uma coleção para
manter em sincronia. Uma variável de ambiente é revertida por quem opera, sem deploy e sem
escrita.

**Deixar o V2 inventar os próprios andares e fazer a saga adivinhar.** Uma heurística de
"provavelmente é este andar" erra em silêncio e coloca o Flow no lugar errado. Receber os
andares prontos é uma linha, e não erra.

**Ligar por padrão e desligar se der problema.** O "se der problema" seria descoberto pela
pessoa cujo escritório ficou duplicado.

## Consequências

O rollback é uma variável de ambiente e um restart.

Projetos que **já têm** `blueprintV2` continuam funcionando com a flag desligada: ela controla
se planos novos são compilados, não se os antigos valem. Está travado em teste.

A flag **não sai** enquanto a tela não expuser a prévia V2 e a autorização de ativação — hoje
`approvedActivationKeys` só é enviável pela API. É a pendência que separa "funciona" de
"pronto para todo mundo".
