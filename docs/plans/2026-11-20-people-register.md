# Plan — People register (#2542 follow-up)

Spec: `docs/specs/people-register.spec.md`. Branch `feat/2542b-people-register`, migration 1008 only.

| # | Task | Files | Owning layer / AC |
|---|---|---|---|
| 1 | Migration: `job_title`, per-org code generator trigger, grants | `supabase/migrations/1008_people_register.sql`, `rollback/1008_people_register_down.sql` | pgTAP AC-PPL-001..004 |
| 2 | pgTAP incl. second-org probe rows, mutation check | `supabase/tests/people_register.test.sql` | pgTAP |
| 3 | `person` entity in `can()` | `pmo-portal/src/auth/policy.ts` + test | Vitest AC-PPL-008 |
| 4 | DAL, repository, contract, hooks | `src/lib/db/people.ts`, `src/lib/repositories/{people,contracts/people}.ts`, `index.ts`, `types.ts`, `src/hooks/usePeople.ts` | Vitest AC-PPL-005..007,009 |
| 5 | Register screen + form + archive confirm; `people` Administration section; routes | `pages/admin/People.tsx`, `pages/Administration.tsx`, `App.tsx`, `routeMatch.ts` | Vitest |
| 6 | Strings en + id | `public/locales/{en,id}/administration.json` | Vitest bahasa AC-PPL-011 |
| 7 | Restructure pass, `ux-proof.sh` on the route | — | machine gate |
| 8 | One e2e journey: add person, add first document | `pmo-portal/e2e/AC-PPL-010-people-register.spec.ts` | Playwright AC-PPL-010 |
| 9 | Glossary entry, module-completeness route, probe denominator unchanged (`people` already listed) | `docs/glossary.md`, `scripts/check-module-completeness.mjs` | guards |

Decisions: code generator is a BEFORE INSERT trigger under a per-org advisory transaction lock, scanning all rows (archived too) so numbers are never reused; no counter table. No ADR (not architectural).
