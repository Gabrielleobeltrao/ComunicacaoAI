# Landing page e documentação do sistema — plano

Objetivo: uma página que faz alguém entender e querer, e uma documentação que explica
como o sistema funciona de verdade — com exemplos e as partes técnicas por inteiro.

## O que já existe, e por que isso muda o plano

Três levantamentos feitos antes de planejar, porque cada um elimina uma alternativa:

| achado | consequência |
|---|---|
| **`/` já é uma landing page** (`frontend/src/pages/Home.tsx`, 170 linhas: herói, três valores, demonstração de agentes) | Não é partir do zero. É reestruturar conteúdo e resolver o que falta em volta dela. |
| **Zero SEO.** `index.html` tem duas `<meta>` — charset e viewport. Sem `description`, sem Open Graph, sem canonical, sem `robots.txt`, sem sitemap. E o app é SPA: o HTML servido é uma `<div>` vazia | Uma landing que ninguém acha e que, colada no WhatsApp ou no LinkedIn, aparece como URL pelada. Prévia de link **não executa JavaScript** — ela lê o HTML cru. Isto é infraestrutura, não conteúdo, e vem primeiro. |
| **9.039 linhas de markdown técnico** já escritas em 15 arquivos na raiz (README com 12 seções, planos, relatórios, runbook e modelo de ameaças do sandbox) | A documentação não é redação nova. É curadoria, navegação e — o problema de verdade — impedir que ela minta com o tempo. |

E uma restrição do próprio projeto: **nenhuma dependência nova** se o que já está
instalado resolve. O Playwright já é dependência de desenvolvimento do frontend, e o
`scripts/mvp-smoke.mjs` já sobe o frontend compilado — os dois juntos pré-renderizam as
páginas públicas sem trazer SSR nem gerador de site estático para dentro do projeto.

## O risco que domina tudo

Documentação apodrece. Ela diz `POST /api/monitors`, alguém renomeia a rota, e a página
continua afirmando o que já não é verdade — com a agravante de que ninguém percebe,
porque documentação não quebra build.

A disciplina deste repositório é outra: o que importa tem um caso que morde. Então a
documentação entra com as mesmas travas que o código:

1. **Toda rota citada existe.** Um teste varre os documentos publicados atrás de
   `GET|POST|PUT|DELETE /api/...` e confere cada uma contra os roteadores de verdade.
2. **Todo link interno resolve.** Âncora quebrada é erro de teste, não de leitura.
3. **Todo exemplo de requisição roda.** Os exemplos ficam num arquivo que a bateria de
   integração executa contra a API real; o que aparece na página é a resposta gravada
   dessa execução, e não um JSON escrito à mão.
4. **As páginas públicas são pré-renderizadas**, então o que o buscador lê é o que a
   pessoa lê.

Sem isso, o item 4 só faz o buscador indexar mais rápido uma informação errada.

---

## Fase 1 — A casca pública (infraestrutura)

Sem isto, todo o resto é invisível.

**1.1 Metadados por rota.** Um mapa `rota → { título, descrição, og:image }` e um
componente que os aplica. Sem `react-helmet`: são quatro linhas de `document.title` e
`meta[name=description]` num `useEffect`, e o pré-render (1.2) é quem os congela no HTML.

**1.2 Pré-renderização das rotas públicas.** Um script de build (`scripts/prerender.mjs`)
que sobe o `dist` num servidor estático, abre cada rota pública no Chromium do Playwright,
espera a rede acalmar e grava o HTML resultante em `dist/<rota>/index.html`. O nginx já
faz `try_files $uri $uri/ /index.html` — ele serve o arquivo pré-renderizado quando
existe e cai no SPA quando não existe. **Nenhuma dependência nova, nenhuma mudança de
servidor.**

Rotas na lista: `/`, `/login`, `/register`, `/docs` e cada página de documentação.

**1.3 `robots.txt` e `sitemap.xml`,** gerados pelo mesmo script a partir da mesma lista —
uma lista só, para não existirem duas verdades sobre o que é público.

**1.4 Casca de navegação pública.** Cabeçalho e rodapé compartilhados entre landing e
documentação, com Entrar/Criar conta. Hoje a Home tem cabeçalho próprio; a documentação
precisaria de outro, e dois cabeçalhos divergem no primeiro ajuste.

**Guardas da fase:** o HTML servido em `/` contém o título e a descrição **sem executar
JavaScript** (busca no texto cru da resposta); toda rota da lista tem `<title>` e
`description` próprios; o `sitemap.xml` lista exatamente a lista de rotas públicas.

---

## Fase 2 — A landing page

Reestruturação de conteúdo sobre a casca da Fase 1.

**2.1 A pergunta que ela responde.** Hoje o herói fala de "agentes como colegas". A
estrutura proposta, na ordem em que se lê:

1. **O que é**, em uma frase e uma imagem — o mapa do escritório em movimento é o ativo
   mais forte que o produto tem, e ele já existe.
2. **O problema**, dito como a pessoa o vive: automação que quebra calada, e ninguém
   descobre até o cliente reclamar.
3. **Como funciona**, em três passos com captura real de tela: montar a operação pelo
   Arquiteto → conectar o que ela usa → ver rodando na Atividade.
4. **As quatro coisas que o produto tem e o concorrente não:** conhecimento com dono e
   validade, monitores que não gastam token enquanto nada muda, custo por tarefa, e
   toda ação com prévia, confirmação e trilha de auditoria.
