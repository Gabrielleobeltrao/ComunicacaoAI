# ComunicacaoAI

A SaaS platform for managing goal-oriented AI communication agents, connected to embeddable chat widgets that businesses drop into their own sites.

> **Evolving into an operational building of AIs.** ComunicacaoAI is growing from a
> chat/attendance platform into a *prédio operacional*: **floors** with missions,
> **agents** that run **automations** (`trigger → run → deliverable → email/Telegram`)
> on a durable worker, while chat/widget/WhatsApp remain first-class **conversational
> channels**. The pivot ships behind feature flags (OFF by default) — nothing below
> changes until they're enabled. See
> [`docs/architecture/automation-pivot.md`](docs/architecture/automation-pivot.md) and
> [`AI_BUILDING_PIVOT_IMPLEMENTATION_REPORT.md`](AI_BUILDING_PIVOT_IMPLEMENTATION_REPORT.md).

## What it does

- **Agents** — create an AI agent with an objective/instructions, pick its LLM provider (Anthropic or OpenAI) and model, and give it a knowledge base (pasted text, `.txt`, `.pdf`, or images — extracted/transcribed automatically) for grounded, RAG-based answers.
- **Widgets** — create an embeddable chat widget, customize its color/position/avatar/welcome message, and pick which agent *or team* answers there. The same agent can be linked to any number of widgets. Drop a single `<script>` tag on any site to embed it.
- **Agent teams (orchestrator)** — group several specialist agents into a team a widget can point to; the visitor still talks to one seamless assistant (they never sense a switch). Two orchestration modes: **adaptive**, where a supervisor decides per message which specialists hold the answer (one or several), merges their knowledge bases into a single reply, or asks a natural, warm clarifying question when the ask is ambiguous; and **pipeline (staged flow)**, where the conversation moves through ordered stages that advance when a stage's condition is met and can also branch (A → B or C), skip ahead, or go back a stage as the topic changes. Shared team memory carries context across specialists, a team test playground shows which specialists/stage each reply used, and every routing decision is logged.
- **Chats** — every visitor conversation is isolated per-visitor and streams to the owner in real time (Socket.IO), with a dedicated page to browse/filter and reply manually; team-answered conversations show an orchestration timeline of which specialists (or flow stage) handled each turn.
- **Conversation memory** — per agent, pick one memory strategy: freeform key-facts, structured key:value facts, or semantic search over past turns, plus how many recent messages get sent to the LLM per call.
- **Visitor identity** — optionally toggle identity capture and define custom fields (e.g. Name, Email) that the agent asks for conversationally (no blocking form, so it also works for future non-widget channels). Once captured, a visitor's memory follows them across devices/sessions instead of resetting every conversation. A separate per-agent setting controls whether a visitor's chat persists across visits in the same browser or always starts fresh.
- **Guardrails** — keep an agent on-topic with either a system-prompt instruction (free) or a pre-reply verification call that refuses out-of-scope messages before the main reply is generated.
- **Custom structured-data extraction** — define your own field schema (e.g. Orçamento, Urgência) that the agent extracts from the conversation in the background, optionally delivered to an external system via webhook whenever the data changes — useful for qualifying leads.
- **Response style** — tune tone (neutral/friendly/formal/enthusiastic), detail level, reply language (pt/en/es/auto), emoji use, and markdown formatting per agent; replies render as real markdown (bold, lists) in both the widget and the owner's Chats view.
- **Human handoff** — the agent detects "this needs a person" (explicit request, frustration, out-of-scope case), says so, and goes silent; the conversation is flagged in Chats where the owner can take over and later hand it back to the agent.
- **Proactive selling** — an optional first message the agent opens with, plus owner-written upsell guidance (combos, promotions) the agent weaves into the conversation, grounded in the knowledge base.
- **Test playground** — chat with any agent directly from the panel (nothing persisted, no memory) to iterate on objective/style/guardrails before going live.
- **Dashboard** — real metrics: conversations and messages this week, qualified leads, conversations awaiting a human, attendance rate, and token spend — plus per-team analytics (most-consulted specialists / per-stage activity, clarify rate, and flow moves) built from the orchestration decision log.
- **Cost controls** — per-agent toggles to run background calls (memory, extraction, guardrail) on a cheap model and to cache the static prompt prefix; token usage is tracked per owner with an optional monthly cap that halts auto-replies when exceeded.
- **Anti-abuse limit** — optional per-visitor daily message cap on the public widget, rejected before any storage or LLM call.
- **BYOK** — users can store their own Anthropic/OpenAI API key (encrypted at rest), which takes priority over the platform's fallback key.

