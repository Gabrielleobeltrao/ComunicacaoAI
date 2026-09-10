// AS FUNÇÕES COMO FERRAMENTA — o agente conseguindo chamar o que já existia.
//
// O registro era lido pelo catálogo do Assistente, pelo planejador de setor e pelo motor de
// Flow. Nunca por quem monta as ferramentas de um agente. As treze funções existiam, o modelo
// via o nome delas na proposta, e nenhum agente conseguia chamar nenhuma — ele calculava na
// própria cabeça, que é o oposto do motivo pelo qual elas existem: uma média que muda de valor
// entre duas perguntas iguais não é uma média.
//
// Só as que NÃO BUSCAM DADO entram. `data_history.range` abre o armazém e lê qualquer série da
// conta; entregá-la como ferramenta daria leitura irrestrita por fora do sistema de concessões
// — o mesmo sistema que decide, hoje, quem lê qual Database. Quem precisa de dado continua
// passando por `database_query`, com o grant daquele agente.

import { findFunction, listPublicFunctions } from './functionRegistry.js'
import type { ResolvedTool } from '../agentTools.js'

/**
 * O nome que o provedor aceita.
 *
 * Anthropic e OpenAI exigem `[a-zA-Z0-9_-]`, e metade do catálogo usa ponto
 * (`registros.buscar`, `data_history.range`). Mandar o nome com ponto faz a chamada ser
 * recusada pelo provedor — sem erro nosso, sem log nosso, e a ferramenta simplesmente não
 * existe para o modelo.
 */
export const nomeDeFerramenta = (functionName: string): string => functionName.replace(/\./g, '_')

/** O caminho de volta: do nome da ferramenta para a função registrada. */
const funcaoDe = (nomeDaFerramenta: string): ReturnType<typeof findFunction> => {
  const direto = findFunction(nomeDaFerramenta)
  if (direto) return direto
  for (const f of listPublicFunctions()) {
    if (nomeDeFerramenta(f.functionName) === nomeDaFerramenta) return findFunction(f.functionName)
  }
  return null
}

/**
 * As funções que um agente pode chamar.
 *
 * `risk: 'read'` porque nenhuma delas escreve nada nem sai para a rede: é conta sobre o que
 * ela recebeu. É o que permite o laço executá-las em paralelo quando o modelo pede duas.
 */
export function functionToolsFor(): ResolvedTool[] {
  return listPublicFunctions()
    .filter((f) => f.semAcessoADados === true)
    .map((f) => ({
      name: nomeDeFerramenta(f.functionName),
      description: `${f.description} Determinística: a mesma entrada dá sempre a mesma saída.`,
      inputSchema: f.inputSchema as Record<string, unknown>,
      risk: 'read' as const,
      run: async (args: Record<string, unknown>) => {
        const fn = funcaoDe(nomeDeFerramenta(f.functionName))
        if (!fn) return { ok: false, result: `recusado: a função "${f.functionName}" não está mais registrada nesta instalação` }
        try {
          const saida = await fn.handler(args, {}, { ownerId: '' })
          return { ok: true, result: JSON.stringify(saida) }
        } catch (erro) {
          /**
           * A RECUSA DELIBERADA volta como texto para o modelo, e não como falha.
           *
           * "Variação precisa de ao menos 2 pontos" é informação: ele pode buscar mais dados
           * e chamar de novo. Tratá-la como erro de execução encerraria a tarefa por uma
           * coisa que tem conserto na rodada seguinte.
           */
          const deliberado = (erro as { deliberado?: boolean }).deliberado === true
          const mensagem = String((erro as Error).message ?? 'a função falhou')
          return { ok: false, result: deliberado ? `recusado: ${mensagem}` : `a função não pôde ser calculada: ${mensagem}` }
        }
      },
    }))
}
