// O App revogado precisa PARAR de atender — não só sumir do menu.
//
// Desativar o Chat Web tirava a navegação e mais nada: as rotas públicas continuavam de
// pé, o widget instalado no site do cliente continuava montando, e cada mensagem
// continuava chamando o modelo e gastando. "Revogado" virava um rótulo na tela do dono
// enquanto o mundo lá fora seguia igual.
//
// A verificação mora aqui, e não em cada rota, porque são três portas para a mesma casa:
// configuração, leitura e envio. Espalhar a regra é garantir que uma delas fique para
// trás na próxima mudança — e a que ficar para trás é a que continua gastando.
//
// O que NÃO acontece quando está inativo: nada é gravado e nada é gerado. Uma recusa que
// custa uma inferência não é uma recusa.
import { listInstallations } from './installations.js'

/** Estável, e por isso parte do contrato: a tela e o loader decidem por este código. */
export const WEB_CHAT_INACTIVE = 'web_chat_inactive'

export interface ChannelAccess {
  ok: boolean
  status?: number
  code?: string
  /** Segura por construção: nada sobre a conta do dono, nada sobre o motivo interno. */
  error?: string
}

/**
 * Este dono pode atender pelo Chat Web agora?
 *
 * `connected` é a única resposta positiva. `error` e `revoked` não atendem — a primeira
 * porque a integração está quebrada, a segunda porque alguém desligou de propósito.
 *
 * 410 e não 404: o widget EXISTIU e pode voltar a existir. 404 diria que a chave é
 * inválida, e mandaria o cliente procurar um erro de digitação que não existe.
 */
export async function webChatAccessFor(ownerId: string): Promise<ChannelAccess> {
  const instalacoes = await listInstallations(ownerId, 'web_chat').catch(() => [])
  if (instalacoes.some((i) => i.status === 'connected')) return { ok: true }
  return {
    ok: false,
    status: 410,
    code: WEB_CHAT_INACTIVE,
    error: 'Este chat está indisponível no momento.',
  }
}
