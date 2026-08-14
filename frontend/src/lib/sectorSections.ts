// The sector detail page's sections, shared by the sidebar and the page.
// '' is the index (Visão geral). Named after what the user is looking for, not
// after the data model.
export const SECTOR_SECTIONS: { key: string; label: string }[] = [
  { key: '', label: 'Visão geral' },
  { key: 'equipe', label: 'Equipe e fluxo' },
  { key: 'conhecimento', label: 'Conhecimento' },
  { key: 'execucoes', label: 'Execuções' },
  { key: 'avancado', label: 'Avançado' },
]

// Old links (and bookmarks) keep working.
export const LEGACY_SECTOR_SECTION: Record<string, string> = {
  configuracao: 'equipe',
  membros: 'equipe',
  testar: 'execucoes',
  historico: 'execucoes',
}
