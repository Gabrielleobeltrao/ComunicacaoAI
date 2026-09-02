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

## O que ele NÃO faz

`GET /health` responde `capabilities: { fetch: true, render: false, screenshot: false,
vision: false }`. **Não há motor de renderização aqui.** Ele busca e devolve o conteúdo; uma
fonte que dependa de JavaScript executado sabe que não foi atendida, em vez de receber HTML
cru como se fosse página renderizada.

Ligar um motor de verdade (um navegador headless) é trocar a implementação de `fetchPage` e
passar `render: true` — o contrato, a autenticação, o guarda e os limites já estão de pé.

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
