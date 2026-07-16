import { Link } from 'react-router'

export function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-950 px-4 text-center text-white">
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
        Gerencie agentes de comunicação com um objetivo
      </h1>
      <p className="max-w-xl text-slate-400">
        Conecte agentes em chats, defina um objetivo e acompanhe as perguntas e
        respostas até chegar ao resultado que você precisa.
      </p>
      <div className="flex gap-4">
        <Link
          to="/login"
          className="rounded-lg bg-white px-5 py-2.5 font-medium text-slate-950 transition hover:bg-slate-200"
        >
          Entrar
        </Link>
        <Link
          to="/register"
          className="rounded-lg border border-slate-700 px-5 py-2.5 font-medium text-white transition hover:bg-slate-800"
        >
          Criar conta
        </Link>
      </div>
    </div>
  )
}
