// deno-boot-smoke.ts — import a deployed edge-function entrypoint with Deno.serve stubbed, to catch
// IMPORT-TIME crashes (circular-import temporal-dead-zone, top-level throws) that neither `deno check`
// (types only) nor Vitest (resolves module-init order differently than the Deno runtime) detects.
//
// Why this exists: on the 2026-07-04 prod deploy, agent-chat crashed at boot with a WORKER_ERROR —
// actions.ts ↔ schema.ts was circular and schema.ts read AGENT_READ_ENTITIES in its temporal dead
// zone. `deno check` was green and every unit test passed; only the real runtime evaluated the module
// graph in the crashing order. This smoke reproduces that evaluation and fails the build on any throw.
//
// Usage (run once per function, with that function's import map):
//   deno run --allow-all --config supabase/functions/<fn>/deno.json \
//     scripts/deno-boot-smoke.ts supabase/functions/<fn>/index.ts

// Stub Deno.serve so importing index.ts (which calls it at top level) does not start a real listener.
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });

const entry = Deno.args[0];
if (!entry) {
  console.error('usage: deno-boot-smoke.ts <path-to-index.ts relative to cwd>');
  Deno.exit(2);
}

try {
  await import(new URL(entry, `file://${Deno.cwd()}/`).href);
  console.log(`BOOT_OK  ${entry}`);
} catch (e) {
  console.error(`BOOT_CRASH  ${entry}:`, e instanceof Error ? (e.stack ?? e.message) : String(e));
  Deno.exit(1);
}
