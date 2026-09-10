// AS FERRAMENTAS DO ASSISTENTE — o que ele consegue fazer, uma por recurso.
//
// O compilador adivinhava a partir do texto: só entendia o que alguém escreveu regra para
// entender. "somar" não casava com "soma", inglês não casava com nada, e cada forma nova de
// pedir exigia código novo. Esse era o teto.
//
// Aqui o modelo preenche ESTRUTURA e o código recusa com a razão. A diferença que paga é a
// recusa que VOLTA: numa saída de uma chamada só, um campo errado faz o item ser descartado
// em silêncio e a rodada se perde; no laço, o executor devolve
//
//     recusado: mapeie ao menos um campo
//
// e o modelo corrige na mesma rodada — ou pergunta, quando a informação é do dono.
//
// O que NÃO muda: nenhuma ferramenta cria recurso. Elas montam um RASCUNHO, e aplicar
// continua sendo endpoint separado, com hash e confirmação.

import type { ResolvedTool } from '../agentTools.js'
import type { OfficeInventory } from './inventory.js'
import { NOME_DA_CONTA } from './compileV2.js'
import { ADAPTER_KINDS } from '../databases/types.js'
import { KIND_CAPABILITIES } from '../monitoring/types.js'

/** Os tipos de fonte que existem, e o que cada um exige. Vem do domínio. */
const TIPOS_DE_FONTE = Object.keys(KIND_CAPABILITIES)
/** Os operadores que a condição de um monitor aceita. */
const OPERADORES = ['lt', 'lte', 'gt', 'gte', 'eq', 'ne']
const MODOS_DE_DISPARO = ['level', 'enter', 'exit', 'cross_up', 'cross_down', 'change']

// Credencial não entra em plano: ela vaza em log, em print e em qualquer lugar onde a URL
// apareça. Os mesmos padrões que o domínio usa em `monitoring/service.ts`.
const PARECE_SEGREDO = /(secret|token|password|senha|api[_-]?key|credential|authorization|access[_-]?token|apikey)/i
const VALOR_DE_SEGREDO = /^(sk-|ghp_|ey[A-Za-z0-9_-]{10,}|Bearer )/i

/** As sete contas determinísticas do motor de Históricos. Fora desta lista, nada entra. */
const CONTAS = Object.keys(NOME_DA_CONTA)

/** Os tipos de Database que existem. Vem do domínio: uma segunda lista aqui divergiria. */
const ADAPTERS: string[] = [...ADAPTER_KINDS]

/**
 * O RASCUNHO que as ferramentas montam.
 *
 * Ele não é o plano: é o que o modelo declarou nesta rodada. Quem transforma declaração em
 * plano continua sendo o compilador, que valida de novo — duas portas, porque a primeira é
 * uma porta e não uma garantia.
 */
export interface RascunhoDoPlano {
  janelas: { source: string; field: string; everyMs: number; ops: string[] }[]
  databases: { chave: string; nome: string; descricao: string; tipo: string; agentes: string[]; acesso: 'read' | 'write'; diasDeRetencao?: number }[]
  conjuntos: { databaseChave: string; chave: string; nome: string; campos: { nome: string; tipo: string }[]; podeEditar: boolean }[]
  fontes: { chave: string; nome: string; tipo: string; endereco: string; metodo: string; cabecalhos: string[]; intervaloMs: number; campos: { to: string; from: string; required: boolean }[] }[]
  monitores: { chave: string; nome: string; conjuntoChave: string; campo: string; operador: string; valor: number; modo: string }[]
  agentes: { chave: string; nome: string; andar: string; papel: string; quandoEntra: string; recebe: string; entrega: string; instrucoes: string; limites: string[] }[]
  setores: { chave: string; nome: string; andar: string; modo: string; membros: string[]; coordenador: string; instrucao: string }[]
  /** A pergunta que encerra a rodada. Uma só: duas perguntas por turno é formulário. */
  pergunta: { chave: string; texto: string; opcoes: { value: string; label: string }[] } | null
}

export const rascunhoVazio = (): RascunhoDoPlano => ({ janelas: [], databases: [], conjuntos: [], fontes: [], monitores: [], agentes: [], setores: [], pergunta: null })

const ok = (result: string) => ({ ok: true, result })

/**
 * A RECUSA que o modelo consegue usar.
 *
 * Estruturada de propósito: uma frase em prosa ("não foi possível") lê como resultado, e
 * modelos já foram vistos relatando isso como se a coisa tivesse acontecido. Aqui a primeira
 * palavra é sempre `recusado`, e a razão vem junto para ele corrigir sem adivinhar.
 */
const recusado = (porque: string, comoResolver?: string) => ({
  ok: false,
  result: `recusado: ${porque}${comoResolver ? ` — ${comoResolver}` : ''}`,
})

const texto = (v: unknown, teto = 400): string => String(v ?? '').trim().slice(0, teto)

/**
 * O escritório em português, do inventário REAL.
 *
 * O Assistente já recebe isto no prompt. A ferramenta existe para a rodada em que ele precisa
 * conferir de novo — depois de uma recusa, tipicamente — sem gastar outra rodada inteira.
 */
