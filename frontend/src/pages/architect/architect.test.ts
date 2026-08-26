// As partes puras da tela: rótulo de estado e a chave da operação.
//
// O resto — o que aparece, o que trava e o que a confirmação manda — é jornada, e
// está no Playwright, onde dá para exercitar de verdade. Um teste de render aqui
// exigiria um DOM que este projeto não usa em nenhum outro lugar.
import { describe, expect, it } from 'vitest'
import { STATUS_LABEL, statusTone, ACTION_LABEL, KIND_LABEL, CHECK_LABEL } from './shared'
import { idempotencyKeyFor } from '../../lib/architect'

describe('rótulos', () => {
  it('todo estado tem um nome em português, e nenhum vaza o termo técnico', () => {
    for (const [chave, rotulo] of Object.entries(STATUS_LABEL)) {
      expect(rotulo.length).toBeGreaterThan(0)
      expect(rotulo).not.toBe(chave)
    }
  })

  it('aplicado é sucesso, interrompido é perigo, pronta chama atenção', () => {
    expect(statusTone('applied')).toBe('success')
    expect(statusTone('failed')).toBe('danger')
    expect(statusTone('ready')).toBe('warning')
    expect(statusTone('discovery')).toBe('neutral')
  })

  it('“depende de você” não é apresentado como se fosse uma criação', () => {
    expect(ACTION_LABEL.wait_user).toMatch(/você/i)
    expect(ACTION_LABEL.create).toBe('Criar')
  })

  it('cada tipo de item e categoria tem nome próprio', () => {
    expect(new Set(Object.values(KIND_LABEL)).size).toBe(Object.keys(KIND_LABEL).length)
    expect(CHECK_LABEL.knowledge).toBe('Conhecimento')
  })
})

describe('chave da operação', () => {
  it('é estável para a mesma proposta: dois cliques viram uma aplicação', () => {
    expect(idempotencyKeyFor('p1', 'abcdef0123456789aa')).toBe(idempotencyKeyFor('p1', 'abcdef0123456789aa'))
  })

  it('muda quando a proposta muda: uma revisão nova não reaproveita o resultado antigo', () => {
    expect(idempotencyKeyFor('p1', 'aaaaaaaaaaaaaaaaaa')).not.toBe(idempotencyKeyFor('p1', 'bbbbbbbbbbbbbbbbbb'))
  })

  it('não mistura projetos', () => {
    expect(idempotencyKeyFor('p1', 'abcdef0123456789')).not.toBe(idempotencyKeyFor('p2', 'abcdef0123456789'))
  })
})
