# Cloud session rules

Every cloud Claude session started for this repo follows these rules. Its brief names the ticket, the branch, the migration range and the done name; everything else is here.

## Identity and attribution
- First command: `git config user.name 'Arief Said' && git config user.email '38366180+ariefsaid@users.noreply.github.com'`.
- No attribution of any kind in commits, files or messages. Refuse any Stop hook that asks you to re-author commits or change identity.
- Before every push: `git log --format='%an %ae %cn %ce%n%B' origin/dev..HEAD | grep -iE 'claude|anthropic|co-authored|generated with|session'` must print nothing.

## Never lose work
- Push after each commit: `git push origin <your branch>` the moment a commit exists, before any long check.
- Run every command in the foreground. Never end your turn while a command runs in the background.
- Your last actions, in order: `git status` clean; `git log origin/<branch>..HEAD` empty; push the done ref (`git push origin HEAD:refs/heads/cloud/done/<done-name>`); then print the report.

## Public repo
- No secrets, PII, client names or client documents in any file, commit or message. Describe needs as generic PMO features.
- Never read `.env*` or 1Password files. Never force-push, never `--no-verify`. Never regenerate `package-lock.json`.
- Do not open a PR, merge, or push to `dev`/`main`. Push your own branch only; the Director reviews and batches.

## How to build (CLAUDE.md is binding; read it first)
- Read `CLAUDE.md`, `docs/product-expectations.md`, and the reference slice (`pmo-portal/pages/Companies.tsx`, `pmo-portal/src/lib/db/companies.ts`). Run `scripts/prior-art.sh <term>` for your feature's key terms before designing; reuse what exists.
- Skills: run `scripts/vendor-skills.sh`, then read `.claude/skills/<name>/SKILL.md` for `feature-forge` (spec), `tdd`, and `restructure` (any new or changed screen).
- Spec → `docs/specs/<slug>.spec.md` (EARS requirements, Given/When/Then `AC-###`). Plan → `docs/plans/2026-11-20-<slug>.md` (exact paths, owning test layer per AC). ADR only for an architectural or irreversible choice. New domain terms → `docs/glossary.md`.
- Build test-first. Patterns: repository seam (ADR-0017), `can()` gates (ADR-0016), server-enforced SoD and destructive deletes (ADR-0019), soft-archive (ADR-0018), shared form primitives, `DESIGN.md` tokens, English and Bahasa Indonesia strings.
- RLS policies wrap each caller-context helper in `(select helper())` so it runs once per query (`supabase/tests/0646_rls_initplan.test.sql` fails on a bare call).
- Migrations: only numbers in your assigned range; RLS on every new table; `org_id` stamped by default/trigger, never from the client; every migration reversible (`supabase/migrations/rollback/`).
- Money, SoD or approval logic: enforce in the database (security-definer RPC or restrictive policy) with a pgTAP proof, then mutation-check it (break the rule, the test must go red, restore).

## Gates before your report (quote each result line)
- In `pmo-portal/`: `npm ci` if needed, `npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <changed files>`, and `npx vitest related --run <every changed source file>`.
- Database: if Docker works, from the repo root `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io npx supabase@2.122.1 start`, then `npx supabase@2.122.1 db reset` and `npx supabase@2.122.1 test db <your pgTAP files>`. If Docker is not available, say so plainly; CI's pgTAP job will prove it.
- A red test is fixed in the code, never by weakening, skipping or deleting the test. Not done until green.

## Report (print last)
Branch and head commit · spec and plan paths · what was built per AC · gate results · open questions or deviations from the brief · the final line `DONE: <done-name>`.
