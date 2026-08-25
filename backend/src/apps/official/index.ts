// Todos os Apps oficiais, montados a partir dos módulos.
//
// Antes desta divisão, `registry.ts` tinha os onze manifestos e `grants.ts` tinha um
// mapa `NATIVE_FACTORIES` escrito à mão. Eram duas listas para a mesma verdade, em
// arquivos diferentes: dava para adicionar um App e esquecer o adapter, e o sintoma
// aparecia só quando alguém tentava usar a ação — como uma recusa genérica de
// "configuração incompleta".
//
// Agora cada App é um módulo que exporta o que tem, e a incoerência é DETECTADA:
// manifesto que declara ação nativa sem adapter, ou dois módulos disputando a mesma
// key, param o processo no arranque em vez de virarem um bug de execução.
import * as alpaca from './alpaca/index.js'
import * as candleAnalyzer from './candle-analyzer/index.js'
import * as email from './email/index.js'
import * as google from './google/index.js'
import * as hubspot from './hubspot/index.js'
import * as mercadoPago from './mercado-pago/index.js'
import * as nuvemshop from './nuvemshop/index.js'
import * as rdStation from './rd-station/index.js'
import * as slack from './slack/index.js'
import * as stripe from './stripe/index.js'
import * as telegram from './telegram/index.js'
import * as webChat from './web-chat/index.js'
import * as whatsapp from './whatsapp/index.js'
import type { AppDefinition, NativeFactory } from '../types.js'

interface OfficialModule {
  manifest: AppDefinition
  adapters?: NativeFactory[]
}

// A ordem é a que o catálogo mostra, e é a mesma de antes da divisão.
const MODULES: OfficialModule[] = [google, slack, mercadoPago, rdStation, hubspot, stripe, nuvemshop, candleAnalyzer, alpaca, email, telegram, webChat, whatsapp]

export class OfficialAppsError extends Error {}

/**
 * Confere que os módulos formam um catálogo coerente.
 *
 * Roda no arranque e num teste. Falhar aqui é barato; falhar em produção é uma ação
 * que o dono concedeu, o agente tentou usar e recebeu uma recusa que não explica nada.
 */
export function assertOfficialAppsConsistent(modules: OfficialModule[] = MODULES): void {
  const vistas = new Set<string>()
  for (const mod of modules) {
    const key = mod.manifest?.key
    if (!key) throw new OfficialAppsError('um módulo de App oficial não declara `key`')
    if (vistas.has(key)) throw new OfficialAppsError(`dois módulos declaram o App "${key}"`)
    vistas.add(key)

    if (mod.manifest.source !== 'system') {
      throw new OfficialAppsError(`o App "${key}" está em official/ mas não é source=system`)
    }

    // Toda ação nativa precisa de um adapter que exista de fato. Um `adapter` apontando
    // para nada é o defeito que este arquivo existe para pegar.
    const nativas = mod.manifest.actions.filter((a) => a.execution.kind === 'native')
    if (nativas.length === 0) continue
    if (!mod.adapters?.length) {
      throw new OfficialAppsError(`o App "${key}" declara ação nativa mas não exporta adapter`)
    }
  }
}

assertOfficialAppsConsistent()

export const OFFICIAL_APPS: AppDefinition[] = MODULES.map((m) => m.manifest)

// Os adapters por App, do jeito que `grants.ts` consome — derivado dos módulos em vez
// de escrito à mão em outro arquivo.
export const OFFICIAL_ADAPTERS: Record<string, NativeFactory[]> = Object.fromEntries(
  MODULES.filter((m) => m.adapters?.length).map((m) => [m.manifest.key, m.adapters as NativeFactory[]]),
)
