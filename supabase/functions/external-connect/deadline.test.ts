/** AC-OUT-841 — external-connect ClickUp validation is deadline-bounded and surfaces external-unreachable. */
import { assertEquals, assertRejects } from '@std/assert';
import { validateClickUpToken } from './index.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { hungFetch, withShortOutboundDeadline } from '../_shared/testing/hungFetch.ts';

Deno.test('AC-OUT-841: external-connect token validation rejects within the deadline as external-unreachable (not "invalid token")', async () => {
  await withShortOutboundDeadline(async () => {
    const err = await assertRejects(() => validateClickUpToken('t', { fetchImpl: hungFetch() }), AppError);
    assertEquals((err as AppError).code, 'external-unreachable');
  });
});