## Tech stack

**Frontend** (`frontend/`)
- React 19 + TypeScript, Vite, Tailwind CSS
- React Router (`react-router`)
- `better-auth/react` client
- `socket.io-client` for realtime chat delivery

**Backend** (`backend/`)
- Node.js + TypeScript, Express 5
- MongoDB Atlas (official `mongodb` driver), including Atlas Vector Search for RAG and semantic memory
- Better Auth (email/password, MongoDB adapter)
- Socket.IO for realtime message delivery
- `@anthropic-ai/sdk` and `openai` — pluggable per agent
- Voyage AI (REST) for embeddings (knowledge base + semantic memory)
- Multer + `pdf-parse` for file uploads/extraction

The repo is an npm workspaces monorepo (`frontend` + `backend`), with a single lockfile at the root.

## Project structure

```
.
├── frontend/
│   └── src/
│       ├── lib/
│       │   ├── auth-client.ts          # better-auth/react client
│       │   ├── socket.ts               # shared Socket.IO client
│       │   ├── types.ts                # shared frontend types
│       │   └── useAgentsAndWidgets.ts  # shared agents/widgets data hook
│       ├── components/
│       │   ├── AgentManager.tsx        # agent create/edit popup — 7-step wizard (basics, style, memory, guardrails, identity, structured output, KB)
│       │   ├── TeamManager.tsx         # team create/edit (mode, members, pipeline stages + transitions) + team test playground
│       │   ├── WidgetManager.tsx       # widget create/edit popup (visual customization)
│       │   ├── ApiKeySettings.tsx      # SettingsModal — BYOK keys + monthly token cap, opened from the sidebar
│       │   ├── ConversationsPanel.tsx  # Chats page conversation list + reply UI + orchestration decision timeline
│       │   ├── MessageContent.tsx      # shared markdown-safe message renderer (widget + Chats)
│       │   ├── Sidebar.tsx, AppLayout.tsx  # collapsible sidebar (grouped sections + footer: settings/account/logout) + page layout
│       │   ├── Modal.tsx               # reusable popup
│       │   └── ProtectedRoute.tsx
│       └── pages/                      # Home, Login, Register, Dashboard, Agents, Teams, Widgets, Chats, Widget (public)
│   └── public/widget-loader.js         # embeddable script customers drop on their site
├── backend/
│   └── src/
│       ├── db.ts, auth.ts              # MongoDB client, Better Auth instance
│       ├── index.ts                    # Express app + all routes, Socket.IO wiring
│       ├── agents.ts, widgets.ts       # Agent/Widget data models
│       ├── teams.ts, teamDecisions.ts  # agent teams (members, mode, pipeline transitions) + orchestration decision log
│       ├── knowledge.ts, voyage.ts     # RAG knowledge base + embeddings
│       ├── conversationMemory.ts       # per-conversation facts/structured memory, custom structured-output data, active specialist/stage
│       ├── conversationTurns.ts        # semantic memory (embedded turns + vector search)
│       ├── visitorProfiles.ts          # cross-conversation visitor identity + memory
│       ├── llm.ts, claude.ts, openai.ts, systemPrompt.ts  # provider-agnostic LLM layer (guardrails, response style, memory + orchestration prompts)
│       ├── crypto.ts, userSettings.ts  # BYOK key encryption/storage
│       └── fileExtraction.ts           # .txt/.pdf/image → text for the knowledge base
└── package.json                        # root workspace + `npm run dev`
```

## Getting started

Requirements: Node.js 22+, npm, and a MongoDB Atlas cluster (a free tier works, but Atlas Vector Search — used for RAG and semantic memory — requires an M10+ cluster or a shared cluster with Search enabled).

1. Install dependencies (from the repo root):
   ```
   npm install
   ```

