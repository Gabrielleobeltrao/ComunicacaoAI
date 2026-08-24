// Os três pontinhos — a promessa de que uma resposta está vindo.
//
// No chat do visitante, o pedido some no instante em que é enviado: a mensagem dele
// aparece, e depois há silêncio até o agente responder. Esse silêncio dura o tempo de uma
// inferência, e às vezes de uma busca na web em cima dela — segundos em que a tela não
// diz nada e a pessoa não sabe se o chat travou, se ela precisa reenviar, ou se ninguém
// vai responder.
//
// O que os pontinhos NÃO dizem: em que fase o agente está. "Pensando", "pesquisando",
// "lendo a base" são o funcionamento interno do sistema, e o visitante é um estranho — o
// que ele precisa saber é que alguém está trabalhando na resposta dele.
export function TypingDots({ label = 'Digitando' }: { label?: string }) {
  return (
    <>
      <style>{`
        @keyframes pontinho {
          0%, 60%, 100% { opacity: .25; transform: translateY(0); }
          30% { opacity: 1; transform: translateY(-3px); }
        }
        .pontinho { animation: pontinho 1.2s var(--ease-standard, ease-in-out) infinite; }
        /* Quem pediu menos movimento recebe o mesmo aviso, sem o salto: o ponto pulsa. */
        @media (prefers-reduced-motion: reduce) {
          @keyframes pontinho { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
          .pontinho { animation-duration: 1.6s; transform: none !important; }
        }
      `}</style>
      {/* `aria-live` porque quem usa leitor de tela também precisa saber que a resposta
          está sendo preparada — para ele o silêncio é ainda mais silencioso. */}
      <div
        className="flex w-fit items-center gap-1 rounded-2xl rounded-tl-sm bg-slate-800 px-3 py-2.5"
        role="status"
        aria-live="polite"
        aria-label={label}
        data-testid="typing-dots"
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="pontinho block h-1.5 w-1.5 rounded-full bg-slate-400"
            style={{ animationDelay: `${i * 160}ms` }}
            aria-hidden
          />
        ))}
      </div>
    </>
  )
}
