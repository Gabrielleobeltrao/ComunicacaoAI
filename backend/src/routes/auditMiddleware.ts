import { randomUUID } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { recordAudit } from '../audit.js'
import type { AuditAction, AuditEntityType } from '../audit.js'
import { entityLabelWithOwner } from '../auditLabels.js'

// ONE place instruments changes: this middleware. Every mutating API request passes
// through it, so nothing is recorded twice and no handler has to remember.
//
// What it reads is the REQUEST LINE and the RESPONSE STATUS. Never the body: a body
// is where prompts, payloads, credentials and content live.
//
// The mapping below is EXPLICIT, one rule per route. It used to be inferred from the
// path shape, and inference got things wrong in ways that matter: a playground call
// was recorded as "created an agent", validating a definition as "created an
// automation", a visitor's message as a change to the channel. A route that is not
// in this table is simply not audited — adding one is a decision, and the test suite
// asserts that every mutating route the app exposes has a rule here.

// `null` target = a real route that is deliberately NOT a change to the account.
interface Rule {
  methods: string[]
  // Path segments; ':' matches any single segment.
  pattern: string[]
  target: { entityType: AuditEntityType; action: AuditAction } | null
  // Where the entity's id sits in the pattern (index), when it has one.
  idAt?: number
  why?: string
}

const R = (methods: string, pattern: string, target: Rule['target'], extra: Partial<Rule> = {}): Rule => ({
  methods: methods.split('|'),
  pattern: pattern.split('/').filter(Boolean),
  target,
  ...extra,
})

