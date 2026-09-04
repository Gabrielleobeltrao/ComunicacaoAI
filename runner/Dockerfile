# O RUNNER — deployado SEPARADO do backend, e sem nada que ele não precise.
#
# A imagem não tem gerenciador de pacote, shell de conveniência nem código da aplicação:
# ela tem o Node e três arquivos. O que impede o código de terceiro de fazer estrago não é
# o que está escrito aqui dentro, é o que falta.
FROM node:22-alpine

# Usuário sem privilégio. `node` já existe na imagem oficial com uid 1000.
USER node
WORKDIR /app

# Só o runner. O backend, as chaves e a conexão com o banco ficam do outro lado.
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src

ENV NODE_ENV=production
ENV PORT=4300
# As marcas que o deploy afirma e o health repete. Elas NÃO ligam nada sozinhas — o
# processo mede o que dá para medir, e estas cobrem o que só o orquestrador sabe.
ENV SANDBOX_EPHEMERAL=1
ENV SANDBOX_NO_NEW_PRIVILEGES=1
ENV SANDBOX_SECCOMP=1
# Uma execução por vez: previsível, e sem duas execuções disputando o mesmo teto.
ENV SANDBOX_CONCURRENCY=1

EXPOSE 4300

# Sem shell no entrypoint: um `sh -c` seria um processo a mais com acesso ao que o Node
# não precisa.
CMD ["node", "src/server.mjs"]

# --- COMO ISTO PRECISA SER EXECUTADO -------------------------------------------------------
#
# A imagem sozinha não é o isolamento. O que fecha o cerco é o orquestrador:
#
#   docker run --rm \
#     --read-only --tmpfs /tmp:rw,noexec,nosuid,size=32m \
#     --cap-drop=ALL --security-opt no-new-privileges \
#     --network none \
#     --memory 256m --cpus 0.5 --pids-limit 64 \
#     -e SANDBOX_RUNNER_SECRET=<segredo compartilhado com o backend> \
#     sandbox-runner
#
# `--network none` deixa o runner inalcançável pelo backend. Numa rede de verdade, use uma
# rede interna que ligue APENAS backend↔runner e negue egress — o probe de rede do
# `profile.mjs` vai medir isso e o health vai dizer a verdade.
