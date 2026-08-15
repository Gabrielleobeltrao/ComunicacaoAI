// Portuguese is the SOURCE dictionary: every other locale is typed against it, so
// a key that exists here and nowhere else is a compile error, not a blank screen.
//
// Plurals use the `_one` / `_other` suffix pair and are picked by Intl.PluralRules
// — the platform already knows each language's rules, so we do not encode them.
export const pt = {
  // --- navegação ---------------------------------------------------------------
  'nav.dashboard': 'Painel',
  'nav.agents': 'Agentes',
  'nav.sectors': 'Setores',
  'nav.tools': 'Ferramentas',
  'nav.channels': 'Canais',
  'nav.settings': 'Configurações',
  'nav.openMenu': 'Abrir menu',
  'nav.closeMenu': 'Fechar menu',
  'nav.main': 'Navegação principal',

  // --- geral -------------------------------------------------------------------
  'common.save': 'Salvar',
  'common.cancel': 'Cancelar',
  'common.delete': 'Excluir',
  'common.edit': 'Editar',
  'common.duplicate': 'Duplicar',
  'common.test': 'Testar',
  'common.back': 'Voltar',
  'common.continue': 'Continuar',
  'common.loading': 'Carregando…',
  'common.saving': 'Salvando…',
  'common.retry': 'Tentar novamente',
  'common.enabled': 'Ativa',
  'common.disabled': 'Desativada',
  'common.required': 'Obrigatório',
  'common.optional': 'Opcional',
  'common.language': 'Idioma',

  // --- ferramentas -------------------------------------------------------------
  'tools.title': 'Ferramentas',
  'tools.subtitle': 'Conecte qualquer API para os seus agentes usarem.',
  'tools.new': 'Nova ferramenta',
  'tools.empty': 'Nenhuma ferramenta ainda. Crie uma para dar aos seus agentes acesso a um sistema externo.',
  'tools.name': 'Nome',
  'tools.namePlaceholder': 'consultar_pedido',
  'tools.nameHelp': 'Sem espaços. É assim que o agente chama a ferramenta.',
  'tools.description': 'Quando usar',
  'tools.descriptionPlaceholder': 'Consulta a situação de um pedido pelo número.',
  'tools.descriptionHelp': 'É isto que ensina o agente a decidir quando acionar. Seja específico.',
  'tools.method': 'Método',
  'tools.url': 'Endereço (URL)',
  'tools.parameters': 'O que o agente informa',
  'tools.addParameter': 'Adicionar campo',
  'tools.noParameters': 'Nenhum campo — o agente chama sem informar nada.',
  'tools.auth': 'Autenticação',
  'tools.auth.none': 'Nenhuma',
  'tools.auth.bearer': 'Token (Bearer)',
  'tools.auth.apiKey': 'Chave em cabeçalho',
  'tools.auth.basic': 'Usuário e senha',
  'tools.secretStored': 'Guardado com segurança. Nunca é mostrado de novo nem enviado ao modelo.',
  'tools.secretReplace': 'Substituir',
  'tools.timeout': 'Tempo limite (segundos)',
  'tools.usedBy_one': 'Usada por {{count}} agente',
  'tools.usedBy_other': 'Usada por {{count}} agentes',
  'tools.usedByNone': 'Nenhum agente usa esta ferramenta ainda.',
  'tools.testTitle': 'Testar ferramenta',
  'tools.testRun': 'Executar teste',
  'tools.testRequest': 'O que foi enviado',
  'tools.testResponse': 'O que voltou',
  'tools.testHint': 'Credenciais aparecem mascaradas — nem aqui elas são reveladas.',
  'tools.testConfirm': 'Este teste faz um {{method}} de verdade no sistema de destino. Continuar?',
  'tools.deleteConfirm': 'Excluir “{{name}}”? Os agentes que a usam perdem o acesso.',
  'tools.autonomy': 'Permitir que o agente execute sozinho',
  'tools.autonomyWarning': 'Este método ({{method}}) altera dados no sistema de destino. Marcado, o agente pode fazer isso por conta própria, sem pedir confirmação a ninguém.',
  'tools.autonomyBlocked': 'Sem esta autorização o agente não executa a ação — só você, testando aqui e confirmando.',

  // --- agentes -----------------------------------------------------------------
  'agents.tools': 'Ferramentas',
  'agents.toolsHelp': 'O agente só pode usar as ferramentas marcadas aqui.',
  'agents.noToolsAvailable': 'Nenhuma ferramenta criada ainda.',
} as const

type ExactKey = keyof typeof pt
// A plural pair is called by its BASE key (`tools.usedBy`), with the `_one`/`_other`
// variants chosen at runtime — so the base has to be part of the public key type.
type PluralBase<K> = K extends `${infer B}_one` ? B : never
export type TranslationKey = ExactKey | PluralBase<ExactKey>
