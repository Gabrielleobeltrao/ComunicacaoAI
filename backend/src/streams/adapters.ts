import { alpacaStreamAdapter } from '../apps/official/alpaca/stream.js'
import { hasStreamAdapter, registerStreamAdapter, streamAdapters } from './registry.js'

/**
 * Quem oferece dado de mercado em tempo real, registrado no CARREGAMENTO do módulo.
 *
 * Antes daqui o registro acontecia quando o motor de automações subia. Isso funcionava
 * para executar, e não para responder: uma instalação com `EMBEDDED_WORKER=false`
 * tinha uma API que não sabia dizer quais Apps têm streaming — e a tela, que pergunta
 * à API, oferecia "tempo real" para um App que não tem, ou escondia de um que tem.
 *
 * Registrar é só encher um mapa: não abre conexão, não lê banco e não custa nada.
 */
registerStreamAdapter(alpacaStreamAdapter)

/** Este App oferece stream? É o que decide se a tela mostra "Ativar tempo real". */
export { hasStreamAdapter }

export const streamableAppKeys = (): string[] => [...streamAdapters().keys()]
