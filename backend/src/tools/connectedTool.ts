// Uma ferramenta que empresta a conexão de um App.
//
// Sem `installationId` nada disto acontece: a ferramenta executa exatamente como sempre
// executou, com a própria URL e a própria credencial. É essa ausência que mantém toda
// ferramenta já criada funcionando sem reconfiguração.
//
// Com ele, a resolução acontece AQUI, no backend, no momento de executar — e não na hora
// de listar. Uma conexão revogada entre a listagem e a chamada precisa barrar a chamada, e
// só barra se for conferida no momento certo.
import { joinPath, resolveConnection } from '../apps/connectionProfile.js'
import type { ExecutableTool } from '../toolExecution.js'
import type { Tool } from '../tools.js'

export interface ConnectedToolRefusal {
  ok: false
  /** Frase para quem administra: diz o que fazer, e não conta o que está guardado. */
  message: string
}

export interface ConnectedToolReady {
  ok: true
  executable: ExecutableTool
  /** Todo cabeçalho vindo da conexão pode carregar credencial, seja qual for o nome. */
  allHeadersAreSecret: boolean
}

/**
 * A ferramenta pronta para executar.
 *
 * Devolve a própria ferramenta quando ela é manual — sem consulta ao banco, sem mudança
 * de comportamento e sem custo para quem nunca usou conexão.
 */
export async function resolveExecutableTool(tool: Tool, ownerId: string): Promise<ConnectedToolReady | ConnectedToolRefusal> {
  if (!tool.installationId) return { ok: true, executable: tool, allHeadersAreSecret: false }

  const conexao = await resolveConnection(ownerId, tool.installationId)
  if (!conexao.ok) return { ok: false, message: `"${tool.name}": ${conexao.message}` }

  const url = joinPath(conexao.baseUrl, tool.url)
  if (url === null) {
    // Um caminho absoluto seria a ferramenta escapando da conexão — apontando para onde
    // quisesse, com a credencial dela junto.
    return { ok: false, message: `"${tool.name}" está ligada a uma conexão: o endereço precisa ser um caminho, não uma URL completa.` }
  }

  return {
    ok: true,
    executable: {
      ...tool,
      url,
      // Os da CONEXÃO primeiro; os da ferramenta podem acrescentar. Um choque de nome é
      // resolvido a favor de quem escreveu a ferramenta, que é quem vê os dois.
      headers: [...conexao.headers, ...(tool.headers ?? [])],
      // A credencial é da conexão. A da ferramenta é ignorada de propósito: duas fontes de
      // autenticação na mesma chamada é a que estiver errada mandando em silêncio.
      auth: { kind: 'none' },
      // O App decide onde ele pode chegar, e isso vale mesmo que a ferramenta peça outro
      // domínio: quem autorizou a conexão viu esta lista antes de conectar.
      allowedDomains: conexao.allowedDomains,
    },
    allHeadersAreSecret: true,
  }
}

/** A recusa no formato que o modelo entende: a ação NÃO aconteceu. */
export const connectionRefusalResult = (toolName: string, message: string) => ({
  ok: false,
  result: JSON.stringify({
    status: 'capability_unavailable',
    executed: false,
    tool: toolName,
    reason: 'conexao_indisponivel',
    detail: message,
    instruction: 'A ação NÃO foi executada. Não afirme que foi.',
  }),
})
