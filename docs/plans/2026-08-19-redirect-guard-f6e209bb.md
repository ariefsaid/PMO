# Plan blocked — redirect-target guard

**Issue:** #486  
**Status:** blocked before implementation planning

## Why no implementation plan is being issued

The engineering-planner contract requires an approved feature spec with EARS requirements and `AC-###` acceptance criteria before behavior tasks can be planned. Issue #486 supplies implementation requirements and completion conditions, but no corresponding `docs/specs/*.spec.md` exists and it assigns no `AC-###` identifiers. Creating identifiers in this plan would invent acceptance criteria, which the contract prohibits.

There is also a source-scope conflict that must be resolved in that spec. The requested scan is stated as `supabase/functions/*/index.ts`, but a current frontend redirect target is constructed in `supabase/functions/m365-token-custody/callback.ts`, reached through an import from its entry point. A guard that reads only entrypoint text cannot see that target and could pass while failing its stated purpose.

## Required spec decisions

1. Create and owner-sign off `docs/specs/redirect-target-guard.spec.md`, with EARS requirements and uniquely numbered `AC-###` criteria for:
   - discovering every deployed edge-function entry point without a hard-coded function list;
   - identifying every frontend redirect target reachable from each discovered entry point, including local imported modules;
   - extracting the pathname from origin-plus-path target expressions while excluding query and fragment components from route matching;
   - matching static target path segments against frontend route patterns, including parameter segments, while rejecting a match that reaches only the `*` catch-all;
   - failing on an unresolvable target unless an explicit, reasoned allowlist entry covers it;
   - passing the real repository, failing a known-bad fixture, and running that polarity proof in CI;
   - running the guard only for pull requests whose base is `main`; and
   - documenting the expand-then-contract release rule.
2. State the accepted analysis boundary explicitly: **recommended:** recursively inspect statically resolvable relative TypeScript imports rooted at every discovered `supabase/functions/*/index.ts`, and report an unreadable/unresolvable local import as a failure. This covers entrypoint-owned redirect helpers without attempting to execute Deno code.
3. Specify the allowlist contract: its exact repository path, target/function identity fields, mandatory non-empty reason, and whether stale entries fail. The recommended design is a small, checked-in data file with exact source location plus reason and a stale-entry failure, so an unresolved target cannot become a silent permanent exception.

## Re-planning inputs and intended verification

Once the approved spec exists, re-run planning against the current code and CI layout. The implementation plan must use TDD-first tasks and map every behavior task to the approved `AC-###` ID. It will cover `scripts/check-redirect-targets.mjs`, its fixtures or Node tests, `pmo-portal/package.json`, `.github/workflows/ci.yml`, `scripts/ci-integration-order.test.mjs` if it is the repository CI-contract test owner, and the deploy section of `docs/environments.md`.

The resulting build plan will require these exact final checks:

```bash
node scripts/check-redirect-targets.mjs --self-test
cd pmo-portal && npm run verify:locked
```

The CI assertion must prove the new guard self-test executes inside the PR-to-`main` `integration` job, not merely that the workflow text mentions its name.
