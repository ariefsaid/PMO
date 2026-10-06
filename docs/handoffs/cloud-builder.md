# Cloud builder rules — one GitHub issue per run (PMO)

Repository: ariefsaid/PMO (PUBLIC). Start from the latest `dev`: `git fetch origin dev && git checkout -B <branch> origin/dev`.
Read `CLAUDE.md` first (public-repo rules, architecture patterns, test pyramid ADR-0010, AC tagging). The app is `pmo-portal/` (React 19 + Vite + TypeScript; pages at `pmo-portal/pages/`, DAL `src/lib/db/*`, repositories `src/lib/repositories/*`). Schema + RLS: `supabase/migrations/`, pgTAP in `supabase/tests/`, rollbacks in `supabase/migrations/rollback/`. Decisions: `docs/decisions.md`. Template slice: `pages/Companies.tsx` + `src/lib/db/companies.ts`.

Rules:
- No GitHub writes (no `gh issue`/`gh pr`/comments). Push only your branch `<branch>`. Never force-push.
- No `Co-Authored-By` or any attribution trailer. Commit style: `<type>(<area>): <what> (#<n>)`.
- Public repo: no secrets, hostnames, client or people's names, private paths.
- No database in this sandbox: do NOT start Supabase or run pgTAP/e2e. DO write the migration (next free number after the highest in `supabase/migrations/`, reversible, with its file in `rollback/`), RLS consistent with the table's existing policies, and the pgTAP test file — CI runs pgTAP on the PR. Hand-edit `pmo-portal/src/lib/supabase/database.types.ts` minimally to match your migration (it is regenerated later).
- Ponytail: smallest change that meets the acceptance; reuse shared primitives (`EntityFormModal`, `TextField`, `SelectField`, `Combobox`, `ConfirmDialog`, `can()`/`<CanWrite>`), existing repositories and formatters; no new dependencies; never touch `package-lock.json`.
- UI strictly `DESIGN.md` tokens; every new label in BOTH `pmo-portal/public/locales/en/common.json` and `id/common.json` (Bahasa Indonesia).
- Tests red-first at the cheapest layer; each AC id leads its owning test title; never weaken an assertion.

Verify (inside `pmo-portal/`): `npm ci`, `npm run typecheck`, `npx eslint --max-warnings=0 <touched files>`, `VITEST_MAX_THREADS=2 npx vitest run <affected test files>`, `npm run check:i18n`, `npm run build`. All must pass before you push.

Finish: commit, `git push origin <branch>`, and end your final message with exactly
`CLOUD-DONE <branch> <full HEAD sha>` plus the check output lines and the list of ACs → owning test, or `CLOUD-INCOMPLETE <exact state>`.

## The issue (#<n>)

Read the issue with `curl -s https://api.github.com/repos/ariefsaid/PMO/issues/<n>` (public; no auth needed). The prompt that launched you names `<branch>`, `<n>` and any Director notes — they override this file where they differ.
