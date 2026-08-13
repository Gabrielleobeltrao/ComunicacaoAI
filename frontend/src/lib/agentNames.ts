// Random, gender-coherent agent names. A new agent gets an auto-generated name
// (the user no longer types one): pick a gender, then a first name of that gender
// plus a surname, so it always reads as a real person — never a mixed-gender or
// nonsensical result.
const FEMALE_FIRST = [
  'Ana', 'Beatriz', 'Bruna', 'Camila', 'Carla', 'Clara', 'Daniela', 'Fernanda', 'Gabriela', 'Helena',
  'Isabela', 'Juliana', 'Larissa', 'Letícia', 'Luana', 'Mariana', 'Natália', 'Patrícia', 'Rafaela', 'Sofia',
  'Tatiana', 'Vitória', 'Yara', 'Amanda', 'Carolina',
]
const MALE_FIRST = [
  'André', 'Bruno', 'Caio', 'Daniel', 'Diego', 'Eduardo', 'Felipe', 'Gustavo', 'Henrique', 'Igor',
  'João', 'Leonardo', 'Lucas', 'Marcos', 'Mateus', 'Otávio', 'Pedro', 'Rafael', 'Rodrigo', 'Thiago',
  'Vinícius', 'Bernardo', 'Murilo', 'Renato', 'Fábio',
]
const SURNAMES = [
  'Almeida', 'Barbosa', 'Carvalho', 'Costa', 'Dias', 'Ferreira', 'Gomes', 'Lima', 'Martins', 'Mendes',
  'Nunes', 'Oliveira', 'Pereira', 'Ribeiro', 'Rocha', 'Santos', 'Silva', 'Souza', 'Teixeira', 'Vieira',
]

const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]

export interface GeneratedName {
  name: string
  gender: 'female' | 'male'
}

/** A random "First Surname", gender-coherent. Pass the previous name to avoid
 *  regenerating the exact same one. */
export function randomAgentName(previous?: string): GeneratedName {
  let out: GeneratedName
  do {
    const gender: 'female' | 'male' = Math.random() < 0.5 ? 'female' : 'male'
    const first = pick(gender === 'female' ? FEMALE_FIRST : MALE_FIRST)
    out = { name: `${first} ${pick(SURNAMES)}`, gender }
  } while (previous && out.name === previous)
  return out
}
