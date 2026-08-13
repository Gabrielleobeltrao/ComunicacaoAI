// Random, gender-coherent first names for auto-naming a new agent, in the agent's
// selected language (pt / en / es). Always a single first name of a chosen gender —
// never a mixed-gender or nonsense result.
type Lang = 'pt' | 'en' | 'es'

const NAMES: Record<Lang, { female: readonly string[]; male: readonly string[] }> = {
  pt: {
    female: ['Ana', 'Beatriz', 'Bruna', 'Camila', 'Carla', 'Clara', 'Fernanda', 'Gabriela', 'Helena', 'Isabela', 'Juliana', 'Larissa', 'Letícia', 'Mariana', 'Natália', 'Rafaela', 'Sofia', 'Vitória', 'Yara', 'Amanda'],
    male: ['André', 'Bruno', 'Caio', 'Daniel', 'Diego', 'Eduardo', 'Felipe', 'Gustavo', 'Henrique', 'João', 'Leonardo', 'Lucas', 'Marcos', 'Mateus', 'Pedro', 'Rafael', 'Rodrigo', 'Thiago', 'Vinícius', 'Murilo'],
  },
  en: {
    female: ['Emma', 'Olivia', 'Ava', 'Sophia', 'Isabella', 'Mia', 'Charlotte', 'Amelia', 'Harper', 'Evelyn', 'Emily', 'Grace', 'Chloe', 'Zoe', 'Lily', 'Hannah', 'Nora', 'Ella', 'Abigail', 'Scarlett'],
    male: ['Liam', 'Noah', 'Oliver', 'Elijah', 'James', 'William', 'Benjamin', 'Lucas', 'Henry', 'Alexander', 'Michael', 'Daniel', 'Jack', 'Samuel', 'David', 'Owen', 'Ethan', 'Nathan', 'Logan', 'Leo'],
  },
  es: {
    female: ['Sofía', 'Valentina', 'Isabella', 'Camila', 'Valeria', 'Mariana', 'Lucía', 'Martina', 'Daniela', 'Victoria', 'Gabriela', 'Sara', 'Julia', 'Paula', 'Elena', 'Andrea', 'Laura', 'Natalia', 'Carmen', 'Alba'],
    male: ['Santiago', 'Mateo', 'Sebastián', 'Leonardo', 'Matías', 'Diego', 'Alejandro', 'Nicolás', 'Samuel', 'Adrián', 'Álvaro', 'Javier', 'Carlos', 'Miguel', 'Pablo', 'Hugo', 'Marcos', 'Manuel', 'Daniel', 'Gonzalo'],
  },
}

const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]

export interface GeneratedName {
  name: string
  gender: 'female' | 'male'
}

/** A single random first name of a chosen gender, in `language` (falls back to pt
 *  for 'auto'/unknown). Pass the previous name to avoid regenerating the same one. */
export function randomAgentName(language: string, previous?: string): GeneratedName {
  const pools = NAMES[(language in NAMES ? language : 'pt') as Lang]
  let out: GeneratedName
  do {
    const gender: 'female' | 'male' = Math.random() < 0.5 ? 'female' : 'male'
    out = { name: pick(pools[gender]), gender }
  } while (previous && out.name === previous)
  return out
}
