// A FLAG do Blueprint V2 — e por que ela nasce desligada.
//
// O V2 acrescenta recursos e operações ao que a proposta desenha: Databases, fontes,
// monitores e Flows. Ligá-la por padrão mudaria, de uma vez, o que toda conta existente
// recebe ao continuar uma conversa antiga — e o caminho de volta seria um deploy, não uma
// variável.
//
// Desligada, nada muda: o projeto não ganha `blueprintV2`, a saga não roda o passo do V2 e
// o hash é exatamente o que já era. É isso que faz o rollback ser instantâneo.

/** `1`, `true` ou `on` ligam. Qualquer outra coisa — inclusive ausência — deixa desligado. */
export const architectV2Enabled = (): boolean => /^(1|true|on)$/i.test(String(process.env.ARCHITECT_BLUEPRINT_V2 ?? '').trim())
