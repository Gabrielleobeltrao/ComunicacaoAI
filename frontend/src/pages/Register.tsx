import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router'
import { signUp } from '../lib/auth-client'
import { AuthScaffold } from '../components/AuthScaffold'
import { Button, Card, Field, Input } from '../ui'

export function Register() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setLoading(true)

    const { error: signUpError } = await signUp.email({ name, email, password })

    setLoading(false)

    if (signUpError) {
      setError(signUpError.message ?? 'Não foi possível criar a conta.')
      return
    }

    // Full reload so the session store is read fresh (with the cookie now set)
    // before ProtectedRoute checks it — a soft navigate races the stale session.
    window.location.href = '/dashboard'
  }

  return (
    <AuthScaffold title="Criar conta" subtitle="Monte seu escritório em menos de um minuto.">
      <form onSubmit={handleSubmit} style={{ width: '100%', maxWidth: 380 }}>
        <Card padding="22px" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="Nome">
            <Input
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Como podemos te chamar?"
              icon="user-round"
            />
          </Field>
          <Field label="E-mail">
            <Input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@empresa.com"
              icon="mail"
            />
          </Field>
          <Field label="Senha" hint="Mínimo de 8 caracteres">
            <Input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              icon="lock"
            />
          </Field>
          {error && <p style={{ fontSize: 13, color: 'var(--coral-600)' }}>{error}</p>}
          <Button type="submit" block size="lg" disabled={loading}>
            {loading ? 'Criando...' : 'Criar conta'}
          </Button>
          <span style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
            Já tem conta?{' '}
            <Link to="/login" style={{ fontWeight: 700 }}>
              Entrar
            </Link>
          </span>
        </Card>
      </form>
    </AuthScaffold>
  )
}
