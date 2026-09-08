# Por que é assim

As decisões que explicam o resto do sistema. Elas custaram alguma coisa, e é por isso que
estão escritas.

## O modelo classifica; o código decide

O modelo lê, entende e descreve. Quem cria, valida e executa é o código. Em particular:
**nenhum identificador vem do modelo**. Um modelo que inventa um id inventa um plausível,
e o plausível grava.

## Falhar fechado, e dizer o motivo acionável

Na dúvida, o sistema recusa. E a recusa diz o que fazer — "reconecte tal coisa em Apps" —
em vez de "não autorizado". Uma recusa sem caminho é um beco, e um beco vira um chamado
de suporte.

## Monitor parado não gasta token

Um monitor observa uma fonte e só existe consumo quando **algo muda**. Enquanto o valor
não cruza a condição, não há chamada de modelo — nem uma. A alternativa comum, perguntar
ao modelo de minuto em minuto se algo mudou, é uma conta que cresce sozinha enquanto nada
acontece.

E quando cruza, a transição é **atômica e deduplicada**: a mesma borda não vira dois
alertas, mesmo se o processo cair no meio e subir de novo.

## Gravar não depende de observar

Quem observa um registro é avisado **depois** que o registro existe, fora da gravação. Um
ouvinte que falha não desfaz o que foi gravado: o registro é um fato, e um fato não some
porque quem o observava quebrou.

## Quantos vieram nunca é quantos existem

Toda listagem separa os dois números. `50 de 137` e `137 de 137` levam a decisões
diferentes, e um sistema que mostra só o primeiro leva quem lê a concluir o segundo.

## Vazio é evidência, não estimativa

Quando o sistema diz que ninguém usou um recurso, ele está dizendo que **procurou e não
achou** — não que não sabe. É a diferença entre um relatório e um chute com aparência de
relatório.

## Nada de código do cliente rodando solto

Ferramentas são HTTP declarado: método, endereço, parâmetros. `eval`, `new Function`,
comando de shell e caminho de módulo arbitrário estão proibidos por construção. Enquanto
não houver um sandbox que se possa defender, código de usuário fica desligado — e isso
está documentado como bloqueio, não escondido como "em breve".