2. Configure the backend environment — copy `backend/.env.example` to `backend/.env` and fill in:
   - `MONGODB_URI` — your MongoDB Atlas connection string
   - `BETTER_AUTH_SECRET` — any long random string
   - `BETTER_AUTH_URL` — `http://localhost:4000` for local dev
   - `CLIENT_URL` — `http://localhost:5173` for local dev
   - `ENCRYPTION_KEY` — any long random string (encrypts BYOK keys at rest; generate with `openssl rand -hex 32`)
   - `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` — optional platform-level fallback keys; users can set their own per account in Settings instead
   - `VOYAGE_API_KEY` — required for the knowledge base (RAG) and semantic memory to work; no BYOK for this one

3. Optionally configure the frontend — copy `frontend/.env.example` to `frontend/.env` if you need to point `VITE_API_URL` somewhere other than the default (the Vite dev server already proxies `/api` and `/socket.io` to the backend, so this is usually not required locally).

4. Run both apps together:
   ```
   npm run dev
   ```
   - Frontend: http://localhost:5173
   - Backend: http://localhost:4000

## Navigation (building & floors)

The app organizes work as a hierarchy — **Prédio → Andar → módulos** — with the URL as
the source of truth for the active floor. Set `VITE_AI_BUILDING_ENABLED=true` in
`frontend/.env` (flags are build-time; restart Vite). `/dashboard` is the building
overview (KPIs + floor cards); each floor at `/floors/:floorId` owns its visual office
map plus its agents, sectors, automations and runs, scoped by floor. Off/unset → the
original flat app (also the rollback). See [`docs/ux-nav/redirect-map.md`](docs/ux-nav/redirect-map.md).

## Dados de mercado e tempo real

Uma conexão de App pode virar uma fonte de tempo real. Hoje o único provedor é a
**Alpaca, em simulação (Paper)** — não existe endereço de produção compilado neste
sistema, e o ambiente `live` é recusado em quatro camadas.

**Como ligar, do começo ao fim:**

1. **Conectar** — *Apps → catálogo → Alpaca (simulação)*, com Key ID e Secret. A
   conexão nasce marcada como `SIMULAÇÃO`. *Testar conexão* faz uma leitura real na
   corretora (`GET /v2/account`), com prazo, e nunca devolve saldo nem credencial.
2. **Ligar o tempo real** — na aba *Conectados*, o botão **Ativar tempo real** pede os
   ativos. A partir daí dá para trocar a lista, pausar, reconectar e desligar. O painel
   mostra estado, última conexão, último dado e a última falha.
3. **Vincular uma ferramenta a uma conexão** — *Ferramentas → nova → Origem*. Só
   aparecem Apps que declaram perfil de conexão; a ferramenta guarda só o caminho, e
   base, cabeçalhos e credencial vêm da conexão na hora de executar.
4. **Conceder ao agente** — *agente → Como trabalha → Ferramentas*. A permissão é por
   ação. Ação `high_risk` (enviar, alterar, cancelar ordem, encerrar posição) exige uma
   autorização autônoma separada, e a tela mostra o ambiente e os limites em vigor
   antes de você marcar.
5. **Limitar** — *Apps → Conectados → Segurança*. As políticas são conferidas no
   servidor, imediatamente antes de a ordem sair. Salvar cria uma versão nova; a
   anterior fica no histórico.
6. **Reagir** — *agente → Fluxos → Novo gatilho → Evento de mercado*. Escolha o evento,
   os ativos e o período. Num modo sem IA a definição não contém etapa de agente: o
   fluxo roda com zero token.

**O que corre por baixo:** os negócios viram eventos internos (`market.price.updated`,
`market.quote.updated`, `market.bar.closed`), o motor monta as velas em seis períodos
(`1m`, `5m`, `15m`, `1h`, `4h`, `1D`) e publica `market.candle.closed` — cada vela uma
vez só, com retomada se o worker cair no meio. A análise reusa o App *Análise de
candles*; nenhum indicador foi reimplementado.

Todos os ajustes (`EVENT_*`, `STREAM_*`, `CANDLE_*`, `MARKET_*`, `ALPACA_*`) têm padrão
e estão documentados em [`backend/.env.example`](backend/.env.example). Nenhum deles é
obrigatório, e nenhum contém segredo: a credencial da corretora é do dono, digitada na
tela e guardada cifrada na conexão.

