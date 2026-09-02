# Browser Worker

O lugar onde a plataforma busca páginas de terceiros — **fora** do processo que tem o banco,
as chaves e a rede interna.

## Por que separado

Buscar uma página é seguir um endereço que **outra pessoa escolheu**. Fazer isso de dentro
da API significa que quem escolhe o endereço está, na prática, pedindo requisições a partir
da rede interna — e é assim que a página de metadados da nuvem sai pela porta da frente.

## O que ele recusa

| Ameaça | O que impede |
| --- | --- |
| SSRF direto | faixas privadas, loopback, link-local, CGNAT, multicast e metadata |
| SSRF por **redirect** | cada salto é revalidado; validar só a URL digitada é o erro clássico |
| SSRF por **subrequisição** | cada ativo pedido pela página é conferido como se fosse o primeiro |
| **DNS rebinding** | o guarda devolve o ENDEREÇO conferido, e **toda** conexão usa ele — inclusive as do navegador |
| Nome com resposta mista | se **qualquer** endereço resolvido for privado, o alvo inteiro é recusado |
| IPv4 mapeado em IPv6 | `::ffff:169.254.169.254` é reconhecido como metadata |
| Download | `Content-Disposition: attachment` e tipos binários são recusados |
| Exaustão | teto por resposta, orçamento total, limite de subrequisições, de redirects e teto de tempo do pedido |
| Método fora de leitura | um `POST` partindo de dentro da página é abortado: coleta é leitura |
| Abuso contínuo | `BROWSER_KILL_SWITCH=1` recusa tudo sem derrubar o processo |

Uma subrequisição bloqueada **não derruba a página**: ela é reportada, e a leitura segue com
o que veio. Derrubar tudo faria um `<img>` para a rede interna esconder o conteúdo legítimo
— e a informação de que alguém tentou.

## Renderização

`POST /fetch` com `render: true` sobe um Chromium **de verdade** (Playwright) e devolve o
HTML depois do JavaScript.

E aqui está o ponto que faz a diferença: **toda requisição que a página faz é interceptada,
conferida e BUSCADA por este worker** — a navegação, os redirects, os scripts, as imagens e
cada `fetch` que o JavaScript inventar em tempo de execução. O descuido clássico é validar a
URL digitada e deixar o navegador buscar o resto: aí é a página que decide para onde o worker
faz requisição, e um `fetch('http://169.254.169.254/…')` dentro dela sai pela rede do worker.

**Conferir não basta.** A versão anterior validava e depois chamava `continue()`: o Chromium
ia à rede sozinho e resolvia o nome de novo. Um nome que responde um endereço público na
conferência e um privado meio segundo depois — DNS rebinding — passava inteiro, porque quem
conectou nunca viu o endereço aprovado. Agora nenhuma requisição do navegador chega à rede:
cada uma abre socket no endereço conferido, com o `Host` original, e a resposta é devolvida
ao navegador já pronta. Como segunda tranca, o Chromium sobe com
`--host-resolver-rules=MAP * ~NOTFOUND` e `serviceWorkers: 'block'` — o que escapar da
interceptação não resolve nome nenhum.

Uma subrequisição bloqueada **não derruba a página**: ela é abortada e reportada em
`blocked`. Derrubar tudo esconderia o conteúdo legítimo e a informação de que alguém tentou.

O sandbox do próprio Chromium fica **ligado** — `--no-sandbox` é o que transforma uma página
hostil em código rodando com o usuário do worker. Downloads são recusados, não há sessão nem
credencial, e o navegador **sempre** fecha no `finally`: um Chromium esquecido por execução
consome a máquina em minutos.

`GET /health` **mede** a capacidade em vez de declarar: `render` só é `true` se o motor
carregar. Screenshot e visão continuam `false` — dizer que faz sem fazer é o que leva alguém
a configurar uma fonte que nunca vai funcionar.

