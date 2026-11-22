# Plan: survey-cap-warn (front end only, no migration)
1. `pmo-portal/src/lib/progressBilling.ts`: add `claimableHeadroom` + tests in `progressBilling.test.ts` (AC-SCW-001..004).
2. `pmo-portal/src/lib/contractQuantityPrefill.ts`: BAST branch calls it.
3. `pmo-portal/pages/project-detail/ProgressClaimModal.tsx`: `overClaimHelper` passed as the NumberField `helper`; tests in `__tests__/ProgressClaimModal.test.tsx` (AC-SCW-005/006).
4. `pmo-portal/public/locales/{en,id}/projectTabs.json`: two keys each.
Verify: `npx vitest run` on the touched test files, typecheck, eslint, check:guards.
