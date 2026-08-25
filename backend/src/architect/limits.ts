// Os tetos, num arquivo só, porque quem valida e quem monta o prompt precisam
// concordar sobre eles. Um limite escrito duas vezes vira dois limites diferentes na
// primeira vez que alguém mexe num.
//
// Eles não são estéticos: o blueprint vem de um modelo, e um modelo pode devolver mil
// agentes. Sem teto, "aplicar" seria mil inserções que ninguém revisou.

export const MAX_FLOORS = 5
export const MAX_AGENTS = 20
export const MAX_SECTORS = 10
export const MAX_ROUTINES = 10
export const MAX_APP_REQUIREMENTS = 15
export const MAX_KNOWLEDGE_REQUIREMENTS = 25
export const MAX_CHECKLIST_ITEMS = 60
export const MAX_ASSUMPTIONS = 25
export const MAX_WARNINGS = 25
export const MAX_STAGES = 10
export const MAX_MEMBERS = 10
export const MAX_STEPS = 20
export const MAX_CAPABILITIES = 12

/** O total, para uma proposta não virar uma migração. */
export const MAX_TOTAL_RESOURCES = 50

export const MAX_KEY_CHARS = 60
export const MAX_NAME_CHARS = 80
export const MAX_SHORT_TEXT_CHARS = 500
export const MAX_LONG_TEXT_CHARS = 4000
export const MAX_TITLE_CHARS = 120
/** O conteúdo que o dono forneceu e vira documento de conhecimento. */
export const MAX_KNOWLEDGE_CONTENT_CHARS = 40_000
/** JSON Schema declarado no contrato de um agente, serializado. */
export const MAX_SCHEMA_BYTES = 8 * 1024

export const MAX_MESSAGE_CHARS = 4000
export const MAX_MESSAGES_PER_PROJECT = 200
export const MAX_PROJECTS_PER_OWNER = 50
export const MAX_ANSWERS = 40
export const MAX_ANSWER_CHARS = 2000
