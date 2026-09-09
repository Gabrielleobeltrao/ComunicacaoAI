# O Arquiteto: plano de conserto

Escrito a partir de **duas conversas reais**, lidas do banco — não de leitura de código.
O projeto `6a9b185f01f784a8ae148731` tem 46 mensagens e foi aplicado em 09/09 às 11:21.
Cada afirmação abaixo tem a evidência ao lado.

---

## 1. O que a evidência mostra

### 1.1 Ele concorda e não faz

O dono escreveu **"E pq está com web-chat, não vamos precisar disso"** — e repetiu a mesma
frase de novo, palavra por palavra. As duas respostas foram *"Você tem razão… vou ajustar a
proposta removendo qualquer canal de conversa"*.

O que foi aplicado:

```
["channel","created","canal do site criado e apontado para quem recebe"]
```

O mesmo padrão aparece em **"Anexa para mim"**, dito duas vezes: as duas respostas foram
"vou considerar que vocês vão anexar" — e o passo de conhecimento saiu
`["knowledge","skipped","sem conteúdo: continua pendente"]`.

E em **"Corrige a proposta"** / **"Crie uma nova proposta"**: seis respostas seguidas
começando por *"Ajustei"*, *"Montei"*, *"Redesenhei do zero"*. O plano não mudou entre elas.

> **A resposta é escrita pelo modelo e o plano é montado pelo compilador, e ninguém
> compara os dois.** O texto narra um trabalho que não aconteceu. É isto que faz o
> Arquiteto "atrapalhar mais que ajudar": não é ele errar, é ele **dizer que fez**.

### 1.2 Tirar o canal do entendimento é o que CRIA o canal

`resolveChannel`, em `compileV2.ts`:

```ts
// Ninguém pediu canal: aí sim o conectado serve, porque não há pedido para contrariar.
const conectado = canais.find((c) => c.connected)
```

O dono insistiu até `brief.channels` ficar `[]`. Com a lista vazia, o compilador cai no
padrão e usa **o primeiro canal conectado da conta** — web_chat. Esvaziar a lista é
exatamente o que dispara o default.

Há **dois caminhos de canal** (o `appRequirements` do V1 e o `operations.channels` do V2)
e só o primeiro ganhou a trava de "porta só onde alguém entra".

### 1.3 O agente sabe escrever e não sabe ler

`resourceMap` da aplicação tem **uma** base: a de destino. A base de origem — a que já
recebe o preço do bitcoin — não entrou no plano, e por isso não recebeu concessão.

A causa é minha, do commit anterior: ao reconhecer que a fonte já existe, o compilador
`return`ava sem colocar a base no plano. Evitar a coleta duplicada estava certo; sair sem
declarar de onde se lê, não.

**Resultado prático: o agente aplicado não alcança o dado que a operação inteira existe
para ler.**

### 1.4 O que ele não sabe do próprio sistema

| ele disse | a verdade |
|---|---|
| "não temos function/tool que leia e escreva nessas bases" | `database_query` existe desde sempre; `database_insert_rows` existe agora |
| "vou considerar que vocês vão anexar o documento" | ele não anexa nada, e não diz onde se anexa |
| nunca mencionou **monitor** | a plataforma tem Central de Monitoramento, e "quando X acontecer, faça Y" é exatamente ela |
| "não dá para tirar o LLM da jogada" | máximo de uma série é `math.summary`, determinístico |

### 1.5 O resto do que saiu aplicado

- andar **"Salão"** — o do restaurante — porque é o primeiro da lista;
- rotina com `cron: 0 8 * * *` **America/Sao_Paulo**, para um pedido que diz "fim do dia em
  Orlando, com horário de verão", e nasce `draft` (não roda);
- agente `analyst` LLM cujo objetivo é o nome do trabalho, sem instrução de como fazê-lo;
- conhecimento pendente, sem caminho para resolver.

---

## 2. A causa de fundo

Três, e as três são de arquitetura, não de modelo:

1. **A resposta não é derivada do plano.** O modelo escreve a frase; o compilador monta o
   documento; nada verifica se a frase descreve o documento.
2. **O catálogo é incompleto e o modelo só sabe o que o catálogo diz.** Omitir uma
   capacidade não o deixa em dúvida — o faz concluir que ela não existe, com convicção.
3. **Defaults silenciosos onde deveria haver pergunta ou recusa.** Canal conectado, andar
   `[0]`, cron das oito, fuso de São Paulo. Todos escolhem por conta própria e nenhum diz
   que escolheu.

> Trocar o modelo não conserta nenhuma das três.

---

## 3. As fases

Cada uma tem: o defeito, a mudança, o que aceita e o dente que a prova.

### Fase 1 — A resposta passa a dizer o que MUDOU

**Defeito:** §1.1.

**Mudança:** depois de compilar, o servidor calcula o diff entre o plano anterior e o novo
(já existe `diff.ts` e `previousBlueprint`) e **anexa ao texto do modelo** um resumo factual:
o que foi criado, removido, alterado — ou, quando nada mudou, a frase de que nada mudou e
por quê. O modelo continua redigindo; ele deixa de ser a única fonte sobre o que aconteceu.

**Aceita quando:** uma rodada que não altera o plano produz uma resposta que **diz** que
nada mudou; uma rodada que remove o canal diz que removeu o canal.

**Dente:** forçar uma rodada sem mudança e verificar que a resposta não contém "ajustei",
"montei" nem "removi" sem o diff correspondente.

