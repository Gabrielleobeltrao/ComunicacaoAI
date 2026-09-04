# ADR 004 — Exclusão e arquivamento de andar

## Contexto

`deleteFloor` conta agentes e setores, recusa se houver algum, e apaga se não houver. Um
andar com fonte de monitoramento, monitor e Flow é considerado **vazio** — é apagado, e os
três ficam órfãos apontando para um andar que não existe mais.

## Decisão

Três operações separadas, com o impacto no meio:

- `GET /api/floors/:id/deletion-impact` — análise owner-scoped, com contagens, nomes e a
  ação prevista para cada categoria;
- `POST /api/floors/:id/archive` — o padrão. Desativa a entrada e preserva os dados;
- `POST /api/floors/:id/restore` — volta, sem reativar operações sozinha;
- `POST /api/floors/:id/purge` — exige `impactHash`, `confirmationName` e `choices`;
- `DELETE` legado: continua valendo para andar vazio, e passa a responder
  `409 impact_required` em vez de cascatear escondido.

Regra de propriedade:

- exclusivo do andar → arquivar; purge só por escolha e sem dependente externo;
- **compartilhado → preservar e remover apenas o vínculo daquele andar**;
- App instalado na empresa → instalação preservada, grants dos agentes removidos revogados;
- conexão dedicada → oferecer remoção só se nada mais a usa;
- histórico e auditoria → preservados pela retenção.

Nunca inferir que uma conexão pertence ao andar só porque os agentes dele a usam.

O `impactHash` é calculado sobre ids, `updatedAt`/versões e as escolhas. Se algo mudar entre
a análise e a confirmação, a resposta é conflito — não um purge sobre um retrato velho.

## Consequências

"Tem certeza?" deixa de existir. O diálogo passa a dizer, antes do clique, o que será
arquivado, excluído, desvinculado, mantido e o que bloqueia — e o purge exige digitar o
nome do andar.

Uma falha no meio do purge é retomável: a operação registra o que já removeu, e a retomada
continua do mesmo ponto em vez de recomeçar sobre um estado parcial.
