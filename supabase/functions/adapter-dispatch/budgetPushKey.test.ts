// P3c — the budget push's DETERMINISTIC key must survive the SERVED boundary (AC-BUD-021, ADR-0059 §4).
//
// `index.ts` refuses any erpnext-tier write whose key is not `isOpaqueIdempotencyKey` (BLOCK #1: a short
// key substring-matches other documents' anchors and makes recovery adopt the wrong ERP document). A
// derived key that the guard rejects would 422 EVERY budget push — the deterministic-key design and the
// boundary guard have to agree, and nothing else in the tree asserts that they do.
import { assertEquals, assert } from 'jsr:@std/assert';
import { budgetPushKey } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/budgetPushKey.ts';
import { isOpaqueIdempotencyKey } from './transitionTargetGuard.ts';

const VERSION = '3f1b0c9e-1a2b-4c3d-8e4f-5a6b7c8d9e0f';

Deno.test('AC-BUD-021 the derived budget key is accepted by the served boundary opaque-key guard', () => {
  assert(isOpaqueIdempotencyKey(budgetPushKey(VERSION, '2026-07-16T10:00:00+00:00')));
  assert(isOpaqueIdempotencyKey(budgetPushKey(VERSION, '2026-07-16 10:00:00.123456+00')));
});

Deno.test('AC-BUD-021 the sweep backstop derives the same key the foreground path does', () => {
  // No shared client state — only the row. The sweep reads the stamp server-side (space-separated,
  // microsecond-precision); the foreground reads it through PostgREST (ISO, offset-suffixed).
  assertEquals(
    budgetPushKey(VERSION, '2026-07-16 10:00:00+00'),
    budgetPushKey(VERSION, '2026-07-16T10:00:00.000+00:00'),
  );
});

Deno.test('AC-BUD-021 a version with no activation stamp yields NO key at all (fail closed)', () => {
  let code: unknown;
  try {
    budgetPushKey(VERSION, null);
  } catch (e) {
    code = (e as { code?: string }).code;
  }
  assertEquals(code, 'commit-rejected');
});