5. **Prova**: números do próprio sistema quando houver; até lá, um exemplo trabalhado
   ponta a ponta (o RSI do CXSE3 já existe e é bom).
6. **Chamada** para criar conta, e um caminho para a documentação — quem é técnico
   decide lendo, não pelo herói.

**2.2 Peso e desempenho.** A landing não pode arrastar o pacote inteiro do app: rota
pública já é carregada sob demanda, mas o teste de peso existente (`< 900 KB` em
`/login`) passa a valer também para `/`.

**Guardas:** a landing carrega abaixo do teto de peso; os três atalhos principais levam
onde dizem; em 320 px nada estoura; o contraste do texto sobre o herói passa no mínimo
de acessibilidade.

---

## Fase 3 — A documentação: o esqueleto

**3.1 Rota e forma.** `/docs` e `/docs/:secao/:pagina`, dentro do próprio app — reusa o
sistema de design, o renderizador de markdown que já existe (`MessageContent`) e um
deploy só. Um gerador de site estático seria uma segunda cadeia de build para manter.

**3.2 Onde o conteúdo mora.** `frontend/src/docs/conteudo/**.md`, importados como texto
pelo Vite. Ficam versionados junto do código que descrevem — a distância entre o texto e
o código é proporcional à velocidade com que eles divergem.

**3.3 Navegação.** Índice lateral gerado do mapa de seções, âncoras por título, "nesta
página" à direita, anterior/próximo no rodapé.

**3.4 Busca.** Índice client-side construído no build a partir dos títulos e do primeiro
parágrafo de cada seção. Sem serviço externo, sem chave.

**Guardas:** cada página do índice existe e abre; toda âncora interna resolve; a busca
encontra uma página por um termo que só aparece no corpo dela.

---

## Fase 4 — A documentação: o conteúdo

Curadoria das 9.039 linhas, decidindo o que é público. Os relatórios de progresso e o
modelo de ameaças do sandbox **não** são: eles descrevem decisões internas e superfície
de ataque.

Seis seções, do concreto ao profundo:

| seção | o que entrega |
|---|---|
| **Começar** | do zero a um agente respondendo, em uma página. Cada passo com a tela real. |
| **Conceitos** | prédio, andar, setor, agente, e os três mecanismos que o sistema separa de propósito: Conhecimento ("o que a empresa diz"), Memória ("o que eu lembro") e Database ("o que aconteceu"). Confundir os três é o erro mais caro que alguém comete aqui. |
| **Guias** | montar uma operação pelo Arquiteto; conectar um App; vigiar um indicador de mercado ponta a ponta; publicar no catálogo. Cada um com o exemplo executável. |
| **Referência técnica** | a API por recurso, com requisição e resposta reais; o modelo de dados; a cadeia de permissão (direto → setor → andar → prédio) e por que ela **delega** em vez de generalizar; o motor de automações; monitores e o custo zero enquanto nada muda; o sandbox e o que ele recusa. |
| **Operação** | implantação, variáveis de ambiente, prontidão, encerramento com drenagem, e o que fazer quando cada um falha. Já existe, e está bom, em `COOLIFY_DEPLOYMENT.md` e no `SANDBOX_RUNBOOK.md`. |
| **Decisões** | por que o modelo classifica e o código decide; por que nenhum id vem do modelo; por que monitor não gasta token parado. É a seção que faz um avaliador técnico confiar — e a que o repositório já tem escrita nos comentários. |

**Guardas:** as travas 1 a 3 do topo deste plano entram aqui, e são o que separa esta
documentação de um texto bonito que envelhece.

---

## Fase 5 — Fechamento

Bateria completa (unidade, E2E, integração, build, lint), medição do peso das páginas
públicas, e conferência de que o HTML pré-renderizado bate com o que a página mostra
depois de hidratar — uma prévia que promete uma coisa e entrega outra é pior que nenhuma.

---

## Decisões que ficam registradas

- **Idioma: português.** O produto, a interface e o repositório inteiro estão em
  português. Documentação em inglês seria uma segunda verdade para manter, e o público
  de hoje não a pede. Quando pedir, a estrutura de seções já comporta.
- **Dentro do app, e não num site à parte.** Um deploy, um sistema de design, um
  histórico. O custo é ter de pré-renderizar; ele está pago na Fase 1.
- **Sem CMS.** O conteúdo é markdown versionado ao lado do código. Um CMS separaria o
  texto do que ele descreve, que é exatamente como a documentação começa a mentir.
- **Domínios `onplataform.com` mantidos**, conforme a restrição do projeto.

## O que eu não sei, e você decide

1. **Nome público.** O título do navegador diz "Tavorium"; o repositório e as URLs dizem
   ComunicacaoAI. A landing precisa de um só.
2. **Preço.** Se houver planos, eles entram na landing e mudam a estrutura da seção 5.
3. **Quem lê a documentação:** o cliente que vai operar, ou o técnico que vai avaliar? A
   Fase 4 atende os dois, mas a ordem das seções muda conforme quem for o primeiro.

## Ordem de execução sugerida

Fase 1 primeiro e sozinha — ela é a que destrava valor imediato: a landing que já existe
passa a ser encontrável e compartilhável no mesmo dia. Depois 3 (esqueleto) antes de 2
(conteúdo da landing), porque a landing vai querer apontar para a documentação, e apontar
para o que ainda não existe é a promessa que este projeto evita em todo lugar.
