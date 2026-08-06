// The agent detail page's sub-sections, shared by the sidebar and the page.
// '' is the index (Visão geral). The config is split so a common user only
// deals with "Essencial"; every technical knob lives under "Avançado".
export const AGENT_SECTIONS: { key: string; label: string }[] = [
  { key: '', label: 'Visão geral' },
  { key: 'testar', label: 'Testar' },
]

export const AGENT_CONFIG_SECTIONS: { key: string; label: string }[] = [
  { key: 'essencial', label: 'Essencial' },
  { key: 'ferramentas', label: 'Ferramentas' },
  { key: 'conhecimento', label: 'Base de conhecimento' },
  { key: 'avancado', label: 'Avançado' },
]
