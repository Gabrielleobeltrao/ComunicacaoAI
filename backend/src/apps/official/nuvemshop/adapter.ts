// Os adapters compilados deste App.
//
// Exportados pelo próprio módulo, e não listados num mapa central: um App novo passa a
// funcionar por existir, e um App sem adapter é detectado — ver official/index.ts.
import { nuvemshopTools } from '../../../providerApps.js'
import type { NativeFactory } from '../../types.js'

export const adapters: NativeFactory[] = [nuvemshopTools]