// Ordered: the FIRST match wins, so a specific rule is written above the generic one.
const RULES: Rule[] = [
  // --- not a change to the account ------------------------------------------------
  // Testing an agent or a sector is an execution, not a mutation. It used to be
  // recorded as "created an agent", which is exactly backwards.
  R('POST', 'api/agents/:/playground', null, { why: 'test execution, no mutation' }),
  R('POST', 'api/sectors/:/playground', null, { why: 'test execution, no mutation' }),
  // Apagar a conversa de teste é apagar a TELA do dono, não configuração nem dado de
  // ninguém: não há o que auditar, e registrar isso só encheria o log.
  R('DELETE', 'api/agents/:/playground', null, { why: 'clears the owner test chat only' }),
  R('DELETE', 'api/sectors/:/playground', null, { why: 'clears the owner test chat only' }),
  // Validating a draft only reads it.
  R('POST', 'api/automations/:/validate', null, { why: 'read-only check' }),
  // Runs belong to the EXECUTION history (automation_runs), which is its own
  // timeline — recording them again as "changes" would double-count them.
  R('POST', 'api/automations/:/runs', null, { why: 'execution, tracked in automation_runs' }),
  R('POST', 'api/runs/:/cancel', null, { why: 'execution state, tracked in automation_runs' }),
  // Conversation traffic: a message or a handoff is not a configuration change, and
  // the public one is a visitor's.
  R('POST', 'api/widgets/:/conversations/:/messages', null, { why: 'conversation traffic' }),
  R('POST', 'api/widgets/:/conversations/:/handoff', null, { why: 'conversation traffic' }),
  R('POST', 'api/public/widgets/:/messages', null, { why: 'public visitor traffic' }),
  // A provider's inbound webhook: third-party payload, and an execution.
  R('POST', 'api/whatsapp/:/webhook/:', null, { why: 'inbound provider event' }),

  // --- agents -----------------------------------------------------------------------
  R('POST', 'api/agents', { entityType: 'agent', action: 'create' }),
  R('PATCH', 'api/agents/:', { entityType: 'agent', action: 'update' }, { idAt: 2 }),
  R('DELETE', 'api/agents/:', { entityType: 'agent', action: 'delete' }, { idAt: 2 }),
  // Moving an agent between sectors is a move, not a plain edit.
  R('PUT', 'api/agents/:/sector', { entityType: 'agent', action: 'move' }, { idAt: 2 }),

  // --- routines + event triggers (agent-owned) --------------------------------------
  R('POST', 'api/agents/:/routines', { entityType: 'routine', action: 'create' }),
  R('PATCH', 'api/agents/:/routines/:', { entityType: 'routine', action: 'update' }, { idAt: 4 }),
  R('POST', 'api/agents/:/routines/:/activate', { entityType: 'routine', action: 'activate' }, { idAt: 4 }),
  R('POST', 'api/agents/:/routines/:/pause', { entityType: 'routine', action: 'pause' }, { idAt: 4 }),
  R('POST', 'api/agents/:/routines/:/archive', { entityType: 'routine', action: 'archive' }, { idAt: 4 }),
  // Testar a fonte não muda nada: consulta uma URL e mostra o resultado. Não gasta
  // token, não toca no checkpoint e não cria execução — não há o que registrar no
  // histórico da conta.
  R('POST', 'api/agents/:/routines/test-source', null, { why: 'consulta de teste, não altera nada' }),
  // Os sites que o agente consulta sob demanda são configuração DELE: mudá-los muda o
  // que ele alcança, e isso é do mesmo tamanho de trocar uma ferramenta.
  R('PUT', 'api/agents/:/sources', { entityType: 'agent', action: 'update' }, { idAt: 2 }),
  // Ler um site que o dono já cadastrou não muda configuração nem dado de ninguém: o que
  // ela produz (documento na base) já é auditado por quem grava.
  R('POST', 'api/agents/:/sources/refresh', null, { why: 'reads the sites already configured' }),
  // Testar leitura não grava nada: é a mesma leitura, sem ingestão.
  R('POST', 'api/agents/:/sources/test-read', null, { why: 'reads a URL to show what it returns' }),
  // "Verificar agora" CRIA uma execução fora do horário — isso é uma ação do dono
  // sobre a rotina, e o histórico precisa dizer quem pediu.
  R('POST', 'api/agents/:/routines/:/check-now', { entityType: 'routine', action: 'run' }, { idAt: 4 }),
  R('POST', 'api/agents/:/event-triggers', { entityType: 'event_trigger', action: 'create' }),
  R('PATCH', 'api/agents/:/event-triggers/:', { entityType: 'event_trigger', action: 'update' }, { idAt: 4 }),
  R('POST', 'api/agents/:/event-triggers/:/rotate', { entityType: 'event_trigger', action: 'rotate' }, { idAt: 4 }),
  R('POST', 'api/agents/:/event-triggers/:/activate', { entityType: 'event_trigger', action: 'activate' }, { idAt: 4 }),
  R('POST', 'api/agents/:/event-triggers/:/pause', { entityType: 'event_trigger', action: 'pause' }, { idAt: 4 }),
  R('POST', 'api/agents/:/event-triggers/:/archive', { entityType: 'event_trigger', action: 'archive' }, { idAt: 4 }),

  // Quem lê o quê é uma mudança de permissão, e entra no registro como tal.
  R('PUT', 'api/agents/:/knowledge-access', { entityType: 'agent', action: 'update' }, { idAt: 2 }),

  // --- agent knowledge ---------------------------------------------------------------
  R('POST', 'api/agents/:/documents/upload', { entityType: 'knowledge', action: 'create' }),
  R('POST', 'api/agents/:/documents', { entityType: 'knowledge', action: 'create' }),
  R('PATCH', 'api/agents/:/documents/:', { entityType: 'knowledge', action: 'update' }, { idAt: 4 }),
  R('DELETE', 'api/agents/:/documents/:', { entityType: 'knowledge', action: 'delete' }, { idAt: 4 }),

  // --- sectors -------------------------------------------------------------------------
  R('POST', 'api/sectors', { entityType: 'sector', action: 'create' }),
  R('PATCH', 'api/sectors/:', { entityType: 'sector', action: 'update' }, { idAt: 2 }),
  R('DELETE', 'api/sectors/:', { entityType: 'sector', action: 'delete' }, { idAt: 2 }),
  // Apagar memória é irreversível e não tem lixeira: quem apagou, e o quê, precisa
  // ficar registrado.
  R('DELETE', 'api/memories/:', { entityType: 'memory', action: 'delete' }, { idAt: 2 }),
  R('POST', 'api/memories/clear', { entityType: 'memory', action: 'delete' }),
  R('PUT', 'api/sectors/:/members', { entityType: 'sector', action: 'update' }, { idAt: 2 }),
  R('POST', 'api/sectors/:/move', { entityType: 'sector', action: 'move' }, { idAt: 2 }),
  R('POST', 'api/sectors/:/documents/:/reindex', { entityType: 'knowledge', action: 'update' }, { idAt: 4 }),
  R('POST', 'api/agents/:/documents/:/reindex', { entityType: 'knowledge', action: 'update' }, { idAt: 4 }),
  R('POST', 'api/sectors/:/documents', { entityType: 'knowledge', action: 'create' }),
  R('PATCH', 'api/sectors/:/documents/:', { entityType: 'knowledge', action: 'update' }, { idAt: 4 }),
  R('DELETE', 'api/sectors/:/documents/:', { entityType: 'knowledge', action: 'delete' }, { idAt: 4 }),

  // --- floors + building -----------------------------------------------------------------
  R('POST', 'api/floors', { entityType: 'floor', action: 'create' }),
  R('PATCH', 'api/floors/:', { entityType: 'floor', action: 'update' }, { idAt: 2 }),
  R('DELETE', 'api/floors/:', { entityType: 'floor', action: 'delete' }, { idAt: 2 }),
  R('POST', 'api/floors/:/archive', { entityType: 'floor', action: 'archive' }, { idAt: 2 }),
  // Restoring is its own verb: it used to fall through to "created a floor".
  R('POST', 'api/floors/:/restore', { entityType: 'floor', action: 'restore' }, { idAt: 2 }),
  // O purge é a exclusão IRREVERSÍVEL, com tudo que morava no andar. É a mutação que mais
  // precisa de registro: sem ela, "cadê o meu setor?" não tem resposta em lugar nenhum.
  R('POST', 'api/floors/:/purge', { entityType: 'floor', action: 'delete' }, { idAt: 2 }),
  R('PATCH', 'api/building', { entityType: 'building', action: 'update' }),
  // Who may talk to whom across floors is a security decision of the building.
  R('PATCH', 'api/building/floor-communication', { entityType: 'building', action: 'update' }),
  R('POST', 'api/building/floor-communication/impact', null, { why: 'simulação do rascunho, não persiste nada' }),

  // --- tools ---------------------------------------------------------------------------
  R('POST', 'api/tools', { entityType: 'tool', action: 'create' }),
  R('PATCH', 'api/tools/:', { entityType: 'tool', action: 'update' }, { idAt: 2 }),
  R('DELETE', 'api/tools/:', { entityType: 'tool', action: 'delete' }, { idAt: 2 }),
  // A manual test really calls the far side, so it IS worth a record — as a test.
  R('POST', 'api/tools/:/test', { entityType: 'tool', action: 'test' }, { idAt: 2 }),

  // --- channels + connections -------------------------------------------------------------
  R('POST', 'api/widgets', { entityType: 'channel', action: 'create' }),
  R('PATCH', 'api/widgets/:', { entityType: 'channel', action: 'update' }, { idAt: 2 }),
  R('DELETE', 'api/widgets/:', { entityType: 'channel', action: 'delete' }, { idAt: 2 }),
  R('POST', 'api/widgets/:/avatar', { entityType: 'channel', action: 'update' }, { idAt: 2 }),
  R('DELETE', 'api/widgets/:/avatar', { entityType: 'channel', action: 'update' }, { idAt: 2 }),
  R('POST', 'api/whatsapp/channels', { entityType: 'channel', action: 'create' }),
  R('PATCH', 'api/whatsapp/channels/:', { entityType: 'channel', action: 'update' }, { idAt: 3 }),
  R('DELETE', 'api/whatsapp/channels/:', { entityType: 'channel', action: 'delete' }, { idAt: 3 }),
  // Apps: connecting, renaming, testing, reconnecting and disconnecting an
  // installation are all changes to what this account can reach.
  // A private App is a capability the account gains: creating, changing and deleting
  // one are changes to what agents can be authorised to do.
  R('POST', 'api/private-apps', { entityType: 'tool', action: 'create' }),
  R('POST', 'api/private-apps/import', { entityType: 'tool', action: 'create' }),
  R('PATCH', 'api/private-apps/:', { entityType: 'tool', action: 'update' }, { idAt: 2 }),
  R('DELETE', 'api/private-apps/:', { entityType: 'tool', action: 'delete' }, { idAt: 2 }),
  // Arquivar tira o App do catálogo sem apagar nada — é uma mudança de estado, e
  // precisa constar no histórico como qualquer outra.
  R('POST', 'api/private-apps/:/archive', { entityType: 'tool', action: 'update' }, { idAt: 2 }),
  R('POST', 'api/app-installations', { entityType: 'connection', action: 'create' }),
  R('PATCH', 'api/app-installations/:', { entityType: 'connection', action: 'update' }, { idAt: 2 }),
  R('POST', 'api/app-installations/:/test', { entityType: 'connection', action: 'test' }, { idAt: 2 }),
  R('POST', 'api/app-installations/:/reconnect', { entityType: 'connection', action: 'update' }, { idAt: 2 }),
  R('DELETE', 'api/app-installations/:', { entityType: 'connection', action: 'disconnect' }, { idAt: 2 }),
  // O stream de mercado é a conexão em outro estado, e mexer nele é mexer na conexão:
  // pausar tira o dono do ar até alguém retomar, e isso precisa constar no histórico.
  // Ligar e desligar tempo real é mudar o que a conta faz sozinha. Precisa constar.
  R('POST', 'api/streams', { entityType: 'connection', action: 'update' }),
  R('DELETE', 'api/streams/:', { entityType: 'connection', action: 'disconnect' }, { idAt: 2 }),
  R('POST', 'api/streams/:/pause', { entityType: 'connection', action: 'pause' }, { idAt: 2 }),
  R('POST', 'api/streams/:/resume', { entityType: 'connection', action: 'activate' }, { idAt: 2 }),
  R('POST', 'api/streams/:/reconnect', { entityType: 'connection', action: 'update' }, { idAt: 2 }),
  // Testar não muda nada — e é registrado como teste, igual ao da conexão.
  R('POST', 'api/streams/test', { entityType: 'connection', action: 'test' }),
  // Mudar uma política é mudar o que a conta pode fazer. Precisa constar.
  R('POST', 'api/trading-policies', { entityType: 'connection', action: 'update' }),

  // O App de WebSocket. Ligar, pausar e mexer em assinatura muda o que a conta recebe
  // sozinha — tudo isso precisa constar no histórico.
  R('PATCH', 'api/websocket/connections/:', { entityType: 'connection', action: 'update' }, { idAt: 3 }),
  R('POST', 'api/websocket/connections/:/start', { entityType: 'connection', action: 'activate' }, { idAt: 3 }),
  R('POST', 'api/websocket/streams/:/pause', { entityType: 'connection', action: 'pause' }, { idAt: 3 }),
  R('POST', 'api/websocket/streams/:/resume', { entityType: 'connection', action: 'activate' }, { idAt: 3 }),
  R('DELETE', 'api/websocket/streams/:', { entityType: 'connection', action: 'disconnect' }, { idAt: 3 }),
  R('POST', 'api/websocket/subscriptions', { entityType: 'connection', action: 'create' }),
  R('PATCH', 'api/websocket/subscriptions/:', { entityType: 'connection', action: 'update' }, { idAt: 3 }),
  R('DELETE', 'api/websocket/subscriptions/:', { entityType: 'connection', action: 'delete' }, { idAt: 3 }),
  // Mandar um quadro pela conexão é ação de quem administra: fica registrado que
  // aconteceu, e nunca o que foi mandado.
  R('POST', 'api/websocket/connections/:/send', { entityType: 'connection', action: 'test' }, { idAt: 3 }),
  R('POST', 'api/websocket/connections/:/test', { entityType: 'connection', action: 'test' }, { idAt: 3 }),
  // Conferir um endereço e testar uma assinatura não mudam nada.
  R('POST', 'api/websocket/check-url', null),
  R('POST', 'api/websocket/subscriptions/:/test', null),
  // --- Arquiteto do Escritório -------------------------------------------------------
  // O que fica registrado é o que MUDA a conta: criar o projeto, editá-lo, aplicá-lo,
  // retomar e arquivar. A conversa não: ela é a fala da pessoa, e o log de auditoria
  // não é lugar de guardar conteúdo.
  // O histórico genérico: a DEFINIÇÃO é auditada; a leitura, não — ler não muda nada.
  // As fontes em tempo real: a DEFINIÇÃO e a concessão a um agente são auditadas; a
  // leitura, não — ler o valor de agora não muda nada.
  R('POST', 'api/realtime-sources', { entityType: 'realtime_source', action: 'create' }),
  R('PATCH', 'api/realtime-sources/:', { entityType: 'realtime_source', action: 'update' }, { idAt: 2 }),
  R('DELETE', 'api/realtime-sources/:', { entityType: 'realtime_source', action: 'delete' }, { idAt: 2 }),
  R('POST', 'api/realtime-sources/:/agents/:', { entityType: 'realtime_source', action: 'update' }, { idAt: 2 }),
  R('POST', 'api/data-history/recorders', { entityType: 'data_recorder', action: 'create' }),
  R('PATCH', 'api/data-history/recorders/:', { entityType: 'data_recorder', action: 'update' }, { idAt: 3 }),
  R('DELETE', 'api/data-history/recorders/:', { entityType: 'data_recorder', action: 'delete' }, { idAt: 3 }),
  // A prévia não grava nada: ela roda o motor contra amostras e joga fora.
  R('POST', 'api/data-history/preview', null, { why: 'preview only, nothing is stored' }),
  // A sessão do visitante do widget: pública, sem dono para atribuir, e o token não
  // pode ser registrado em lugar nenhum.
  R('POST', 'api/public/widgets/:/session', null, { why: 'public visitor session, no owner context' }),
  /**
   * A base de conhecimento pela porta única — MESMO tipo de entidade das rotas por dono.
   *
   * O objeto é o mesmo documento; só a porta é outra. Um tipo novo faria a mesma
   * exclusão aparecer no registro com dois nomes, dependendo de por onde ela passou.
   */
  R('POST', 'api/knowledge/documents/upload', { entityType: 'knowledge', action: 'create' }),
  // Aprovar uma proposta CRIA um documento; recusar decide sobre ela. Os dois são
  // mudanças no que os agentes leem, e entram no registro.
  R('POST', 'api/knowledge/proposals/:/approve', { entityType: 'knowledge', action: 'create' }, { idAt: 3 }),
  R('POST', 'api/knowledge/proposals/:/reject', { entityType: 'knowledge', action: 'update' }, { idAt: 3 }),
  R('POST', 'api/knowledge/conflicts/:/resolve', { entityType: 'knowledge', action: 'update' }, { idAt: 3 }),
  R('POST', 'api/knowledge/gaps/:/resolve', { entityType: 'knowledge', action: 'update' }, { idAt: 3 }),
  R('POST', 'api/knowledge/gaps/:/dismiss', { entityType: 'knowledge', action: 'update' }, { idAt: 3 }),
  // Varrer não muda documento nenhum: é uma leitura que grava o que encontrou.
  R('POST', 'api/knowledge/conflicts/scan', null, { why: 'detection, not a change' }),
  // Posição de nó não é conhecimento: arrastar não muda o que ninguém lê.
  R('PUT', 'api/knowledge/graph/layout', null, { why: 'view preference, not knowledge' }),
  R('DELETE', 'api/knowledge/graph/layout', null, { why: 'view preference, not knowledge' }),
  R('POST', 'api/knowledge/documents', { entityType: 'knowledge', action: 'create' }),
  R('PATCH', 'api/knowledge/documents/:', { entityType: 'knowledge', action: 'update' }, { idAt: 3 }),
  R('DELETE', 'api/knowledge/documents/:', { entityType: 'knowledge', action: 'delete' }, { idAt: 3 }),
  R('POST', 'api/knowledge/documents/:/reindex', { entityType: 'knowledge', action: 'update' }, { idAt: 3 }),
  /**
   * DATABASES. Criar, editar e apagar um database ou dataset muda o que os agentes
   * conseguem consultar — entra no registro. Consultar não: leitura não é mudança, e um
   * registro por consulta afogaria o log justamente quando ele importa.
   */
  // Publicar uma VERSÃO de ferramenta é uma mudança no que pode ser instalado e
  // executado — e ela é imutável depois, o que torna o registro a única forma de saber
  // quem publicou o quê.
  R('POST', 'api/tools/:/versions', { entityType: 'tool', action: 'create' }, { idAt: 2 }),

  /**
   * EXTENSÕES: criar, congelar uma versão, mover o ciclo e instalar.
   *
   * Publicar uma versão é imutável depois — o registro é a única forma de saber quem
   * publicou o quê. E instalar é conceder alcance a código de terceiro dentro do
   * escritório: exatamente o tipo de mudança que uma auditoria existe para responder.
   */
  R('POST', 'api/extensions/packages', { entityType: 'extension', action: 'create' }),
  R('POST', 'api/extensions/packages/:/versions', { entityType: 'extension', action: 'publish' }, { idAt: 3 }),
  R('POST', 'api/extensions/packages/from-tool/:', { entityType: 'extension', action: 'create' }),
  // O backfill CRIA pacotes a partir do que a conta já tem: é mudança, e entra no registro.
  R('POST', 'api/extensions/backfill/apps', { entityType: 'extension', action: 'create' }),
  // A DECISÃO de revisão é o registro mais importante que existe aqui: ela é o que
  // autoriza código a rodar, e quem a tomou precisa estar no log de auditoria também.
  R('POST', 'api/extensions/review/decisions', { entityType: 'extension', action: 'publish' }),
  R('POST', 'api/extensions/packages/:/status', { entityType: 'extension', action: 'update' }, { idAt: 3 }),
  R('POST', 'api/extensions/installed/:', { entityType: 'extension', action: 'create' }, { idAt: 3 }),
  R('POST', 'api/extensions/installed/:/update', { entityType: 'extension', action: 'update' }, { idAt: 3 }),
  R('POST', 'api/extensions/installed/:/template', { entityType: 'extension', action: 'create' }, { idAt: 3 }),
  R('DELETE', 'api/extensions/installed/:', { entityType: 'extension', action: 'pause' }, { idAt: 3 }),

  /**
   * As FONTES da Central. Criar, editar, ativar e apagar mudam o que o escritório
   * observa sozinho — e "quem ligou esta fonte" é exatamente o que uma auditoria
   * precisa responder. Testar e ler NÃO entram: são leitura, e são frequentes.
   */
  R('POST', 'api/monitoring/sources', { entityType: 'monitoring_source', action: 'create' }),
  R('POST', 'api/monitoring/migrate/recorders', { entityType: 'monitoring_source', action: 'create' }),
  R('POST', 'api/monitoring/migrate/recorders/rollback', { entityType: 'monitoring_source', action: 'delete' }),
  R('PUT', 'api/monitoring/sources/:', { entityType: 'monitoring_source', action: 'update' }, { idAt: 3 }),
  R('POST', 'api/monitoring/sources/:/activate', { entityType: 'monitoring_source', action: 'activate' }, { idAt: 3 }),
  R('POST', 'api/monitoring/sources/:/pause', { entityType: 'monitoring_source', action: 'pause' }, { idAt: 3 }),
  R('POST', 'api/monitoring/sources/:/duplicate', { entityType: 'monitoring_source', action: 'create' }, { idAt: 3 }),
  R('DELETE', 'api/monitoring/sources/:', { entityType: 'monitoring_source', action: 'delete' }, { idAt: 3 }),
  R('POST', 'api/monitoring/sources/test', null, { why: 'leitura de teste, não muda nada' }),
  R('POST', 'api/monitoring/sources/:/test', null, { why: 'leitura de teste, não muda nada' }),
  R('POST', 'api/monitoring/sources/:/read', null, { why: 'coleta sob demanda: o registro é auditado pelo histórico' }),
  // Girar o segredo de um webhook é exatamente o que uma auditoria precisa mostrar depois.
  R('POST', 'api/monitoring/sources/:/webhook-secret', { entityType: 'monitoring_source', action: 'rotate' }, { idAt: 3 }),
  // Criar um monitor A PARTIR de uma fonte cria uma regra que vai agir sozinha — e ainda
  // materializa o destino da fonte. As duas coisas são mudança, e as duas entram.
  R('POST', 'api/monitoring/sources/:/monitor', { entityType: 'monitor', action: 'create' }, { idAt: 3 }),
  // Conceder e revogar alcance é mudança de permissão: entra no registro.
  R('PUT', 'api/monitoring/sources/:/grants', { entityType: 'monitoring_source', action: 'update' }, { idAt: 3 }),
  R('DELETE', 'api/monitoring/sources/:/grants/:/:', { entityType: 'monitoring_source', action: 'update' }, { idAt: 3 }),

  // O MONITOR é uma regra que age sozinha: quem a criou, quem a pôs de plantão e quem a
  // pausou é exatamente o que uma auditoria precisa responder depois. Publicar é
  // `activate` e não `publish`: o que muda é o ESTADO de plantão, não uma versão imutável.
  R('POST', 'api/monitors', { entityType: 'monitor', action: 'create' }),
  R('POST', 'api/monitors/simulate', null, { why: 'simulação pura: não toca em estado nem dispara' }),
  R('PUT', 'api/monitors/:', { entityType: 'monitor', action: 'update' }, { idAt: 2 }),
  R('POST', 'api/monitors/:/publish', { entityType: 'monitor', action: 'activate' }, { idAt: 2 }),
  R('POST', 'api/monitors/:/pause', { entityType: 'monitor', action: 'pause' }, { idAt: 2 }),
  R('DELETE', 'api/monitors/:', { entityType: 'monitor', action: 'delete' }, { idAt: 2 }),

  // A migração cria Data Stores e datasets a partir do que a conta já grava: é mudança.
  R('POST', 'api/databases/migrate/histories', { entityType: 'database', action: 'create' }),
  R('POST', 'api/databases/migrate/histories/rollback', { entityType: 'database', action: 'delete' }),

  R('POST', 'api/databases', { entityType: 'database', action: 'create' }),
  R('PATCH', 'api/databases/:', { entityType: 'database', action: 'update' }, { idAt: 2 }),
  R('DELETE', 'api/databases/:', { entityType: 'database', action: 'delete' }, { idAt: 2 }),
  R('POST', 'api/databases/:/datasets', { entityType: 'database', action: 'update' }, { idAt: 2 }),
  R('PATCH', 'api/databases/:/datasets/:', { entityType: 'database', action: 'update' }, { idAt: 2 }),
  R('DELETE', 'api/databases/:/datasets/:', { entityType: 'database', action: 'update' }, { idAt: 2 }),
  R('PUT', 'api/databases/:/grants', { entityType: 'database', action: 'update' }, { idAt: 2 }),
  R('DELETE', 'api/databases/:/grants/:', { entityType: 'database', action: 'update' }, { idAt: 2 }),
  R('POST', 'api/databases/:/datasets/:/rows', { entityType: 'database', action: 'update' }, { idAt: 2 }),
  R('POST', 'api/databases/:/datasets/:/query', null, { why: 'read, not a change' }),

  R('POST', 'api/architect/projects', { entityType: 'architect_project', action: 'create' }),
  R('PATCH', 'api/architect/projects/:', { entityType: 'architect_project', action: 'update' }, { idAt: 3 }),
  R('PATCH', 'api/architect/projects/:/links', { entityType: 'architect_project', action: 'update' }, { idAt: 3 }),
  // Correção à mão na proposta: muda o plano que a confirmação vai aplicar, e por isso
  // entra no registro como qualquer outra alteração do projeto.
  R('PATCH', 'api/architect/projects/:/blueprint', { entityType: 'architect_project', action: 'update' }, { idAt: 3 }),
  // Trocar a camada muda o que vai ser escrito no escritório: é uma revisão da proposta.
  R('PATCH', 'api/architect/projects/:/layer', { entityType: 'architect_project', action: 'update' }, { idAt: 3 }),
  // O entendimento do negócio corrigido à mão: muda o que a proposta seguinte assume.
  R('PATCH', 'api/architect/projects/:/brief', { entityType: 'architect_project', action: 'update' }, { idAt: 3 }),
  R('POST', 'api/architect/projects/:/archive', { entityType: 'architect_project', action: 'archive' }, { idAt: 3 }),
  // Apagar a CONVERSA. O que ela criou continua de pé — ver `deleteProject`.
  R('DELETE', 'api/architect/projects/:', { entityType: 'architect_project', action: 'delete' }, { idAt: 3 }),
  // Conversar não é auditado: é a fala da pessoa, e o log não guarda conteúdo. Gerar e
  // revisar, sim — os dois mudam a PROPOSTA, que é o que vai ser aplicado, e sem eles
  // no log não dá para contar a história de como o projeto chegou onde chegou. O que
  // fica registrado é a ação e o projeto; nunca o prompt, a conversa ou o blueprint.
  R('POST', 'api/architect/projects/:/messages', null, { why: 'conversation traffic' }),
  // A rodada do assistente é conversa: responder e explicar não mudam nada. Quando ela vira
  // proposta, quem registra a criação é o próprio `POST /projects`, chamado por dentro — e
  // registrar aqui também contaria a mesma criação duas vezes.
  R('POST', 'api/architect/assistant/turn', null, { why: 'conversation traffic' }),
  // A confirmação de uma escrita preparada pelo chat registra a si mesma, com o resultado —
  // inclusive a recusa por hash vencido, que é justamente o que alguém vai querer investigar.
  R('POST', 'api/architect/assistant/confirm', null, { why: 'audita a si mesma, com o desfecho' }),
  R('POST', 'api/architect/projects/:/turn', { entityType: 'architect_project', action: 'update' }, { idAt: 3 }),
  R('POST', 'api/architect/projects/:/generate', { entityType: 'architect_project', action: 'update' }, { idAt: 3 }),
  R('POST', 'api/architect/projects/:/validate', { entityType: 'architect_project', action: 'test' }, { idAt: 3 }),
  // Marcar um item da checklist é anotação do dono sobre o próprio projeto.
  R('PATCH', 'api/architect/projects/:/checklist/:', null, { why: 'owner note on the project' }),
  // Aplicar é a mudança real: é aqui que andares, agentes e setores passam a existir.
  // Cada um deles também é auditado como ele mesmo, pelo caminho de sempre.
  R('POST', 'api/architect/projects/:/apply', { entityType: 'architect_project', action: 'publish' }, { idAt: 3 }),
  R('POST', 'api/architect/projects/:/resume', { entityType: 'architect_project', action: 'publish' }, { idAt: 3 }),
  R('POST', 'api/architect/projects/:/rollback', { entityType: 'architect_project', action: 'delete' }, { idAt: 3 }),
  // Reconferir a checklist é leitura do estado real.
  R('POST', 'api/architect/projects/:/recheck', null, { why: 'read-only check' }),

  // Granting or revoking an App on an agent changes what that agent may do.
  R('PATCH', 'api/agents/:/app-grants', { entityType: 'agent', action: 'update' }, { idAt: 2 }),
  R('POST', 'api/connections', { entityType: 'connection', action: 'create' }),
  R('PATCH', 'api/connections/:', { entityType: 'connection', action: 'update' }, { idAt: 2 }),
  R('DELETE', 'api/connections/:', { entityType: 'connection', action: 'delete' }, { idAt: 2 }),
  R('POST', 'api/connections/:/test', { entityType: 'connection', action: 'test' }, { idAt: 2 }),
  // Disconnecting Google is a real change to what the account can reach.
  R('DELETE', 'api/integrations/google', { entityType: 'connection', action: 'disconnect' }),

  // --- automations (legacy surface, still reachable by API) ---------------------------------
  R('POST', 'api/automations', { entityType: 'automation', action: 'create' }),
  R('PATCH', 'api/automations/:', { entityType: 'automation', action: 'update' }, { idAt: 2 }),
  R('POST', 'api/automations/:/publish', { entityType: 'automation', action: 'publish' }, { idAt: 2 }),
  R('POST', 'api/automations/:/activate', { entityType: 'automation', action: 'activate' }, { idAt: 2 }),
  R('POST', 'api/automations/:/pause', { entityType: 'automation', action: 'pause' }, { idAt: 2 }),
  R('POST', 'api/automations/:/archive', { entityType: 'automation', action: 'archive' }, { idAt: 2 }),
  R('POST', 'api/automations/:/webhook/rotate', { entityType: 'automation', action: 'rotate' }, { idAt: 2 }),

  // --- settings ---------------------------------------------------------------------------
  R('PUT', 'api/settings/monthly-token-cap', { entityType: 'settings', action: 'update' }),
  R('PUT', 'api/settings/:/key', { entityType: 'settings', action: 'update' }),
  R('DELETE', 'api/settings/:/key', { entityType: 'settings', action: 'delete' }),
]