### Fase 2 — Porta de entrada só onde alguém entra (o caminho do V2)

**Defeito:** §1.2.

**Mudança:** `resolveChannel` deixa de cair no canal conectado quando **nenhum trabalho é
disparado por uma pessoa falando** — a mesma regra `ehConversa` já aplicada no V1, movida
para um lugar só e usada pelos dois compiladores. Lista vazia passa a significar "sem
canal", que é o que a pessoa quis dizer.

**Aceita quando:** operação só-rotina não ganha canal, mesmo com web_chat conectado; quem
atende continua ganhando.

**Dente:** com o default de volta, o caso da operação sem conversa falha.

### Fase 3 — A base de origem entra no plano

**Defeito:** §1.3.

**Mudança:** ao reconhecer a fonte que já existe, o compilador declara a base dela como
`reuse` com `agentAccess: 'read'` em vez de sair calado. A coleta continua não sendo
duplicada; o que muda é que a leitura passa a ser declarada e concedida.

**Aceita quando:** o plano do caso do bitcoin tem **duas** bases — origem (`read`) e destino
(`write`) — e a aplicação cria duas concessões.

**Dente:** sem a declaração, o `resourceMap` volta a ter uma base só.

### Fase 4 — O catálogo conta o sistema inteiro

**Defeito:** §1.4.

**Mudança:** `manifestForPrompt` passa a declarar, além do que já declara:
- **monitores** — "quando o valor cruzar X, dispare Y" é um recurso, não um agente;
- **fontes de monitoramento** — de onde dado ao vivo entra;
- **o que o Arquiteto NÃO faz**: não escreve código, não anexa arquivo, não configura
  credencial — e, para cada um, **onde a pessoa faz**. Uma recusa sem caminho é um beco.

**Aceita quando:** o catálogo cita monitor e fonte; e um pedido de "me avise quando" produz
monitor em vez de agente.

**Dente:** remover a linha de monitor do catálogo e ver o caso nomear o que sumiu (o mesmo
formato do caso que já existe para Database).

### Fase 5 — Nenhum default silencioso

**Defeito:** §1.5.

**Mudança:** os quatro viram pergunta ou pendência declarada:

| hoje | passa a ser |
|---|---|
| andar `[0]` | pergunta, quando há mais de um (já feito no V1 — falta o V2 e a tela) |
| `cron: 0 8 * * *` | pendência com a frase da pessoa: "você disse 'fim do dia em Orlando'" |
| `America/Sao_Paulo` | o fuso do ANDAR, e pendência quando a pessoa nomeou outro |
| rotina `draft` | dito na proposta: "esta rotina nasce parada; publique em Rotinas" |

**Aceita quando:** nenhum recurso aplicado tem valor inventado que a proposta não declare.

**Dente:** cada default de volta faz o caso correspondente falhar.

### Fase 6 — A repetição vira sinal

**Defeito:** o dono repetiu "web-chat" e "anexa" duas vezes cada, e "corrige a proposta"
quatro vezes. Nada percebeu.

**Mudança:** quando a mensagem da pessoa é **muito parecida com uma anterior** e o plano não
mudou entre as duas, o servidor para de redigir resposta nova e diz o que está travando:
"você pediu isto duas vezes e o plano não mudou — o que está no caminho é X".

**Aceita quando:** repetir o mesmo pedido duas vezes sem efeito produz uma resposta que
reconhece a repetição.

**Dente:** duas mensagens iguais com plano idêntico produzem a resposta de travamento.

### Fase 7 — O conhecimento tem caminho

**Defeito:** "Anexa para mim" ×2, e o passo saiu `skipped`.

**Mudança:** um requisito de conhecimento pendente vira item de checklist **com link para
onde se anexa**, e o Arquiteto passa a dizer isso em vez de "vou considerar que você vai
anexar".

**Aceita quando:** o projeto aplicado com conhecimento pendente mostra o caminho de resolver.

**Dente:** sem o link, o caso falha.

### Fase 8 — O agente nasce sabendo trabalhar

**Defeito:** objetivo = nome do trabalho; sem instrução; `tools: 0`.

**Mudança:** o agente compilado recebe instrução derivada do Brief — o que ler, de onde,
o que decidir, onde gravar, e o que fazer quando faltar dado. As ferramentas de Database
já vêm pela concessão; o que falta é o agente **saber que as tem**.

**Aceita quando:** o agente do caso do bitcoin nasce com instrução que cita a base de
origem, a de destino e a regra de dia.

**Dente:** sem a derivação, a instrução volta a ser o nome do trabalho.

---

## 4. O que fica de fora, e por quê

- **Trocar o modelo do Arquiteto.** Nenhuma das três causas de fundo é de modelo. Um modelo
  melhor escreveria frases melhores sobre um plano igualmente errado.
- **Deixar o Arquiteto escrever código/função.** Código vindo de descrição é a porta que
  este repositório fecha de propósito. O caminho é o catálogo crescer com funções de
  primeira mão — e a Fase 4 faz o Arquiteto parar de prometer o que não faz.
- **Refazer projetos antigos.** Planos compilados com o contrato velho não melhoram
  sozinhos. Conversa nova.

## 5. Ordem sugerida

**1 → 2 → 3** primeiro: são as que fazem o Arquiteto parar de mentir e a operação do bitcoin
funcionar de ponta a ponta. **4 → 5** depois: é o que faz a próxima operação nascer certa.
**6 → 7 → 8** por último: são melhorias de condução, e dependem das anteriores para valerem.
