# Prédio, andar, setor, agente

A estrutura é uma metáfora levada a sério, porque ela decide **permissão**, e não só
desenho de tela.

| | o que é | decide |
|---|---|---|
| **Prédio** | a conta | o limite de tudo: nada atravessa contas |
| **Andar** | uma operação (Atendimento, Vendas) | o que é compartilhado por padrão dentro dela |
| **Setor** | um time dentro do andar | como o trabalho é coordenado, e o que o time alcança |
| **Agente** | quem faz | o que ele sabe, o que ele pode usar, e o que ele lembra |

Um agente herda o alcance do setor, o setor herda do andar, o andar do prédio. Herança é o
padrão; a exceção é sempre explícita, e sempre para MAIS restrito.

## Os três mecanismos de dados

Este é o ponto onde a maioria dos sistemas erra, e onde vale gastar dois minutos. São três
coisas diferentes, e confundi-las é o erro mais caro que se comete aqui.

| mecanismo | responde | exemplo |
|---|---|---|
| **Conhecimento** | "o que a empresa **diz**" | a política de trocas, o cardápio, o manual |
| **Memória** | "o que **eu** lembro" | este cliente já reclamou disto no mês passado |
| **Database** | "o que **aconteceu**" | 1.482 pedidos, com valor, data e situação |

Por que separados:

- **Conhecimento tem dono e validade.** Um documento pertence ao andar, ao setor ou ao
  agente, e pode vencer. Um documento vencido continua existindo e aparece marcado — ele
  não some, porque sumir esconderia que alguém precisa revisá-lo.
- **Memória é do agente.** Ela não vira verdade da empresa por repetição.
- **Database é fato, e é consultado com filtro e limite.** Um agente não recebe um console
  de banco: ele monta uma consulta declarada, que o código valida e executa. Um filtro
  inválido, um filtro que devolveria a tabela inteira e um filtro que apagaria falham de
  três jeitos diferentes — e nenhum deles chega ao agente como "resposta".

Juntar os três numa coisa só produziria um sistema que responde rápido e erra devagar: a
resposta parece certa, e a origem dela é impossível de auditar.
