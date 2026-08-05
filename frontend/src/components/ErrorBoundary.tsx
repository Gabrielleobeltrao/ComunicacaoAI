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
      <div className="min-h-screen bg-slate-950 p-6 text-slate-200">
        <div className="mx-auto max-w-2xl space-y-4">
          <h1 className="text-lg font-semibold text-red-400">Algo quebrou ao renderizar a tela</h1>
          <p className="text-sm text-slate-400">
            O erro abaixo interrompeu a interface. Recarregue a página; se continuar, mande esta mensagem.
          </p>
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-900 p-4 text-xs text-red-300">
            {error.message}
            {error.stack ? `\n\n${error.stack}` : ''}
          </pre>
          <button
            type="button"
            onClick={() => {
              this.setState({ error: null })
              window.location.reload()
            }}
            className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-200"
          >
            Recarregar
          </button>
        </div>
      </div>
    )
  }
}
