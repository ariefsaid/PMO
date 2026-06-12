# PMO Portal — agent instructions

> **`CLAUDE.md` (repo root) is the single canonical source of project instructions — read it in full.**
> This file exists only because some tools auto-load `AGENTS.md`. It deliberately does **not** duplicate
> `CLAUDE.md` (a past forked copy drifted out of sync and corrupted its paths). If anything here seems to
> conflict with `CLAUDE.md`, `CLAUDE.md` wins. The operating model, architecture patterns, gates, and
> conventions all live there and in the docs it points to.

## Non-negotiables (the rules most expensive to get wrong — full detail in `CLAUDE.md`)

- **Per-issue intake gates (binding, in order):** (1) clarify with the owner → (1b) run the
  **`grill-with-docs`** alignment grill **before any spec effort** → (1c) UI issues also require an
  **owner-approved static HTML mockup** (full 3-lens design round, `docs/design-workflow.md` §1a) before
  Spec. Do **not** skip 1b/1c.
- **Operating model:** Owner → Director (main session) → role agents. One issue, one branch, one PR.
  Loop: Intake → Spec (SDD) → Plan → Build (TDD) → Review (spec + code-quality) → Secure → Accept (BDD) →
  Ship (release-engineer opens PR; **Director merges**). Full loop + rubric: `docs/director-playbook.md`.
- **Architecture (binding):** FE → typed **repository** (`src/lib/repositories/`) → Supabase; **never send
  `org_id` from the client** (RLS + defaults stamp it). `can()` is **UX-only**; **RLS is the enforcement
  authority** (ADR-0016). SoD / destructive rules enforced server-side via security-definer RPC + a pgTAP
  proof, not a hidden button (ADR-0019). Reference slice: `pmo-portal/pages/Companies.tsx` +
  `src/lib/db/companies.ts`.
- **Testing (ADR-0010):** each `AC-###` owned by **one** test at the lowest sufficient layer (Unit / pgTAP /
  curated e2e), AC-id-tagged. **BDD rule:** the app conforms to the test — fix the app, never bend the
  assertion to go green. Playwright runs from `pmo-portal/`.
- **Quality gates (block merge):** ≥80% changed-line coverage · `npm run typecheck` 0 · ESLint
  `--max-warnings=0` · unit · `npx playwright test` · `supabase test db` (pgTAP) all green.
- **Git:** branch off up-to-date `main`; **never force-push, never `git add -A`**; Director merges then
  `git reset --hard origin/main`. Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Current executor:** role-agent work is presently dispatched to the **pi CLI** (GLM/codex substrates),
  not Claude subagents — see `docs/pi-delegation.md`. This is a trial; the loop + gates above are unchanged.

Canonical docs: `CLAUDE.md` · `docs/director-playbook.md` · `docs/product-expectations.md` ·
`docs/design-workflow.md` · `docs/pi-delegation.md` · `docs/environments.md` · `docs/backlog.md` (live status).
Role agents live in `.claude/agents/`; vendored skills in `.claude/skills/` (gitignored, via `scripts/vendor-skills.sh`).