function verInventario(inventory: OfficeInventory | null): ResolvedTool {
  return {
    name: 'ver_inventario',
    description:
      'O que esta conta já tem: andares, agentes, setores, fontes de dado, Databases e conjuntos, com os campos de cada um. ' +
      'Use antes de propor criar qualquer coisa — reaproveitar o que existe é sempre melhor que criar ao lado.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    risk: 'read',
    run: async () => {
      if (!inventory) return ok('não consegui ler o escritório agora. Proponha sem assumir que algo existe.')
      const linhas: string[] = []
      for (const [kind, secao] of Object.entries(inventory.sections)) {
        if (!secao?.items?.length) continue
        const itens = secao.items
          .map((i) => {
            const campos = String(i.meta?.fields ?? '').trim()
            return `  - ${i.label}${campos ? ` (campos: ${campos})` : ''}`
          })
          .join('\n')
        linhas.push(`${kind} (${secao.total}${secao.truncated ? ', mostrando os primeiros' : ''}):\n${itens}`)
      }
      return ok(linhas.length ? linhas.join('\n\n') : 'esta conta ainda não tem nada criado.')
    },
  }
}

/**
 * PERGUNTAR encerra a rodada.
 *
 * É o mesmo desenho do `pedir_esclarecimento` do runtime: o agente não pausa esperando
 * resposta — ele devolve a pergunta e a execução termina. Para o Assistente, que é por
 * turnos, isso não é limitação: é a forma certa.
 */
function perguntar(rascunho: RascunhoDoPlano): ResolvedTool {
  return {
    name: 'perguntar',
    description:
      'Faça UMA pergunta ao dono e encerre a rodada. Use quando a informação que falta só ele tem — de onde vem o dado, ' +
      'qual campo resumir, por onde as pessoas falam com ele. Não use para o que você pode ler do inventário. ' +
      'Ofereça opções sempre que a resposta for uma escolha fechada: opção clicável chega ao servidor com a chave certa.',
    inputSchema: {
      type: 'object',
      properties: {
        chave: { type: 'string', description: 'Identificador estável da pergunta, em minúsculas com hífen. Ex.: "origem-do-preco".' },
        texto: { type: 'string', description: 'A pergunta, em português, do jeito que o dono fala.' },
        opcoes: {
          type: 'array',
          description: 'As escolhas possíveis, quando forem fechadas. Vazio para pergunta aberta.',
          items: {
            type: 'object',
            properties: { value: { type: 'string' }, label: { type: 'string' } },
            required: ['value', 'label'],
          },
        },
      },
      required: ['chave', 'texto'],
    },
    risk: 'read',
    run: async (args) => {
      const chave = texto(args.chave, 60).toLowerCase().replace(/[^a-z0-9:-]/g, '-')
      const pergunta = texto(args.texto, 600)
      if (!chave) return recusado('a pergunta precisa de uma chave', 'use algo estável como "origem-do-preco"')
      if (!pergunta) return recusado('a pergunta está vazia')
      // Uma por rodada: a segunda resposta quase sempre muda a terceira pergunta, e perguntar
      // as duas juntas parece eficiente e produz retrabalho.
      if (rascunho.pergunta) return recusado('já há uma pergunta nesta rodada', 'uma por vez: a resposta desta pode mudar a próxima')
      const opcoes = (Array.isArray(args.opcoes) ? args.opcoes : [])
        .slice(0, 6)
        .map((o) => (o && typeof o === 'object' ? { value: texto((o as Record<string, unknown>).value, 60), label: texto((o as Record<string, unknown>).label, 120) } : null))
        .filter((o): o is { value: string; label: string } => Boolean(o?.value && o?.label))
      rascunho.pergunta = { chave, texto: pergunta, opcoes }
      return ok(`pergunta registrada. Encerre a rodada agora: escreva o texto para o dono e não chame mais nenhuma ferramenta.`)
    },
  }
}

/**
 * PROPOR UMA SÉRIE RESUMIDA — mínimo, máximo, média, soma, contagem por janela de tempo.
 *
 * As sete contas rodam no motor de Históricos, sem função a cadastrar e sem modelo no
 * caminho. O que a ferramenta cobra é o que o motor cobra: tamanho de janela, campo que
 * existe, e conta da lista fechada.
 */
