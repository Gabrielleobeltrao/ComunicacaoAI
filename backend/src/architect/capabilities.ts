import { ACTIVATION_MODES } from '../agents.js'
import { AGENT_PRESET_SPECS } from '../agentPresets.js'
import { roleUIConfigOf } from '../agentCapabilities.js'
import { SECTOR_MODES } from '../sectors.js'
import { listPublicFunctions } from '../executors/functionRegistry.js'
import { OFFICIAL_APPS } from '../apps/official/index.js'
import { listInstallations } from '../apps/installations.js'
import { listTools } from '../tools.js'
import type { AgentPreset } from '../agents.js'

// O CATÁLOGO VIVO do que o Arquiteto pode propor.
//
// Montado a partir das fontes reais do sistema — os presets, o `roleConfig` que o
// runtime consulta, o registro de funções, o catálogo de Apps e as ferramentas da
// conta. Nada aqui é escrito à mão.
//
// O motivo é uma falha específica: uma lista de capacidades escrita no prompt envelhece
// sozinha. Ela continua oferecendo o App que foi removido e não sabe da função que foi
// acrescentada — e o modelo propõe, a pessoa aprova, e a aplicação falha em cima de um
// recurso que não existe. Aqui a lista é derivada; quando o sistema muda, ela muda.
//
// O manifesto é owner-scoped: o que ESTA conta tem conectado é diferente do que existe
// no catálogo, e a diferença importa — propor um App não conectado é propor uma
// pendência, não um recurso pronto.

export interface CapabilityPreset {
  preset: AgentPreset
  label: string
  description: string
  /** O que o papel PODE fazer, resolvido pelo mesmo lugar que o runtime consulta. */
  capabilities: string[]
  /** Para quem ele pode delegar por padrão. */
  delegationPolicy: string
  activationModes: string[]
  requiresTool: boolean
}

export interface CapabilityFunction {
  functionName: string
  version: string
  description: string
  capabilities: string[]
  hasConfig: boolean
}

export interface CapabilityApp {
  key: string
  name: string
  connected: boolean
  /** As ações REAIS deste App. Uma ação fora desta lista não existe. */
  actions: { key: string; name: string; risk: 'read' | 'write' | 'high_risk' }[]
}

export interface ArchitectCapabilityManifest {
  /** Sobe quando a FORMA do manifesto muda, não quando o conteúdo da conta muda. */
  version: number
  presets: CapabilityPreset[]
  executorKinds: { kind: 'llm' | 'function' | 'tool'; requires: string[] }[]
  sectorModes: { mode: string; meaning: string }[]
  activationModes: string[]
  functions: CapabilityFunction[]
  apps: CapabilityApp[]
  /** Ferramentas próprias da conta (Custom Tools). */
  tools: { id: string; name: string; description: string }[]
  knowledgeScopes: string[]
  channels: { key: string; connected: boolean }[]
}

export const CAPABILITY_MANIFEST_VERSION = 1

/** Os Apps que servem de CANAL: eles é que fazem uma operação ter porta de entrada. */
const CANAIS = new Set(['web_chat', 'whatsapp', 'telegram', 'email'])

/**
 * O manifesto desta conta.
 *
 * Uma consulta ao banco (instalações e ferramentas) e o resto vem de constantes do
 * próprio código. É barato o bastante para ser montado a cada rodada do Arquiteto, e
 * ser montado a cada rodada é o que garante que ele não fale de um App que a pessoa
 * acabou de desconectar.
 */
