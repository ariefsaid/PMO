# Plan: readable organization connector identity (#680)

**Spec:** `docs/specs/integration-connector-identity.spec.md`. **Executor:** bounded FE/UI slice → SSSF ADW `adws/adw_simple_sdlc.py --builder fe_builder --reviewer fe_reviewer` in a clean issue worktree off `dev` per `docs/factory-workflow.md`. The Director retains the final rendered review and binding gates. No schema or service-lifecycle change.

## Design seam

The organization card in `pmo-portal/src/components/integrations/IntegrationsView.tsx` already receives the stored actor and connection date. `useAssignableProfiles()` in `pmo-portal/src/hooks/useTasks.ts` reads the existing org-scoped `repositories.profile.listOrgProfiles()` and caches by organization. Reuse that read or extract an accurately named shared profile hook without bypassing the repository. Resolve `binding.connected_by` against the returned profile IDs. Render only a trimmed, nonempty `full_name`; otherwise render a translated neutral fallback. A profile-query pending/error state must not change the independent binding and health states. The card must never render the stored actor value directly.

## Tasks (red → green → refactor)

1. **Prove the person-readable card.** In `pmo-portal/src/components/integrations/IntegrationsView.test.tsx`, add `AC-ICI-001` with one binding actor and a matching org profile. Assert the name and existing date together, and assert the technical value is absent from the rendered card. Run the focused Vitest test and record red.
2. **Prove fallback and independent readiness.** In the same test file, add `AC-ICI-002/003` cases for removed identity, blank name, pending profile read, and failed profile read. Assert a neutral label, no raw actor, and that Connected/health and existing allowed actions remain accurate. Run focused Vitest and record red.
3. **Wire the existing profile source.** Update `pmo-portal/src/components/integrations/IntegrationsView.tsx` to consume the org-scoped profile hook, resolve only the binding's actor, and render the name/fallback beside `connected_at`. Keep current `CanWrite` and health-query boundaries unchanged. Add translation keys in `pmo-portal/public/locales/en/common.json` and `pmo-portal/public/locales/id/common.json`; do not introduce English literals in the Bahasa path. Run focused tests to green.
4. **Prove read-only and language behavior.** Add `AC-ICI-004` component assertions in `IntegrationsView.test.tsx` for a read-only viewer and English/Bahasa fallback copy. Preserve current action gates; test the name and no raw actor at 390px using the project's rendered UI workflow. Capture desktop and phone screenshots on rich seed and inspect wrapping, contrast, and accessible name; revise the component if the line clips.
5. **Review and gate.** Run spec, code-quality, and security review passes; security review confirms the org-scoped profile read and role gates. Run `npm run verify:locked` from `pmo-portal/` and inspect the full output, then run the required rendered Discover pass. Only after all gates are green, commit, push the issue branch, open one PR to `dev`, require GitHub `verify` and `pgtap` green, and merge per the repo's branch flow. No `main` or production promotion is in this issue.

## Traceability

| AC | Owner | Proof |
|---|---|---|
| AC-ICI-001 | Vitest component | Resolved name, date, no technical value |
| AC-ICI-002 | Vitest component | Removed/blank identity fallback |
| AC-ICI-003 | Vitest component | Pending/error profile read does not mask binding/health |
| AC-ICI-004 | Vitest component + rendered Discover | Role controls, both languages, desktop/390px |

The rendered review is a design gate; it does not replace the owning behavior tests. Do not weaken existing connection-readiness tests to accommodate this display change.
