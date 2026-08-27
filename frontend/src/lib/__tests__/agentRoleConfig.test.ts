// A tela pergunta ao SERVIDOR o que o agente pode fazer.
//
// Havia duas cópias da regra: uma no backend, que o motor lê, e outra aqui, que a tela
// lia. Duas cópias envelhecem em ritmos diferentes, e o resultado é sempre um dos dois
// defeitos: a tela esconde um campo que o motor usa — o dono não configura, e acontece
// assim mesmo —, ou oferece um campo que o motor ignora, e o dono configura uma coisa e
// vê outra. Agora `roleConfig` vem junto do agente, e a tabela local só serve para o
// agente que ainda não existe.
import { describe, expect, it } from 'vitest'
import { roleConfigOf, roleOfPreset, usesKnowledge } from '../agentCapabilities'
import type { RoleConfig } from '../agentCapabilities'

describe('a configuração vem do servidor', () => {
  it('quando o agente traz roleConfig, é ele que manda — não a tabela local', () => {
    // O servidor mudou de ideia sobre analistas. A tela obedece na hora, sem
    // precisar que este arquivo seja atualizado junto.
    const doServidor: RoleConfig = {
      role: 'analyst',
      sections: ['definicao', 'conhecimento', 'entrega'],
      allowedTools: true,
      allowedKnowledge: true,
      allowedWeb: true,
      allowedApps: true,
    }
    const cfg = roleConfigOf({ preset: 'analyst', roleConfig: doServidor })
    expect(cfg.allowedKnowledge).toBe(true)
    expect(cfg.sections).toContain('conhecimento')
  })

  it('sem resposta do servidor — agente ainda não criado — deriva pelo tipo', () => {
    expect(roleConfigOf({ preset: 'manager' }).allowedKnowledge).toBe(false)
    expect(roleConfigOf({ preset: 'researcher' }).allowedKnowledge).toBe(true)
  })
})

describe('cada papel desenha o que é dele', () => {
  it('1) coordenador: nenhuma seção de base, site, app ou ferramenta', () => {
    for (const preset of ['manager', 'secretary'] as const) {
      const cfg = roleConfigOf({ preset })
      expect(cfg.role).toBe('coordinator')
      expect(cfg.sections).toEqual(['definicao', 'orquestracao', 'roteamento'])
      expect(cfg.allowedTools).toBe(false)
      expect(cfg.allowedApps).toBe(false)
    }
  })

  it('2) analista: o que RECEBE e o que entrega — nada sobre onde buscar', () => {
    const cfg = roleConfigOf({ preset: 'analyst' })
    expect(cfg.sections).toContain('entrada')
    expect(cfg.sections).not.toContain('conhecimento')
    expect(cfg.sections).not.toContain('ferramentas')
  })

  it('3) pesquisador: base, sites e busca — e NENHUMA ferramenta de execução', () => {
    const cfg = roleConfigOf({ preset: 'researcher' })
    expect(cfg.sections).toEqual(expect.arrayContaining(['conhecimento', 'web', 'busca-web']))
    // Quem coleta levanta fatos e entrega; agir sobre o mundo é de quem executa.
    expect(cfg.sections).not.toContain('ferramentas')
    expect(cfg.allowedTools).toBe(false)
  })

  it('4) executor: ferramentas e o que precisa receber para agir', () => {
    const cfg = roleConfigOf({ preset: 'operator' })
    expect(cfg.sections).toEqual(expect.arrayContaining(['ferramentas', 'entrada', 'entrega']))
  })

  it('6) trocar o tipo troca os blocos na mesma hora', () => {
    // O agente gravado é pesquisador; o dono acabou de escolher "gerente" no formulário.
    // A resposta guardada descreve o agente ANTERIOR, então ela não vale mais.
    const gravado = roleConfigOf({ preset: 'researcher' })
    const escolhido = roleConfigOf({ preset: 'manager' })
    expect(gravado.sections).toContain('conhecimento')
    expect(escolhido.sections).not.toContain('conhecimento')
  })

  it('8) "quando chamar" e a definição existem em TODO papel', () => {
    for (const preset of ['researcher', 'analyst', 'manager', 'secretary', 'operator', 'communicator', 'monitor', 'custom'] as const) {
      expect(roleConfigOf({ preset }).sections).toContain('roteamento')
      expect(roleConfigOf({ preset }).sections).toContain('definicao')
    }
  })
})

describe('o que já estava configurado continua funcionando', () => {
  it('7) agente sem tipo declarado mantém tudo', () => {
    const cfg = roleConfigOf({})
    // Sem preset ele é PERSONALIZADO — a ausência de perfil, não um executor.
    expect(cfg.role).toBe('custom')
    expect(cfg.allowedKnowledge).toBe(true)
    expect(cfg.allowedTools).toBe(true)
    expect(roleOfPreset(null)).toBe('custom')
  })

  it('7b) o override incompatível NÃO traz o bloco de volta para a tela', () => {
    // A tela desenhava um controle que o motor ignoraria — o outro lado da mesma
    // brecha. Agora ela obedece ao mesmo teto de papel que o servidor.
    const cfg = roleConfigOf({ preset: 'analyst', knowledgeEnabled: true })
    expect(cfg.allowedKnowledge).toBe(false)
    expect(cfg.sections).not.toContain('conhecimento')
    expect(usesKnowledge('analyst', true)).toBe(false)
  })

  it('7c) desligar a base à mão não desliga as ferramentas', () => {
    const cfg = roleConfigOf({ preset: 'operator', knowledgeEnabled: false })
    expect(cfg.allowedKnowledge).toBe(false)
    expect(cfg.allowedTools).toBe(true)
  })
})