// Never audited, whatever the rules say: sessions carry passwords and tokens, the
// public webhook receiver carries a third party's payload, and reading the log is
// not a change.
const SKIP_PREFIXES = ['/api/auth', '/api/hooks', '/api/logs']

export interface AuditTarget {
  entityType: AuditEntityType
  entityId: string | null
  action: AuditAction
}

const matches = (rule: Rule, segments: string[]): boolean =>
  rule.pattern.length === segments.length && rule.pattern.every((p, i) => p === ':' || p === segments[i])

// Pure: the request line → what to record, or null for "not an audited change".
// Exported because this mapping is the whole risk surface of the middleware.
export function auditTargetFor(method: string, path: string): AuditTarget | null {
  const verb = method.toUpperCase()
  if (verb === 'GET' || verb === 'HEAD' || verb === 'OPTIONS') return null
  if (SKIP_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) return null

  const segments = path.split('?')[0].split('/').filter(Boolean)
  for (const rule of RULES) {
    if (!rule.methods.includes(verb) || !matches(rule, segments)) continue
    if (!rule.target) return null
    const entityId = rule.idAt !== undefined ? (segments[rule.idAt] ?? null) : null
    return { entityType: rule.target.entityType, entityId, action: rule.target.action }
  }
  return null
}

// Every rule, for the test that checks the app's routes against this table.
export const auditRules = (): { methods: string[]; path: string; audited: boolean }[] =>
  RULES.map((r) => ({ methods: r.methods, path: `/${r.pattern.join('/')}`, audited: r.target !== null }))

