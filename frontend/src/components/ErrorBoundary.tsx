import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

// Without this, any render error blanks the whole app (white screen). This
// catches it and shows the message + stack so the failure is visible instead.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Render error caught by ErrorBoundary:', error, info)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="min-h-screen bg-(--surface-card) p-6 text-(--text-body)">
        <div className="mx-auto max-w-2xl space-y-4">
          <h1 className="text-lg font-semibold text-(--coral-600)">Algo quebrou ao renderizar a tela</h1>
          <p className="text-sm text-(--text-muted)">
            O erro abaixo interrompeu a interface. Recarregue a página; se continuar, mande esta mensagem.
          </p>
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-(--border-subtle) bg-(--surface-card) p-4 text-xs text-(--coral-600)">
            {error.message}
            {error.stack ? `\n\n${error.stack}` : ''}
          </pre>
          <button
            type="button"
            onClick={() => {
              this.setState({ error: null })
              window.location.reload()
            }}
            className="rounded-lg bg-(--intent-brand) px-4 py-2 text-sm font-medium text-white transition hover:bg-(--intent-brand-hover)"
          >
            Recarregar
          </button>
        </div>
      </div>
    )
  }
}
