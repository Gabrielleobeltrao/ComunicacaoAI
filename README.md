# ComunicacaoAI

A SaaS platform for managing goal-oriented communication agents. Agents are connected in chats where they ask questions and give answers, working together toward a defined objective.

## Status

Early-stage scaffold. Authentication (sign up, sign in, protected dashboard) is wired up end to end. Agent management and the objective-driven chat between agents are not implemented yet — the dashboard currently shows placeholder sections for "Objective", "Connected agents", and "Chat".

## Tech stack

**Frontend** (`frontend/`)
- React 19 + TypeScript
- Vite
- Tailwind CSS
- React Router (`react-router`)
- `better-auth/react` client

**Backend** (`backend/`)
- Node.js + TypeScript
- Express 5
- MongoDB Atlas (official `mongodb` driver)
- Better Auth (email/password, MongoDB adapter)

The repo is an npm workspaces monorepo (`frontend` + `backend`), with a single lockfile at the root.

## Project structure

```
.
├── frontend/   # React SPA
│   └── src/
│       ├── lib/auth-client.ts   # better-auth/react client
│       ├── components/          # ProtectedRoute, etc.
│       └── pages/                # Home, Login, Register, Dashboard
├── backend/    # Express API
│   └── src/
│       ├── db.ts     # MongoDB client/connection
│       ├── auth.ts   # Better Auth instance (mongodb adapter)
│       └── index.ts  # Express app, mounts /api/auth/*
└── package.json      # root workspace + `npm run dev`
```

## Getting started

Requirements: Node.js 22+, npm, and a MongoDB Atlas cluster (a free tier works).

1. Install dependencies (from the repo root):
   ```
   npm install
   ```

2. Configure the backend environment — copy `backend/.env.example` to `backend/.env` and fill in:
   - `MONGODB_URI` — your MongoDB Atlas connection string
   - `BETTER_AUTH_SECRET` — any long random string
   - `BETTER_AUTH_URL` — `http://localhost:4000` for local dev
   - `CLIENT_URL` — `http://localhost:5173` for local dev

3. Optionally configure the frontend — copy `frontend/.env.example` to `frontend/.env` if you need to point `VITE_API_URL` somewhere other than the default (the Vite dev server already proxies `/api` to the backend, so this is usually not required locally).

4. Run both apps together:
   ```
   npm run dev
   ```
   - Frontend: http://localhost:5173
   - Backend: http://localhost:4000

## Scripts

Run from the repo root:

- `npm run dev` — runs the frontend and backend together (`concurrently`)
- `npm run build` — builds both workspaces

## Roadmap

- Agent management (create/configure agents, assign objectives)
- Objective-driven chat orchestration between agents
- Real-time updates (e.g. Socket.IO) for the chat view