// Attach a request id (also returned as a header, so a support conversation can
// quote it) and record the change once the response is known.
export function auditRequests(req: Request, res: Response, next: NextFunction): void {
  const requestId = randomUUID()
  res.locals.requestId = requestId
  res.setHeader('x-request-id', requestId)

  const target = auditTargetFor(req.method, req.path)
  if (!target) {
    next()
    return
  }

  res.on('finish', () => {
    const ownerId = res.locals.userId
    // No session, no owner to attribute it to: an unauthenticated attempt belongs to
    // the access log, not to this owner-scoped trail.
    if (typeof ownerId !== 'string' || !ownerId) return
    const status = res.statusCode
    // 4xx that mean "invalid input" are noise; what matters is the change that
    // happened, and the failure of one that should have worked.
    const relevantFailure = status >= 500 || status === 403 || status === 409
    if (status >= 400 && !relevantFailure) return

    // What a handler may add, and NOTHING else: three scalars it has already
    // validated as the owner's. The response body is never read — an id and a short
    // name are the only things a log entry needs that the URL cannot give.
    const declaredId = typeof res.locals.auditEntityId === 'string' ? res.locals.auditEntityId : null
    const declaredLabel = typeof res.locals.auditEntityLabel === 'string' ? res.locals.auditEntityLabel : null
    // On a DELETE the label was read before the handler ran, so it is trusted only
    // when the document really belonged to this owner. A label a handler declared
    // came from its own owner-scoped write, and needs no such check.
    const label = res.locals.auditEntityOwner === undefined ? declaredLabel : res.locals.auditEntityOwner === ownerId ? declaredLabel : null

    void recordAudit({
      ownerId,
      actorType: 'user',
      actorId: ownerId,
      action: target.action,
      entityType: target.entityType,
      // The URL wins when it names the entity; a creation has no id in the path, so
      // what the handler declared is what identifies it.
      entityId: target.entityId ?? declaredId,
      entityLabel: label,
      floorId: typeof res.locals.auditFloorId === 'string' ? res.locals.auditFloorId : null,
      result: status < 400 ? 'success' : 'failure',
      requestId,
      // Facts about the request, never anything from its body.
      metadata: { method: req.method, statusCode: status },
    })
  })

  // A deletion is the only case that must read the entity BEFORE the handler: the
  // label would be gone afterwards. One lookup, on deletes only, and the owner comes
  // back with it so the finish handler can refuse a label that is not this owner's.
  if (target.action === 'delete' && target.entityId) {
    void entityLabelWithOwner(target.entityType, target.entityId)
      .then((found) => {
        if (!found) return
        res.locals.auditEntityOwner = found.ownerId
        res.locals.auditEntityLabel = found.label
      })
      .catch(() => undefined)
      .finally(() => next())
    return
  }
  next()
}

// The ONLY way a handler contributes to its own audit event: three validated,
// owner-scoped scalars. No body is read, and nothing else is accepted — a handler
// cannot smuggle content into the trail through this door.
export function auditEntity(res: Response, entity: { id?: unknown; label?: unknown; floorId?: unknown }): void {
  if (typeof entity.id === 'string' && entity.id) res.locals.auditEntityId = entity.id
  if (typeof entity.label === 'string' && entity.label.trim()) res.locals.auditEntityLabel = entity.label
  if (typeof entity.floorId === 'string' && entity.floorId) res.locals.auditFloorId = entity.floorId
}