function proporJanela(rascunho: RascunhoDoPlano, inventory: OfficeInventory | null): ResolvedTool {
  return {
    name: 'propor_janela',
    description:
      'Proponha guardar o resumo de um número por janela de tempo: mínimo, máximo, média, soma, contagem, primeiro ou último. ' +
      'Serve para "o menor e o maior preço a cada 5 minutos", "a média da temperatura por hora", "quantos pedidos por dia". ' +
      'NÃO serve para guardar cada leitura — isso é outra coisa. ' +
      'O campo tem de ser um NÚMERO que existe na fonte; nunca um carimbo de tempo, porque resumir o relógio grava uma série que parece certa e mente.',
    inputSchema: {
      type: 'object',
      properties: {
        fonte: { type: 'string', description: 'De onde o dado vem, pelo nome que o dono usa. Confira em ver_inventario.' },
        campo: { type: 'string', description: 'O campo numérico a resumir. Tem de existir na fonte.' },
        intervaloMs: { type: 'number', description: 'O tamanho da janela em milissegundos. 5 minutos = 300000.' },
        contas: {
          type: 'array',
          description: `Quais contas gravar. Uma ou mais de: ${CONTAS.join(', ')}.`,
          items: { type: 'string', enum: CONTAS },
        },
      },
      required: ['fonte', 'campo', 'intervaloMs', 'contas'],
    },
    risk: 'write',
    run: async (args) => {
      const fonte = texto(args.fonte, 120)
      const campo = texto(args.campo, 60)
      const everyMs = Math.round(Number(args.intervaloMs ?? 0))
      const contas = (Array.isArray(args.contas) ? args.contas : []).map((c) => texto(c, 12).toLowerCase()).filter((c) => CONTAS.includes(c))

      if (!campo) return recusado('a janela não diz qual campo resumir', 'sem isso ela gravaria a conta de um número que ninguém escolheu')
      if (!Number.isFinite(everyMs) || everyMs <= 0) return recusado('a janela precisa de um tamanho', '5 minutos são 300000 milissegundos')
      if (!contas.length) return recusado('sem regra, a janela fecharia num objeto vazio', `escolha entre ${CONTAS.join(', ')}`)

      /**
       * O CARIMBO DE TEMPO é recusado aqui, e não depois.
       *
       * Resumir o instante em vez do valor é o erro que não quebra nada: a série nasce, os
       * números batem entre si, e o gráfico mente em silêncio. Vale gastar uma recusa.
       */
      if (/(timestamp|data|hora|horario|instante|momento|inicio|fim|janela|periodo|date|time|_(em|at|date|time)$)/i.test(campo)) {
        return recusado(`"${campo}" parece um carimbo de tempo`, 'resuma o número, não o relógio')
      }

      // O campo tem de existir na fonte, quando a conta já a conhece. Um campo inventado
      // grava uma coluna vazia para sempre.
      const daConta = [...(inventory?.sections.source?.items ?? []), ...(inventory?.sections.dataset?.items ?? [])]
      const achada = daConta.find((i) => normalizar(i.label) === normalizar(fonte) || normalizar(fonte).includes(normalizar(i.label)))
      if (achada) {
        const campos = String(achada.meta?.fields ?? '')
          .split(/[,;\s]+/)
          .map((c) => c.trim())
          .filter(Boolean)
        if (campos.length && !campos.some((c) => normalizar(c) === normalizar(campo))) {
          return recusado(`"${achada.label}" não tem o campo "${campo}"`, `os campos dela são: ${campos.join(', ')}`)
        }
      }

      if (rascunho.janelas.some((j) => normalizar(j.source) === normalizar(fonte) && j.everyMs === everyMs)) {
        return recusado('esta fonte já tem uma janela deste tamanho nesta rodada', 'duas séries iguais gravariam a mesma linha duas vezes')
      }

      rascunho.janelas.push({ source: fonte, field: campo, everyMs, ops: [...new Set(contas)] })
      const minutos = everyMs >= 60_000 ? `${Math.round(everyMs / 60_000)} min` : `${Math.round(everyMs / 1000)}s`
      return ok(`série anotada no plano: ${contas.map((c) => NOME_DA_CONTA[c]).join(' e ')} de "${campo}" a cada ${minutos}. Nada foi criado ainda.`)
    },
  }
}

