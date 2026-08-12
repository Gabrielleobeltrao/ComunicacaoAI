// Deterministic template composition for the transform.template step. Only
// {{ variable }} substitution — NO arbitrary JavaScript (plan §11.7). Unknown
// variables fail loudly so a broken mapping never silently produces blanks.

export function renderTemplate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(vars, key)) {
      throw new Error(`Variável desconhecida no template: ${key}`)
    }
    const value = vars[key]
    if (value === null || value === undefined) return ''
    return typeof value === 'string' ? value : JSON.stringify(value)
  })
}
