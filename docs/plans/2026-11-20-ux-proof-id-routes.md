# Plan: UX proof baselines for routes with an id (#2549)

Builds on branch `fix/2548-uxproof-panels-and-ids` (merged here): it added uuid-segment normalisation, the
`baselineKey` exact-then-pattern lookup and the migrated `/projects/:id` baselines. Gap left: ids that are not
uuids, and a hand-written assumption of what an id looks like.

1. Test first: `scripts/ux-proof-settings.test.mjs` cases for `routeTablePaths`, `routePatternFor` (ids, nested, query, trailing slash, hash, literal-beats-param, non-id params, uuid fallback), `baselineKey` with a table, shrink-only on a pattern key, shipped `App.tsx`. Verify red: `node --test scripts/ux-proof-settings.test.mjs`.
2. `scripts/ux-proof-settings.mjs`: add `routeTablePaths`, `routePatternFor`; `routePattern` delegates; `baselineKey` takes `routePaths`; `loadProofSettings` returns `routePaths` (omitted for `--rules-only`).
3. `scripts/ux-proof.mjs`: pass `routePaths` to `baselineKey`.
4. CI verify job: run the settings test next to `ux-proof.test.mjs`.
5. Gates: `npm run check:guards`, `npm run typecheck`, eslint on touched files, `node --test scripts/ux-proof-settings.test.mjs scripts/ux-proof.test.mjs`, `npm run check:ux-proof`.

Not done here: no full-app render (needs the local Supabase stack); existing exact keys are left as they are.