const normalizar = (t: string): string =>
  String(t ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')

/**
 * PROPOR UM DATABASE — onde o dado fica guardado.
 *
 * O mais simples dos recursos: não depende de nada e é o único que nasce ligado. Por isso
 * ele carrega uma regra que os outros não têm — quem não ganha concessão não alcança a base.
 * Uma base sem `agentKeys` nasce inalcançável, e isso não parece defeito nenhum até alguém
 * perguntar por que o agente não lê o que ele mesmo gravou.
 */
function proporDatabase(rascunho: RascunhoDoPlano, inventory: OfficeInventory | null): ResolvedTool {
  return {
    name: 'propor_database',
    description:
      'Proponha um lugar para guardar dado que precisa ficar e ser consultado depois. ' +
      'Antes de propor, confira em ver_inventario se já existe um que sirva: expandir o que existe é sempre melhor que criar ao lado. ' +
      'Quem não estiver em "agentes" não alcança a base — sem isso ela nasce inalcançável.',
    inputSchema: {
      type: 'object',
      properties: {
        nome: { type: 'string', description: 'Como o dono chama isto. Único na conta, de 1 a 120 caracteres.' },
        descricao: { type: 'string', description: 'Uma linha sobre o que fica guardado aqui.' },
        tipo: {
          type: 'string',
          enum: [...ADAPTERS],
          description: 'data_history para série de eventos e leituras (o caso comum); market_data para cotação; external_app para base de um App.',
        },
        agentes: { type: 'array', items: { type: 'string' }, description: 'As chaves dos agentes deste plano que precisam alcançar esta base.' },
        acesso: { type: 'string', enum: ['read', 'write'], description: 'read consulta; write também grava. Escolha o menor que resolve.' },
        diasDeRetencao: { type: 'number', description: 'Por quantos dias guardar. Omita para guardar sem prazo.' },
      },
      required: ['nome', 'tipo'],
    },
    risk: 'write',
    run: async (args) => {
      const nome = texto(args.nome, 120)
      const tipo = texto(args.tipo, 40) || 'data_history'
      if (!nome) return recusado('o Database precisa de um nome', 'de 1 a 120 caracteres')
      if (!ADAPTERS.includes(tipo)) return recusado(`"${tipo}" não é um tipo de Database`, `os tipos são: ${ADAPTERS.join(', ')}`)

      // Um nome que já existe na conta não vira base nova: o domínio recusa por índice
      // único, e descobrir isso só na aplicação desperdiça a aprovação do dono.
      const existente = (inventory?.sections.database?.items ?? []).find((i) => normalizar(i.label) === normalizar(nome))
      if (existente) return recusado(`já existe um Database chamado "${existente.label}"`, 'use ver_inventario e proponha gravar nele, ou escolha outro nome')
      if (rascunho.databases.some((d) => normalizar(d.nome) === normalizar(nome))) return recusado('este plano já propõe um Database com esse nome')

      const agentes = (Array.isArray(args.agentes) ? args.agentes : []).map((a) => texto(a, 60)).filter(Boolean)
      const acesso = texto(args.acesso, 10) === 'write' ? 'write' : 'read'
      const dias = Number(args.diasDeRetencao)
      rascunho.databases.push({
        chave: chaveDe(nome, 'base'),
        nome,
        descricao: texto(args.descricao, 300),
        tipo,
        agentes,
        acesso,
        ...(Number.isFinite(dias) && dias > 0 ? { diasDeRetencao: Math.round(dias) } : {}),
      })
      const aviso = agentes.length ? '' : ' Nenhum agente foi listado: ela nasce inalcançável até alguém receber acesso.'
      return ok(`Database anotado no plano: "${nome}".${aviso} Nada foi criado ainda.`)
    },
  }
}

/**
 * PROPOR UM CONJUNTO — a forma de uma linha dentro do Database.
 *
 * O schema não é burocracia: é ele que a consulta e a condição do monitor leem. Um conjunto
 * sem `properties` não pode ser consultado nem observado, e o domínio recusa de propósito.
 */
function proporConjunto(rascunho: RascunhoDoPlano): ResolvedTool {
  return {
    name: 'propor_conjunto',
    description:
      'Proponha a forma das linhas dentro de um Database: quais campos existem e de que tipo. ' +
      'Sem campos declarados o conjunto não pode ser consultado nem observado por um monitor — declare todos os que serão gravados.',
    inputSchema: {
      type: 'object',
      properties: {
        databaseNome: { type: 'string', description: 'O nome do Database proposto onde este conjunto mora.' },
        chave: { type: 'string', description: 'Identificador do conjunto: minúsculas, números e _ (até 60).' },
        nome: { type: 'string', description: 'Como o dono chama este conjunto.' },
        campos: {
          type: 'array',
          description: 'Os campos de cada linha.',
          items: {
            type: 'object',
            properties: {
              nome: { type: 'string' },
              tipo: { type: 'string', enum: ['string', 'number', 'boolean'] },
            },
            required: ['nome', 'tipo'],
          },
        },
        podeEditar: { type: 'boolean', description: 'false (padrão) para série que só acrescenta; true quando linhas são corrigidas depois.' },
      },
      required: ['databaseNome', 'chave', 'nome', 'campos'],
    },
    risk: 'write',
    run: async (args) => {
      const databaseNome = texto(args.databaseNome, 120)
      const base = rascunho.databases.find((d) => normalizar(d.nome) === normalizar(databaseNome))
      if (!base) {
        const nomes = rascunho.databases.map((d) => `"${d.nome}"`).join(', ')
        return recusado(`"${databaseNome}" não é um Database deste plano`, nomes ? `os propostos são: ${nomes}` : 'proponha o Database antes do conjunto')
      }
      const chave = texto(args.chave, 60).toLowerCase().replace(/[^a-z0-9_]/g, '_')
      if (!chave) return recusado('o conjunto precisa de uma chave', 'minúsculas, números e _')
      const campos = (Array.isArray(args.campos) ? args.campos : [])
        .map((c) => (c && typeof c === 'object' ? { nome: texto((c as Record<string, unknown>).nome, 60), tipo: texto((c as Record<string, unknown>).tipo, 12) } : null))
        .filter((c): c is { nome: string; tipo: string } => Boolean(c?.nome) && ['string', 'number', 'boolean'].includes(c!.tipo))
      // Um conjunto que aceita tudo não pode ser consultado nem observado: a DSL só permite
      // o que o schema declara, e a condição do monitor é validada contra ele.
      if (!campos.length) return recusado('o conjunto não declara nenhum campo', 'sem campos ele não pode ser consultado nem observado por um monitor')
      if (rascunho.conjuntos.some((c) => c.databaseChave === base.chave && c.chave === chave)) {
        return recusado(`este Database já tem um conjunto "${chave}" neste plano`)
      }
      rascunho.conjuntos.push({
        databaseChave: base.chave,
        chave,
        nome: texto(args.nome, 120) || chave,
        campos,
        podeEditar: args.podeEditar === true,
      })
      return ok(`conjunto anotado em "${base.nome}": ${campos.map((c) => `${c.nome} (${c.tipo})`).join(', ')}. Nada foi criado ainda.`)
    },
  }
}

/**
 * PROPOR UMA FONTE — "toma esse link e configura pra mim".
 *
 * É a ferramenta com mais regra, e é onde a recusa que volta mais paga: são trinta e tantas
 * checagens de config, cadência e mapeamento, e cada uma tem uma frase que diz o que fazer.
 * Numa saída de uma chamada só, errar qualquer uma delas custava a rodada inteira.
 *
 * O `kind` vem primeiro de propósito: é ele que decide se a fonte tem endereço, se precisa de
 * conexão, e se ela é lida por consulta ou chega sozinha.
 */
function proporFonte(rascunho: RascunhoDoPlano): ResolvedTool {
  return {
    name: 'propor_fonte',
    description:
      'Proponha de onde um dado entra continuamente: um endereço de API, um feed RSS, uma página, um WebSocket. ' +
      'Escolha o tipo primeiro — ele decide se a fonte tem endereço e se ela é lida por consulta ou chega sozinha. ' +
      'A credencial NUNCA entra aqui: cabeçalho é só o nome, e o valor vem da conexão da conta. ' +
      'Se você não sabe quais campos a resposta traz, pergunte em vez de inventar: um campo mapeado errado grava uma coluna vazia para sempre.',
    inputSchema: {
      type: 'object',
      properties: {
        nome: { type: 'string', description: 'Como o dono chama esta origem. Único na conta.' },
        tipo: { type: 'string', enum: [...TIPOS_DE_FONTE], description: 'api_polling para um endereço consultado; rss para feed; http_page para página; websocket para fluxo que chega sozinho.' },
        endereco: { type: 'string', description: 'A URL, para os tipos que têm endereço. http ou https, sem usuário e senha embutidos.' },
        metodo: { type: 'string', enum: ['GET', 'POST'], description: 'Só para api_polling. GET é o padrão.' },
        cabecalhos: { type: 'array', items: { type: 'string' }, description: 'Só os NOMES dos cabeçalhos. O valor vem da conexão.' },
        intervaloMs: { type: 'number', description: 'De quanto em quanto tempo ler, para os tipos consultados. Entre 15000 e 86400000.' },
        campos: {
          type: 'array',
          description: 'O que ler da resposta: para onde vai (to) e de onde sai (from).',
          items: {
            type: 'object',
            properties: {
              to: { type: 'string', description: 'Nome do campo no registro. Letras, números e _.' },
              from: { type: 'string', description: 'Caminho na resposta. Ex.: "data.price".' },
              obrigatorio: { type: 'boolean', description: 'true quando a leitura não vale sem ele.' },
            },
            required: ['to', 'from'],
          },
        },
      },
      required: ['nome', 'tipo'],
    },
    risk: 'write',
    run: async (args) => {
      const nome = texto(args.nome, 120)
      const tipo = texto(args.tipo, 30)
      if (!nome) return recusado('dê um nome à fonte')
      const cap = KIND_CAPABILITIES[tipo as keyof typeof KIND_CAPABILITIES]
      if (!cap) return recusado(`"${tipo}" não é um tipo de fonte`, `os tipos são: ${TIPOS_DE_FONTE.join(', ')}`)

      const endereco = texto(args.endereco, 800)
      if (cap.needsUrl) {
        if (!endereco) return recusado(`uma fonte do tipo ${tipo} precisa do endereço`)
        let url: URL
        try {
          url = new URL(endereco)
        } catch {
          return recusado('o endereço não é uma URL válida', 'ele precisa começar com http:// ou https://')
        }
        if (!/^https?:$/.test(url.protocol)) return recusado('o endereço não é uma URL válida', 'só http e https')
        // Credencial no endereço vaza em log, em print e em qualquer lugar onde a URL apareça.
        if (url.username || url.password) return recusado('tire a credencial do endereço', 'use uma conexão da conta')
        for (const [k, v] of url.searchParams) {
          if (PARECE_SEGREDO.test(k) || VALOR_DE_SEGREDO.test(v)) {
            return recusado(`o parâmetro "${k}" parece uma credencial`, 'use uma conexão da conta')
          }
        }
      }

      const metodo = texto(args.metodo, 6).toUpperCase()
      if (metodo && tipo !== 'api_polling') return recusado(`método não faz parte de uma fonte do tipo ${tipo}`)
      if (metodo && !['GET', 'POST'].includes(metodo)) return recusado(`método "${metodo}" não é aceito`, 'GET ou POST')

      /**
       * A CADÊNCIA casada com o tipo.
       *
       * Uma fonte que chega sozinha não tem intervalo, e uma que é consultada não roda sem
       * um. Aceitar o par errado produz uma fonte que nunca lê e nunca avisa por quê.
       */
      const intervaloMs = Math.round(Number(args.intervaloMs ?? 0))
      if (cap.push && intervaloMs > 0) return recusado('esta fonte chega sozinha: ela não tem intervalo')
      if (cap.pull) {
        if (!intervaloMs) return recusado('esta fonte é lida por consulta: diga de quanto em quanto tempo', 'entre 15000 e 86400000 milissegundos')
        if (intervaloMs < 15_000 || intervaloMs > 86_400_000) return recusado('o intervalo fica entre 15s e 24h')
      }

      const campos = (Array.isArray(args.campos) ? args.campos : [])
        .map((c) => {
          if (!c || typeof c !== 'object') return null
          const o = c as Record<string, unknown>
          return { to: texto(o.to, 60), from: texto(o.from, 200), required: o.obrigatorio === true }
        })
        .filter((c): c is { to: string; from: string; required: boolean } => Boolean(c?.to && c?.from))
      const nomeInvalido = campos.find((c) => !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(c.to))
      if (nomeInvalido) return recusado(`"${nomeInvalido.to}" não é um nome de campo válido`, 'letras, números e _, começando por letra')
      const repetido = campos.find((c, i) => campos.findIndex((x) => x.to === c.to) !== i)
      if (repetido) return recusado(`o campo "${repetido.to}" está mapeado duas vezes`)

      if (rascunho.fontes.some((f) => normalizar(f.nome) === normalizar(nome))) return recusado('este plano já propõe uma fonte com esse nome')

      const cabecalhos = (Array.isArray(args.cabecalhos) ? args.cabecalhos : [])
        .map((h) => texto(h, 60))
        .filter((h) => /^[A-Za-z][A-Za-z0-9-]{0,60}$/.test(h))
        .slice(0, 20)

      rascunho.fontes.push({ chave: chaveDe(nome, 'fonte'), nome, tipo, endereco, metodo: metodo || 'GET', cabecalhos, intervaloMs, campos })
      // Sem mapeamento a fonte ainda vale: ela vira pendência declarada, e o dono resolve.
      // Dizer isso aqui é o que impede o modelo de inventar campos para "completar".
      const falta = campos.length ? '' : ' Ela ainda não diz quais campos ler: isso vai como pendência, e o dono resolve na tela.'
      return ok(`fonte anotada no plano: "${nome}".${falta} Ela nasce rascunho — entra no ar só depois de testada. Nada foi criado ainda.`)
    },
  }
}

/**
 * PROPOR UM MONITOR — "me avise quando".
 *
 * A regra que mais importa aqui é que a condição só pode citar campo declarado: observar um
 * campo que não existe é um monitor que nunca dispara, e que não avisa que nunca vai disparar.
 */
function proporMonitor(rascunho: RascunhoDoPlano): ResolvedTool {
  return {
    name: 'propor_monitor',
    description:
      'Proponha uma vigilância sobre um conjunto: "avise quando o estoque cair de 10", "quando a temperatura passar de 8". ' +
      'A condição só pode citar campos que o conjunto declara. Um monitor sem Flow observa e não age — diga isso ao dono se for o caso.',
    inputSchema: {
      type: 'object',
      properties: {
        nome: { type: 'string', description: 'Como o dono chama esta vigilância.' },
        conjunto: { type: 'string', description: 'A chave do conjunto observado, entre os propostos neste plano.' },
        campo: { type: 'string', description: 'O campo comparado. Tem de estar declarado no conjunto.' },
        operador: { type: 'string', enum: [...OPERADORES], description: 'lt menor, lte menor ou igual, gt maior, gte maior ou igual, eq igual, ne diferente.' },
        valor: { type: 'number', description: 'O limiar comparado.' },
        modo: { type: 'string', enum: [...MODOS_DE_DISPARO], description: 'enter dispara ao entrar na condição (o comum); cross_up e cross_down exigem campo e limiar.' },
      },
      required: ['nome', 'conjunto', 'campo', 'operador', 'valor'],
    },
    risk: 'write',
    run: async (args) => {
      const nome = texto(args.nome, 160)
      if (!nome) return recusado('dê um nome ao monitor')
      const chaveConjunto = texto(args.conjunto, 60)
      const conjunto = rascunho.conjuntos.find((c) => c.chave === chaveConjunto || normalizar(c.nome) === normalizar(chaveConjunto))
      if (!conjunto) {
        const quais = rascunho.conjuntos.map((c) => `"${c.chave}"`).join(', ')
        return recusado(`"${chaveConjunto}" não é um conjunto deste plano`, quais ? `os propostos são: ${quais}` : 'proponha o conjunto antes do monitor')
      }
      const campo = texto(args.campo, 60)
      // O campo é validado contra o schema do conjunto, exatamente como o domínio faz — e
      // aqui, onde ainda dá para corrigir sem gastar a aprovação do dono.
      if (!conjunto.campos.some((c) => c.nome === campo)) {
        return recusado(`o campo "${campo}" não existe nesta fonte`, `os campos de "${conjunto.chave}" são: ${conjunto.campos.map((c) => c.nome).join(', ')}`)
      }
      const operador = texto(args.operador, 6)
      if (!OPERADORES.includes(operador)) return recusado(`operador "${operador}" não é permitido`, `use: ${OPERADORES.join(', ')}`)
      const valor = Number(args.valor)
      if (!Number.isFinite(valor)) return recusado('a condição precisa de um número para comparar', 'um limiar inventado dispara sempre ou nunca')
      const modo = texto(args.modo, 12) || 'enter'
      if (!MODOS_DE_DISPARO.includes(modo)) return recusado(`modo de disparo desconhecido: "${modo}"`, `use: ${MODOS_DE_DISPARO.join(', ')}`)

      rascunho.monitores.push({ chave: chaveDe(nome, 'monitor'), nome, conjuntoChave: conjunto.chave, campo, operador, valor, modo })
      return ok(`monitor anotado: "${nome}" observa ${campo} ${operador} ${valor} em "${conjunto.chave}". Ele nasce rascunho e ainda não age — sem um Flow, ele só observa. Nada foi criado ainda.`)
    },
  }
}

/**
 * PROPOR UM AGENTE — alguém que julga.
 *
 * As quatro recusas aqui não são burocracia: elas são a diferença entre um agente e uma
 * função. Se não dá para dizer QUANDO ele entra, O QUE recebe e O QUE entrega, o que está
 * sendo proposto não é um agente — é um cálculo procurando dono.
 */
function proporAgente(rascunho: RascunhoDoPlano): ResolvedTool {
  return {
    name: 'propor_agente',
    description:
      'Proponha alguém que INTERPRETA e DECIDE — não use para conta determinística, que é função, nem para gravar dado, que é histórico. ' +
      'Se você não consegue dizer quando ele entra, o que recebe e o que entrega, não é um agente. ' +
      'O que ele NÃO faz entra em "limites": é a parte que mais evita problema depois.',
    inputSchema: {
      type: 'object',
      properties: {
        nome: { type: 'string', description: 'Um nome de pessoa. O cargo fica no papel, não no nome.' },
        andar: { type: 'string', description: 'Onde ele trabalha. Use um andar que a conta já tem, se servir.' },
        papel: { type: 'string', description: 'A responsabilidade dele, em uma frase.' },
        quandoEntra: { type: 'string', description: 'O que faz este agente ser acionado. É a frase que o roteamento lê.' },
        recebe: { type: 'string', description: 'O que chega até ele.' },
        entrega: { type: 'string', description: 'O que sai dele.' },
        instrucoes: { type: 'string', description: 'Como ele deve trabalhar.' },
        limites: { type: 'array', items: { type: 'string' }, description: 'O que ele NUNCA deve fazer.' },
      },
      required: ['nome', 'andar', 'papel', 'quandoEntra', 'recebe', 'entrega'],
    },
    risk: 'write',
    run: async (args) => {
      const nome = texto(args.nome, 80)
      const papel = texto(args.papel, 300)
      const quandoEntra = texto(args.quandoEntra, 400)
      const recebe = texto(args.recebe, 300)
      const entrega = texto(args.entrega, 300)
      const andar = texto(args.andar, 120)
      if (!nome) return recusado('o agente precisa de um nome')
      if (!andar) return recusado('o agente precisa de um andar', 'diga onde ele trabalha')
      // Cada uma destas diz o que falta, e não "campo obrigatório": a frase é o que o modelo
      // usa para preencher certo na segunda tentativa.
      if (!papel) return recusado(`o agente "${nome}" está sem responsabilidade`)
      if (!quandoEntra) return recusado(`o agente "${nome}" não diz quando entra`, 'é a frase que o roteamento lê para escolher a quem mandar trabalho')
      if (!recebe) return recusado(`o agente "${nome}" não diz o que recebe`)
      if (!entrega) return recusado(`o agente "${nome}" não diz o que entrega`)
      if (rascunho.agentes.some((a) => normalizar(a.nome) === normalizar(nome))) return recusado(`este plano já propõe um agente chamado "${nome}"`)

      const limites = (Array.isArray(args.limites) ? args.limites : []).map((l) => texto(l, 200)).filter(Boolean).slice(0, 10)
      rascunho.agentes.push({
        chave: chaveDe(nome, 'agente'),
        nome,
        andar,
        papel,
        quandoEntra,
        recebe,
        entrega,
        instrucoes: texto(args.instrucoes, 2000),
        limites,
      })
      return ok(`agente anotado no plano: ${nome} — ${papel}. Nada foi criado ainda.`)
    },
  }
}

/**
 * PROPOR UM SETOR — quem trabalha junto.
 *
 * As duas regras que importam saem de `sectorReadiness`, que já sabe por que uma equipe não
 * roda: orquestrado sem coordenador não tem quem decida, e pipeline sem etapa não tem o que
 * fazer. Um setor assim é criado, aparece na tela e não trabalha.
 */
function proporSetor(rascunho: RascunhoDoPlano): ResolvedTool {
  return {
    name: 'propor_setor',
    description:
      'Proponha uma equipe: quem trabalha junto e como. ' +
      'organization é um grupo simples; orchestrated tem um coordenador que distribui; pipeline é uma sequência de etapas. ' +
      'Todos os membros têm de estar no MESMO andar do setor.',
    inputSchema: {
      type: 'object',
      properties: {
        nome: { type: 'string' },
        andar: { type: 'string', description: 'O andar onde a equipe fica.' },
        modo: { type: 'string', enum: ['organization', 'orchestrated', 'pipeline'] },
        membros: { type: 'array', items: { type: 'string' }, description: 'Os nomes dos agentes deste plano que fazem parte.' },
        coordenador: { type: 'string', description: 'Quem distribui o trabalho. Obrigatório em orchestrated.' },
        instrucao: { type: 'string', description: 'Como a equipe trabalha junta.' },
      },
      required: ['nome', 'andar', 'modo', 'membros'],
    },
    risk: 'write',
    run: async (args) => {
      const nome = texto(args.nome, 120)
      const modo = texto(args.modo, 20)
      const andar = texto(args.andar, 120)
      if (!nome) return recusado('o setor precisa de um nome')
      if (!andar) return recusado('o setor precisa de um andar')
      if (!['organization', 'orchestrated', 'pipeline'].includes(modo)) {
        return recusado(`"${modo}" não é um modo de setor`, 'organization, orchestrated ou pipeline')
      }
      const pedidos = (Array.isArray(args.membros) ? args.membros : []).map((m) => texto(m, 80)).filter(Boolean)
      const membros: string[] = []
      for (const m of pedidos) {
        const agente = rascunho.agentes.find((a) => normalizar(a.nome) === normalizar(m) || a.chave === m)
        if (!agente) {
          const quais = rascunho.agentes.map((a) => `"${a.nome}"`).join(', ')
          return recusado(`"${m}" não é um agente deste plano`, quais ? `os propostos são: ${quais}` : 'proponha os agentes antes do setor')
        }
        if (normalizar(agente.andar) !== normalizar(andar)) {
          return recusado(`"${agente.nome}" está no andar "${agente.andar}", e o setor está em "${andar}"`, 'um setor cujos membros ficam em outro andar não é válido')
        }
        membros.push(agente.chave)
      }
      if (!membros.length) return recusado('a equipe ainda não tem membros', 'um setor sem ninguém não trabalha')

      let coordenador = ''
      if (modo === 'orchestrated') {
        const pedido = texto(args.coordenador, 80)
        if (!pedido) return recusado(`o setor "${nome}" é orquestrado e não tem coordenador`, 'escolha quem distribui o trabalho')
        const agente = rascunho.agentes.find((a) => normalizar(a.nome) === normalizar(pedido) || a.chave === pedido)
        if (!agente) return recusado(`"${pedido}" não é um agente deste plano`)
        if (!membros.includes(agente.chave)) return recusado(`"${agente.nome}" coordena e não está na equipe`, 'inclua o coordenador entre os membros')
        if (membros.length < 2) return recusado('a equipe só tem o coordenador', 'não há a quem delegar')
        coordenador = agente.chave
      }

      rascunho.setores.push({ chave: chaveDe(nome, 'setor'), nome, andar, modo, membros, coordenador, instrucao: texto(args.instrucao, 1000) })
      return ok(`setor anotado: "${nome}" com ${membros.length} agente(s). Nada foi criado ainda.`)
    },
  }
}

/** Uma chave estável a partir do nome: o mesmo pedido dá a mesma chave. */
const chaveDe = (nome: string, prefixo: string): string =>
  `${prefixo}-${normalizar(nome).slice(0, 40) || 'sem-nome'}`.replace(/[^a-z0-9-]/g, '-').slice(0, 60)

/**
 * As ferramentas desta rodada.
 *
 * A ordem importa para quem lê o prompt: ler antes de propor, propor antes de perguntar.
 */
export function ferramentasDoAssistente(ctx: { inventory: OfficeInventory | null; rascunho: RascunhoDoPlano }): ResolvedTool[] {
  return [
    verInventario(ctx.inventory),
    proporDatabase(ctx.rascunho, ctx.inventory),
    proporConjunto(ctx.rascunho),
    proporAgente(ctx.rascunho),
    proporSetor(ctx.rascunho),
    proporFonte(ctx.rascunho),
    proporJanela(ctx.rascunho, ctx.inventory),
    proporMonitor(ctx.rascunho),
    perguntar(ctx.rascunho),
  ]
}