A Central só paga esse degrau quando os baratos não deram: ela busca simples, mapeia, e
**se o mapeamento não produziu valor** é que renderiza. A pergunta é "o que saiu daqui
serve?", e não "o seletor achou algo" — uma página que mostra "carregando" até o JavaScript
rodar responde sim à segunda e não à primeira.

## Autenticação

Serviço, nunca navegador: HMAC-SHA256 sobre `timestamp.nonce.body`, janela de 60 s e nonce
de uso único. Sem `BROWSER_WORKER_SECRET` o worker responde 503 a todo mundo.

## Variáveis

| Variável | Padrão | O que faz |
| --- | --- | --- |
| `BROWSER_WORKER_SECRET` | — | **Obrigatória.** Sem ela nada é atendido |
| `PORT` | `4400` | Porta HTTP |
| `BROWSER_CONCURRENCY` | `2` | Buscas simultâneas; acima disso responde 429 |
| `BROWSER_KILL_SWITCH` | — | `1` recusa tudo, com o processo de pé |
| `BROWSER_REQUEST_TIMEOUT_MS` | `45000` | Teto do pedido inteiro. Os limites de etapa somados ainda deixariam uma página patológica segurar a vaga |
| `BROWSER_ALLOW_LOOPBACK` | — | **Só para teste.** Libera `127.0.0.1` e **nada mais**: metadata e rede privada continuam recusadas |

## Deploy

A imagem é a oficial do Playwright, que já traz o Chromium e as bibliotecas de sistema que
ele precisa. Instalar isso à mão numa imagem magra dá uma lista de pacotes que envelhece a
cada versão do navegador — e a versão que envelhece é a que quebra num domingo. **A tag da
imagem e a versão em `package.json` andam juntas**: Chromium de uma versão com biblioteca de
outra falha ao abrir o navegador, e o erro não diz isso.

```bash
docker build -t browser-worker browser-worker

docker run -d --name browser-worker \
  --cap-drop=ALL --security-opt no-new-privileges \
  --memory 1g --memory-swap 1g --cpus 1 --pids-limit 512 \
  --tmpfs /tmp:rw,nosuid,size=256m \
  --network egress-publico \
  -p 4400:4400 \
  -e BROWSER_WORKER_SECRET=<segredo compartilhado> \
  browser-worker
```

**Usuário:** `pwuser`, sem privilégio. Rodar como root um processo que executa JavaScript de
terceiro é entregar a máquina junto com a página.

**Memória:** 1g é o piso para um Chromium — abaixo disso ele morre no meio de páginas comuns
e a coleta falha por um motivo que não é o da página. `--memory-swap` igual à memória impede
trocar para disco em vez de morrer; morrer rápido é melhor diagnóstico.

**PIDs:** o Chromium abre um processo por aba e por serviço. 512 acomoda isso e ainda barra
uma bomba de processos vinda de uma página.

**`--read-only` não é usado:** o Chromium escreve perfil e cache em disco. O que se faz é dar
a ele um `/tmp` próprio, sem `suid`, e nada mais.

**Rede:** diferente do runner, este worker **precisa** de saída para a internet — é o
trabalho dele. O que não pode existir é caminho para a rede interna. `egress-publico` alcança
a internet e **não** alcança Mongo, Redis, backend nem qualquer serviço interno; o backend
alcança o worker, e não o contrário; egress para `10/8`, `172.16/12`, `192.168/16`,
`169.254/16` e `100.64/10` é negado no firewall. O guarda do processo é a segunda tranca, não
a única: a regra de firewall não depende de nenhum código estar correto.

**Healthcheck:** o `HEALTHCHECK` da imagem abre TCP na porta — `/health` exige assinatura,
como todo o resto, e um healthcheck não tem segredo. O que ele decide é "o processo está
aceitando conexão". A capacidade de renderizar quem mede é `/health`, chamado pelo backend.

## Rodar

```bash
BROWSER_WORKER_SECRET=$(openssl rand -hex 32) npm start --prefix browser-worker
npm run test:browser-worker
```
