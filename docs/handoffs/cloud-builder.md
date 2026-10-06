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

DB checklist — each of these has turned a PR's CI red (you can't run them here, so get them right by reading):
- Every new table, security-definer function or storage bucket goes into `scripts/isolation-probe-denominator.json`, following the existing entries. CI's `check-isolation-denominator.mjs --self-test` fails otherwise.
- A new `storage.objects` policy that reads a table `anon` can't read needs `to authenticated`. Without a `TO` clause it is evaluated for anon on every bucket, and the other buckets' storage tests abort with "permission denied".
- In pgTAP, never put a data-modifying CTE inside a subquery (`select is((with u as (update … returning 1) …))`). Postgres rejects it and the file aborts partway through its plan. Run the update at top level, then assert on the stored row.
- A DAL type that restates a generated row type must follow your migration's nullability, or better, derive from `Tables<'…'>`. The shadow-types check in `verify` fails otherwise.
- A new PostgREST embed that crosses tables (e.g. `expense_claims -> profiles`) needs its entry in `supabase/tests/postgrest_embed_ambiguity_guard.test.sql`.

Verify (inside `pmo-portal/`): `npm ci`, `npm run typecheck`, `npx eslint --max-warnings=0 <touched files>`, `VITEST_MAX_THREADS=2 npx vitest run <affected test files>`, `npm run check:i18n`, `npm run build`. All must pass before you push.

Finish: commit, `git push origin <branch>`, and end your final message with exactly
`CLOUD-DONE <branch> <full HEAD sha>` plus the check output lines and the list of ACs → owning test, or `CLOUD-INCOMPLETE <exact state>`.

## The issue (#<n>)

Read the issue with `curl -s https://api.github.com/repos/ariefsaid/PMO/issues/<n>` (public; no auth needed). The prompt that launched you names `<branch>`, `<n>` and any Director notes — they override this file where they differ.