## WebSocket Genérico

Um App nativo para conectar **qualquer serviço que envie dados por WebSocket** — sem
escrever código. Ele reusa o mesmo gerenciador de streams da corretora, o mesmo
barramento durável de eventos e os mesmos gatilhos internos.

**Como ligar:**

1. **Conectar** — *Apps → catálogo → WebSocket Genérico*. Uma conta pode ter várias
   conexões.
2. **Configurar** — *WebSocket → Visão geral → Configurar*: endereço `wss://`, formato
   (JSON ou texto) e como o serviço autentica (nenhuma, cabeçalho, parâmetro no
   endereço ou primeira mensagem). Em *Avançado* ficam os caminhos de onde tirar
   conteúdo, identificador, canal e data, além de schema, filtros, deduplicação e
   limites. *Conferir endereço* valida antes de salvar.
3. **Ligar** — o botão **Ligar** abre a conexão; dá para pausar, retomar e desligar.
4. **Assinar** — *Assinaturas*: o que ouvir (canal, filtros e a mensagem de inscrição)
   e **o que fazer com o que chegar**: só guardar, memória (do agente, setor, andar ou
   prédio), rotina, agente ou setor. *Só guardar* é o padrão e não gasta token nenhum;
   cada destino diz o que custa antes de ser escolhido. A inscrição é enviada de
   verdade — ao conectar, a cada reconexão e assim que a assinatura é criada ou
   ativada —, e o cancelamento sai ao pausar ou remover. *Testar assinatura* abre uma
   conexão à parte, autentica, envia a inscrição, espera uma mensagem compatível e
   fecha tudo.

   **Agente e Setor executam pelo caminho canônico**: a assinatura cria um gatilho por
   evento — a mesma fila, idempotência, permissões, ferramentas, contabilidade de token
   e auditoria de qualquer outro. A relação fica à vista na assinatura, muda com ela e é
   arquivada quando ela é removida.
5. **Acompanhar** — *Mensagens* mostra o que chegou **e o que foi recusado, com o
   motivo** (filtrada, sem assinatura, inválida, repetida, acima do limite, falhou na
   entrega); *Logs* mostra conexão, reconexão, descarte e disparo.

**Sem assinatura não há evento.** Uma mensagem que nenhuma assinatura ativa reivindica
fica no histórico como *Sem assinatura* e para ali — publicar assim mesmo criaria um
fato que ninguém pediu. Quando mais de uma reivindica, **cada uma vira o seu próprio
evento**: assim uma falha na entrega de uma não impede a outra, e a retentativa de uma
não repete a outra.

Fixe no menu como o Chat Web: fixado, ele vira um grupo expansível com as quatro
páginas. Desfixar tira só a navegação — conexão, assinaturas e histórico ficam.

**O que ele não faz, de propósito:** não aceita expressão, JavaScript nem template
executável. Endereço, caminho, filtro e limite são dados; o servidor lê caminho de
objeto e compara texto, e nada além disso. Em produção só `wss://` é aceito, e
localhost, IP privado, link-local e metadata de nuvem são recusados. **Todos** os
endereços que o nome devolve são conferidos, e a conexão abre no endereço já conferido
(o nome continua indo à parte, para o SNI e o `Host` continuarem certos) — com o DNS
resolvido de novo a cada conexão e reconexão, que é o que fecha o rebinding.

Conteúdo que chega por aí é marcado como **não confiável** no evento, e um evento nunca
ganha ferramenta ou permissão além das que o agente responsável já tem.

Intervalo de ping e de silêncio são **por conexão** e valem de verdade no gerenciador;
o `.env` fica como padrão e como teto. Mudar endereço, autenticação, subprotocolo,
credencial ou intervalos reabre a conexão sozinho — filtro e caminho, que são lidos a
cada mensagem, não derrubam nada.

Os ajustes (`WS_*`, `STREAM_MAX_INTERVAL_MS`) estão em
[`backend/.env.example`](backend/.env.example).

## Scripts

Run from the repo root:

- `npm run dev` — runs the frontend and backend together (`concurrently`)
- `npm run build` — builds both workspaces

## Roadmap

- Booking/appointment capture (full calendar tool-calling)
- Additional chat channels beyond the embeddable widget (e.g. WhatsApp)
