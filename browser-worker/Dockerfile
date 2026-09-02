# O WORKER DE PÁGINAS — deployado SEPARADO da API, e com o navegador dentro.
#
# Ele existe fora do processo que tem o banco e as chaves pelo mesmo motivo do runner de
# código: buscar página de terceiro é seguir endereço que outra pessoa escolheu, e um
# Chromium executando JavaScript de terceiro não pode estar na mesma rede que o Mongo.
#
# A base é a imagem oficial do Playwright: ela já traz o Chromium e as bibliotecas de
# sistema que ele precisa. Instalar isso à mão numa imagem magra dá uma lista de pacotes
# que envelhece a cada versão do navegador — e a versão que envelhece é a que quebra em
# produção num domingo.
#
# A tag do Playwright e a versão do `package.json` andam JUNTAS. Uma imagem com o Chromium
# de uma versão e a biblioteca de outra falha ao abrir o navegador, e o erro não diz isso.
FROM mcr.microsoft.com/playwright:v1.62.1-noble

# Usuário sem privilégio. `pwuser` já existe na imagem oficial, com o cache de navegadores
# no lugar certo. Rodar como root um processo que executa JavaScript de terceiro é entregar
# a máquina junto com a página.
USER pwuser
WORKDIR /app

# Só o worker. O backend, as chaves e a conexão com o banco ficam do outro lado.
COPY --chown=pwuser:pwuser package.json ./
COPY --chown=pwuser:pwuser src ./src

ENV NODE_ENV=production
ENV PORT=4400
# Dois de cada vez: um Chromium por requisição, e a memória é o teto real aqui.
ENV BROWSER_CONCURRENCY=2
# O teto de tempo do processo inteiro, para uma página que nunca termina não segurar a vaga.
ENV BROWSER_REQUEST_TIMEOUT_MS=45000

EXPOSE 4400

# A saúde é MEDIDA: o endpoint carrega o motor e diz se ele existe de verdade. Um worker
# que responde 200 sem conseguir renderizar faria a Central configurar uma fonte que nunca
# ia funcionar — e o alarme só tocaria na primeira coleta.
#
# O `/health` exige assinatura como todo o resto, então a checagem usa o TCP: o que ela
# responde é "o processo está aceitando conexão", que é o que um healthcheck decide.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('node:net').connect(Number(process.env.PORT||4400),'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))"

# Sem shell no entrypoint: um `sh -c` seria um processo a mais com acesso ao que o Node
# não precisa.
CMD ["node", "src/server.mjs"]

# --- COMO ISTO PRECISA SER EXECUTADO -------------------------------------------------------
#
# A imagem sozinha não é o isolamento. O que fecha o cerco é o orquestrador:
#
#   docker run --rm \
#     --cap-drop=ALL --security-opt no-new-privileges \
#     --memory 1g --memory-swap 1g --cpus 1 --pids-limit 512 \
#     --tmpfs /tmp:rw,nosuid,size=256m \
#     --dns 1.1.1.1 \
#     -e BROWSER_WORKER_SECRET=<segredo compartilhado com o backend> \
#     -p 4400:4400 \
#     browser-worker
#
# MEMÓRIA: 1g é o piso para um Chromium. Abaixo disso ele morre no meio de páginas comuns e
# a coleta falha por um motivo que não é o da página. `--memory-swap` igual à memória impede
# que o container troque para disco em vez de morrer — morrer rápido é melhor diagnóstico.
#
# PIDS: o Chromium abre um processo por aba e por serviço. 512 acomoda isso e ainda barra
# uma bomba de processos vinda de uma página.
#
# `--read-only` NÃO é usado aqui: o Chromium escreve perfil e cache em disco. O que se faz
# é dar a ele um `/tmp` próprio, sem `suid`, e nada mais.
#
# REDE: diferente do runner, este worker PRECISA de saída para a internet — é o trabalho
# dele. O que não pode existir é caminho para a rede interna. Numa rede de verdade:
#
#   - o worker fica numa rede própria, que alcança a internet e NÃO alcança Mongo, Redis,
#     backend nem qualquer serviço interno;
#   - o backend alcança o worker, e não o contrário;
#   - egress para faixas privadas (10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10) é
#     negado no firewall.
#
# O guarda de destino do próprio worker já recusa essas faixas, e a renderização busca cada
# requisição no endereço conferido em vez de deixar o navegador resolver de novo. A regra
# de firewall é a segunda tranca: ela não depende de nenhum código estar correto.
