# Plan: organisation terminology (#2529)

Spec: `docs/specs/org-terminology.spec.md`. Owning layer per AC: AC-TERM-001 pgTAP; -002/-003/-004 Vitest; -005 guard self-test.

1. `supabase/migrations/1024_org_terminology.sql` + rollback `1024_org_terminology_down.sql`; proof `supabase/tests/1024_org_terminology_rls.test.sql`.
2. `pmo-portal/src/lib/i18n/orgTerms.ts` (registry, `applyOrgTerms`, `withOrgTerms`) + tests.
3. `orgTermsPostProcessor` in `src/lib/i18n/index.ts` (`postProcess: ['orgTerms']`).
4. DAL `src/lib/db/orgTerminology.ts`, hook `src/hooks/useOrgTerminology.ts`, mounted in `I18nProvider`.
5. `pages/AdministrationTerminology.tsx`; section `terminology` in `pages/Administration.tsx`, `routeMatch.ts`, route in `App.tsx`; strings in `administration.json` (en, id).
6. `scripts/check-org-terms.mjs` + `scripts/org-terms-baseline.json`, wired into `check:guards`.
Verify: `npm run check:guards`, `npm run typecheck`, eslint on changed files, `npx vitest related --run <changed>`.
