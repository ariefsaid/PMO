// task FIX-6 (Quality MINOR 4) [Deno unit] — `reportVersionFromOrg` reads the aging-snapshot
// provenance version from `org.versionMajor` (the `external_org_bindings.version_major` COLUMN,
// handshake-stamped) — a fixed regression against reading a non-existent `org.config.version` key
// (which always silently evaluated to the empty string, blanking every aging snapshot's provenance).
//
// Verify: cd supabase/functions/erpnext-sweep && deno test reportVersionFromOrg.test.ts

(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { reportVersionFromOrg } = await import('./index.ts');

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

Deno.test('FIX-6: a stamped version_major (e.g. 15) pins a non-empty reportVersion string', () => {
  const result = reportVersionFromOrg({ versionMajor: 15 });
  assert(result === '15', `expected "15", got "${result}"`);
  assert(result.length > 0, 'expected a non-empty reportVersion');
});

Deno.test('FIX-6: a null version_major (pre-handshake) falls back to the empty string, not a crash', () => {
  const result = reportVersionFromOrg({ versionMajor: null });
  assert(result === '', `expected "", got "${result}"`);
});
