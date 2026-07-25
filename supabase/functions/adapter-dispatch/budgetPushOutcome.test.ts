// M-2 (Luna audit round 3) — a benign 409 is NOT a budget push failure.
// Verify: cd supabase/functions/adapter-dispatch && deno test --allow-all --config deno.json budgetPushOutcome.test.ts
//
// The concrete scenario: the operator double-clicks "Retry the push" (or the sweep backstop drives the
// row while the operator retries). The second request is rejected with `command-in-flight-for-record`
// — the correct, benign outcome of 0116's one-in-flight-per-record index. Recording that as
// `push_state='failed'` + a `budget-push-failed` notification tells the operator ERPNext is enforcing
// the wrong budget when it is not, and — if it lands after the winning request wrote `pushed` — turns
// a successfully-enforced budget into a failed one and re-enqueues it into the backstop.

import { classifyBudgetPushOutcome } from './budgetPushOutcome.ts';

function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(msg ?? `expected ${e}, got ${a}`);
}

Deno.test('M-2 an in-flight-for-record 409 records NOTHING — the command that is settling owns the outcome', () => {
  assertEquals(classifyBudgetPushOutcome('command-in-flight-for-record'), { record: false });
});

Deno.test('M-2 a HELD command is recorded as held, not failed (the backstop must not re-drive what a human must resolve)', () => {
  assertEquals(classifyBudgetPushOutcome('command-held'), { record: true, pushState: 'held' });
});

Deno.test('M-2 every REAL push failure is still recorded durably as failed (round-2 HIGH-2 stands)', () => {
  for (const code of ['external-unreachable', 'commit-rejected', 'budget-category-unmapped', 'DISPATCH_FAILED']) {
    assertEquals(classifyBudgetPushOutcome(code), { record: true, pushState: 'failed' }, `code ${code}`);
  }
  // An unclassified error must fail LOUD, never silently: default is record-as-failed.
  assertEquals(classifyBudgetPushOutcome(undefined), { record: true, pushState: 'failed' });
  assertEquals(classifyBudgetPushOutcome(null), { record: true, pushState: 'failed' });
});
