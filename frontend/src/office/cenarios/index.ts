export * from './types'

import { cozinha } from './cozinha'
import { refeitorio } from './refeitorio'
import { reuniao } from './reuniao'
import { reuniaoGrande } from './reuniao-grande'
import { lounge } from './lounge'
import { auditorio } from './auditorio'
import { arquivo } from './arquivo'
import { foco } from './foco'
import { servidorPequeno } from './servidor-pequeno'
import { servidorGrande } from './servidor-grande'

/** Every ready-made office preset, in display order. */
export const CENARIOS = [cozinha, refeitorio, reuniao, reuniaoGrande, lounge, auditorio, arquivo, foco, servidorPequeno, servidorGrande] as const

export const cenarioById = Object.fromEntries(CENARIOS.map((c) => [c.id, c]))

export { cozinha } from './cozinha'
export { refeitorio } from './refeitorio'
export { reuniao } from './reuniao'
export { reuniaoGrande } from './reuniao-grande'
export { lounge } from './lounge'
export { auditorio } from './auditorio'
export { arquivo } from './arquivo'
export { foco } from './foco'
export { servidorPequeno } from './servidor-pequeno'
export { servidorGrande } from './servidor-grande'
