# ADR 002 — Blueprint V2 versionado, ao lado do V1

## Contexto

`OfficeBlueprintV1` descreve prédio, andares, agentes, setores, rotinas e requisitos de App
e Knowledge. O produto, hoje, tem muito mais: Databases e datasets, Tools, Sources,
destinos Live e History, Monitors, Flows, canais, entregas e grants por recurso.

Estender o V1 no lugar mudaria o significado de documentos já aplicados: um projeto de
janeiro passaria a ser lido com regras de hoje, e ninguém saberia disso.

## Decisão

`OfficeBlueprintV2` com `version: 2`, em três blocos — `organization`, `resources`,
`operations` — mais `access` e `acceptanceTests`.

- o V1 continua existindo, é lido e permanece editável e explicável;
- um conversor V1 → V2 preserva `key` e `resourceMap` e **marca** o que não dá para inferir,
  em vez de inventar;
- projeto aplicado não é convertido automaticamente: a conversão carimba versão e guarda o
  original;
- toda referência interna usa `key`. `resourceId` só é anexado pelo inventário do servidor
  ou por escolha owner-scoped na UI;
- segredo nunca entra no Blueprint, em campo nenhum.

## Consequências

Dois formatos vivos ao mesmo tempo, com o custo de leitura dupla em validação, diff, hash e
prévia. É o preço de não reinterpretar o passado.

Um item novo do V2 (`action: 'archive'`) não existe no V1: a conversão nunca produz
`archive`, e o V1 nunca precisa entendê-lo.
