import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router'
import { signIn } from '../lib/auth-client'
import { AuthScaffold } from '../components/AuthScaffold'
import { Button, Card, Checkbox, Field, Input } from '../ui'

export function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setLoading(true)

    const { error: signInError } = await signIn.email({ email, password, rememberMe })

    setLoading(false)

    if (signInError) {
      setError(signInError.message ?? 'Não foi possível entrar.')
      return
    }

    // Full reload so the session store is read fresh (with the cookie now set)
    // before ProtectedRoute checks it — a soft navigate races the stale session.
    window.location.href = '/dashboard'
  }

  return (
    <AuthScaffold title="Entrar" subtitle="Seu escritório está te esperando.">
      <form onSubmit={handleSubmit} style={{ width: '100%', maxWidth: 380 }}>
        <Card padding="22px" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="E-mail">
            <Input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@empresa.com"
              icon="mail"
            />
          </Field>
          <Field label="Senha">
            <Input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              icon="lock"
            />
          </Field>
          <Checkbox checked={rememberMe} onChange={setRememberMe} label="Manter conectado" />
          {error && <p style={{ fontSize: 13, color: 'var(--coral-600)' }}>{error}</p>}
          <Button type="submit" block size="lg" disabled={loading}>
            {loading ? 'Entrando...' : 'Entrar'}
          </Button>
          <span style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
            Não tem conta?{' '}
            <Link to="/register" style={{ fontWeight: 700 }}>
              Criar conta
            </Link>
          </span>
        </Card>
      </form>
    </AuthScaffold>
  )
}
