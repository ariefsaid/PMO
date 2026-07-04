/**
 * KPITile's tone union, split into its own pure (no-React, no-JSX) sibling file.
 *
 * Why: viewspec/registry.ts type-only-imports `KPITone` to bind its descriptor's tone literals to
 * the REAL component type via `satisfies` (so a rename/value change in KPITile.tsx fails `tsc`
 * there — the "keeps the manifest honest" guarantee, see registry.ts's file doc comment). That
 * import is ALSO reachable from every Deno edge function's entry point (agent-chat/agent-dispatch/
 * compose-view all transitively wire the compose_view tool through viewspec/*), and Deno's `deno
 * check` must fully parse+check any file it imports — including KPITile.tsx's React/JSX/router
 * imports, which Deno's edge-function programs have no JSX pragma/DOM lib for (an unrelated,
 * enormous transitive closure just to grab one string-literal union). Splitting the type out
 * keeps the drift guard 100% intact (KPITile.tsx re-exports `KPITone` from here, so it's still one
 * source of truth) while letting Deno resolve `registry.ts`'s need without touching JSX at all.
 */
export type KPITone = 'blue' | 'violet' | 'amber' | 'red' | 'green';