export async function buildCapabilityManifest(ownerId: string): Promise<ArchitectCapabilityManifest> {
  const [instalacoes, ferramentas] = await Promise.all([
    listInstallations(ownerId).catch(() => []),
    listTools(ownerId).catch(() => []),
  ])
  const conectados = new Set(instalacoes.filter((i) => i.status === 'connected').map((i) => i.appKey))

  const presets: CapabilityPreset[] = AGENT_PRESET_SPECS.map((spec) => {
    // O MESMO resolvedor que o runtime usa para montar as ferramentas do agente. Uma
    // segunda tabela aqui divergiria na primeira mudança de papel.
    const role = roleUIConfigOf({ preset: spec.preset })
    return {
      preset: spec.preset,
      label: spec.label,
      description: spec.description,
      // Só o que é BOOLEANO e está ligado. `RoleCapabilities` carrega junto o nome do
      // papel, os conflitos herdados e o resumo — todos verdadeiros no sentido de
      // JavaScript, e nenhum deles é uma capacidade. Filtrar por `=== true` é o que
      // separa "o que este papel PODE fazer" de "o que está escrito no registro dele".
      capabilities: Object.entries(role.capabilities)
        .filter(([, ligada]) => ligada === true)
        .map(([nome]) => nome),
      delegationPolicy: spec.delegationPolicy,
      activationModes: spec.activationModes,
      requiresTool: spec.requiresTool === true,
    }
  })

  return {
    version: CAPABILITY_MANIFEST_VERSION,
    presets,
    executorKinds: [
      { kind: 'llm', requires: ['objetivo que exija julgamento', 'contrato de saída'] },
      { kind: 'function', requires: ['functionName do registro', 'inputJsonSchema', 'outputJsonSchema'] },
      { kind: 'tool', requires: ['App ou Tool real', 'ação existente', 'schemas resolvidos do catálogo'] },
    ],
    sectorModes: [
      { mode: 'organization', meaning: 'apenas agrupa na tela; ninguém coordena' },
      { mode: 'orchestrated', meaning: 'o coordenador decide quem responde a cada pedido' },
      { mode: 'pipeline', meaning: 'as etapas acontecem sempre na mesma ordem' },
    ].filter((m) => SECTOR_MODES.includes(m.mode as (typeof SECTOR_MODES)[number])),
    activationModes: [...ACTIVATION_MODES],
    functions: listPublicFunctions().map((f) => ({
      functionName: f.functionName,
      version: f.version,
      description: f.description,
      capabilities: f.capabilities,
      hasConfig: f.configSchema !== null,
    })),
    apps: OFFICIAL_APPS.map((app) => ({
      key: app.key,
      name: app.name,
      connected: conectados.has(app.key),
      // `risk` vem do próprio manifesto do App. Classificar aqui por heurística seria
      // uma segunda fonte de verdade sobre o que é perigoso — e a que erra é sempre a
      // cópia.
      actions: (app.actions ?? []).map((a) => ({ key: a.key, name: a.name, risk: a.risk })),
    })),
    tools: ferramentas.map((t) => ({ id: t._id.toString(), name: t.name, description: t.description ?? '' })),
    knowledgeScopes: ['building', 'floor', 'sector', 'agent'],
    channels: [...CANAIS].map((key) => ({ key, connected: conectados.has(key) })),
  }
}

/**
 * O manifesto em texto, para o prompt — e SÓ o pedaço que a etapa precisa.
 *
 * Mandar o catálogo inteiro em toda rodada gasta contexto com o que não está em jogo e
 * afoga a informação que importa. Aqui vai o que muda a decisão: os perfis com o que
 * cada um pode fazer, os executores com o que exigem, e o que a conta REALMENTE tem.
 */
export function manifestForPrompt(m: ArchitectCapabilityManifest): string {
  const perfis = m.presets
    .map((p) => `- "${p.preset}" (${p.label}): ${p.description} Capacidades: ${p.capabilities.join(', ') || 'nenhuma além de conversar'}.`)
    .join('\n')
  const funcoes = m.functions.length
    ? m.functions.map((f) => `- ${f.functionName}: ${f.description}`).join('\n')
    : '- (nenhuma função determinística registrada nesta instalação)'
  const apps = m.apps
    .map((a) => {
      // A ação de alto risco é marcada: é ela que exige aprovação humana na proposta.
      const acoes = a.actions.map((x) => `${x.key}${x.risk === 'high_risk' ? ' (ação sensível)' : ''}`)
      return `- ${a.key} (${a.name})${a.connected ? ' — CONECTADO' : ' — não conectado'}${acoes.length ? `; ações: ${acoes.join(', ')}` : ''}`
    })
    .join('\n')
  const tools = m.tools.length ? m.tools.map((t) => `- ${t.name}`).join('\n') : '- (nenhuma ferramenta própria cadastrada)'

  return `O QUE EXISTE DE VERDADE NESTA CONTA (catálogo do servidor — nada fora disto pode ser proposto):

PERFIS DE AGENTE:
${perfis}

EXECUTORES (como o trabalho é feito):
${m.executorKinds.map((e) => `- "${e.kind}" exige: ${e.requires.join('; ')}`).join('\n')}

MODOS DE SETOR:
${m.sectorModes.map((s) => `- "${s.mode}": ${s.meaning}`).join('\n')}

ACIONAMENTOS: ${m.activationModes.join(', ')}

FUNÇÕES DETERMINÍSTICAS DISPONÍVEIS:
${funcoes}

APPS:
${apps}

FERRAMENTAS PRÓPRIAS DA CONTA:
${tools}

ESCOPOS DE CONHECIMENTO: ${m.knowledgeScopes.join(', ')}`
}
