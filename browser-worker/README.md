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
| **DNS rebinding** | o guarda devolve o ENDEREÇO conferido, e a conexão usa ele — não pergunta ao DNS de novo |
| Nome com resposta mista | se **qualquer** endereço resolvido for privado, o alvo inteiro é recusado |
| IPv4 mapeado em IPv6 | `::ffff:169.254.169.254` é reconhecido como metadata |
| Download | `Content-Disposition: attachment` e tipos binários são recusados |
| Exaustão | teto por resposta, orçamento total, limite de subrequisições e de redirects |
| Abuso contínuo | `BROWSER_KILL_SWITCH=1` recusa tudo sem derrubar o processo |

Uma subrequisição bloqueada **não derruba a página**: ela é reportada, e a leitura segue com
o que veio. Derrubar tudo faria um `<img>` para a rede interna esconder o conteúdo legítimo
— e a informação de que alguém tentou.

## Renderização

`POST /fetch` com `render: true` sobe um Chromium **de verdade** (Playwright) e devolve o
HTML depois do JavaScript.

E aqui está o ponto que faz a diferença: **toda requisição que a página faz é interceptada
e conferida pelo mesmo guarda** — a navegação, os redirects, os scripts, as imagens e cada
`fetch` que o JavaScript inventar em tempo de execução. O descuido clássico é validar a URL
digitada e deixar o navegador buscar o resto: aí é a página que decide para onde o worker
faz requisição, e um `fetch('http://169.254.169.254/…')` dentro dela sai pela rede do worker.

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
| `BROWSER_ALLOW_LOOPBACK` | — | **Só para teste.** Libera `127.0.0.1` e **nada mais**: metadata e rede privada continuam recusadas |

## Deploy

```bash
docker run -d --name browser-worker \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,size=32m \
  --cap-drop=ALL --security-opt no-new-privileges \
  --network egress-publico \
  --memory 256m --cpus 0.5 --pids-limit 64 \
  -e BROWSER_WORKER_SECRET=<segredo compartilhado> \
  browser-worker
```

`egress-publico` precisa permitir a internet e **negar** a rede interna. O guarda do
processo é a segunda tranca, não a única: as duas juntas é que fecham o cerco.

## Rodar

```bash
BROWSER_WORKER_SECRET=$(openssl rand -hex 32) npm start --prefix browser-worker
npm run test:browser-worker
```
