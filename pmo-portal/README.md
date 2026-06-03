# PMO Portal

Project & contract management portal for contract-/project-based organizations — a tender/bid
pipeline, procurement lifecycle, versioned budgets, timesheets, tasks, an incident register, and
document control. React 19 + Vite + TypeScript front end; **Supabase** (Postgres + Auth + RLS +
Storage) back end.

See the repo root [`CLAUDE.md`](../CLAUDE.md) for the development process (Owner → Director → role
agents; SDD → TDD → BDD), and [`docs/`](../docs) for specs, plans, and ADRs.

## Run locally

**Prerequisites:** Node.js 22+

1. Install dependencies: `npm install`
2. Configure Supabase env in `.env.local` (added during backend setup).
3. Run the app: `npm run dev`
