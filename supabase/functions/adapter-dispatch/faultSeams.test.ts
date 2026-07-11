// Slice 0, task 0.6 (FR-ENA-003) — the gate-logic proof for the named server-side fault seams.
// `maybeFault(seam, gate)` is a no-op unless BOTH `envFaults==='1'` AND `header===seam` — i.e. the
// seams are inert in every non-test context (env off ⇒ byte-for-byte, NFR-ENA-CONTRACT-001-adjacent
// zero-behavior-change invariant for slice 0). The e2e-level proof that each seam actually fires at
// the real `adapter-dispatch` boundary lands in the slice that owns the money AC it backs (R1/R3
// idempotency e2e, slice 6) — this test proves only the gate + the per-seam error shape.
//
// Deno-native test (no import framework — plain assertions, no network dependency).
// Verify (RED): cd supabase/functions/adapter-dispatch && deno test faultSeams.test.ts

import { maybeFault, TIMEOUT_FAULT_BUDGET_MS } from './faultSeams.ts';
import { AdapterError } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

async function assertThrowsAdapterError(
  fn: () => Promise<unknown>,
  expectedCode: string,
  msg: string,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    assert(err instanceof AdapterError, `${msg}: expected an AdapterError, got ${String(err)}`);
    assert(
      (err as AdapterError).code === expectedCode,
      `${msg}: expected code '${expectedCode}', got '${(err as AdapterError).code}'`,
    );
    return;
  }
  throw new Error(`${msg}: expected a throw, none occurred`);
}

Deno.test('maybeFault is a no-op when ERPNEXT_TEST_FAULTS is off, even with a matching header', async () => {
  const result = await maybeFault('after-commit-before-mirror', {
    envFaults: '0',
    header: 'after-commit-before-mirror',
  });
  assert(result === undefined, 'expected no throw / undefined when envFaults is off');
});

Deno.test('maybeFault is a no-op when the header names a DIFFERENT seam than the one being checked', async () => {
  // Belt-and-braces: the gate requires header===seam, not just envFaults==='1' — a fault request for
  // one seam must never leak into another seam's code path.
  const result = await maybeFault('unreachable', { envFaults: '1', header: 'reject-validation' });
  assert(result === undefined, 'expected no throw when the header names a different seam');
});

Deno.test("maybeFault('unreachable') throws AdapterError('external-unreachable', ...) when armed", async () => {
  await assertThrowsAdapterError(
    () => maybeFault('unreachable', { envFaults: '1', header: 'unreachable' }),
    'external-unreachable',
    "seam 'unreachable'",
  );
});

Deno.test("maybeFault('reject-validation') throws AdapterError('commit-rejected', ...) when armed", async () => {
  await assertThrowsAdapterError(
    () => maybeFault('reject-validation', { envFaults: '1', header: 'reject-validation' }),
    'commit-rejected',
    "seam 'reject-validation'",
  );
});

Deno.test("maybeFault('timeout') sleeps past the budget (via the injected sleep) then throws", async () => {
  const slept: number[] = [];
  const fakeSleep = (ms: number) => {
    slept.push(ms);
    return Promise.resolve(); // deterministic + instant — no real wall-clock wait in the test
  };
  await assertThrowsAdapterError(
    () => maybeFault('timeout', { envFaults: '1', header: 'timeout', sleep: fakeSleep }),
    'external-unreachable',
    "seam 'timeout'",
  );
  assert(slept.length === 1, `expected exactly one sleep call, got ${slept.length}`);
  assert(
    slept[0] > TIMEOUT_FAULT_BUDGET_MS,
    `expected the injected sleep to exceed the ${TIMEOUT_FAULT_BUDGET_MS}ms budget, got ${slept[0]}`,
  );
});

Deno.test("maybeFault('after-commit-before-mirror') throws a plain Error (simulated crash, R3 partial-failure window) when armed", async () => {
  let threw = false;
  try {
    await maybeFault('after-commit-before-mirror', { envFaults: '1', header: 'after-commit-before-mirror' });
  } catch (err) {
    threw = true;
    assert(!(err instanceof AdapterError), 'expected a plain Error, not a classified AdapterError');
    assert(err instanceof Error, 'expected an Error instance');
  }
  assert(threw, 'expected a throw');
});

Deno.test("maybeFault('after-submit-before-mirror') throws a plain Error (simulated crash, R3 partial-failure window) when armed", async () => {
  let threw = false;
  try {
    await maybeFault('after-submit-before-mirror', { envFaults: '1', header: 'after-submit-before-mirror' });
  } catch (err) {
    threw = true;
    assert(!(err instanceof AdapterError), 'expected a plain Error, not a classified AdapterError');
  }
  assert(threw, 'expected a throw');
});
