import { assert, assertEquals, assertRejects } from '@std/assert';
import { AdapterError } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import type { OdooCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import { countOdooCalls, reservedOdooCallBudget, withOdooCallBudget } from './odooCallBudget.ts';

Deno.test('C6 recovery budget exhaustion is a retryable AdapterError and never calls past the reservation', async () => {
  let spent = 0;
  const calls: string[] = [];
  const budget = { left: () => spent < 1, spend: () => spent < 1 && ++spent > 0 };
  const raw: OdooCall = async <T>(model: string, method: string): Promise<T> => {
    calls.push(`${model}.${method}`);
    return [] as T;
  };
  const call = withOdooCallBudget(raw, budget);

  await call('account.move', 'search_read');
  const error = await assertRejects(() => call('account.move', 'read')) as AdapterError;

  assert(error instanceof AdapterError);
  assertEquals(error.code, 'external-unreachable');
  assertEquals(error.message, 'recovery-call-budget-exhausted');
  assertEquals(spent, 1);
  assertEquals(calls, ['account.move.search_read']);
});

Deno.test('AC-OPP-062 adapter calls are counted past the reservation without being interrupted', async () => {
  const budget = reservedOdooCallBudget(1);
  const calls: string[] = [];
  const raw: OdooCall = async <T>(model: string, method: string): Promise<T> => {
    calls.push(`${model}.${method}`);
    return [] as T;
  };
  const call = countOdooCalls(raw, budget);

  await call('account.move', 'action_post');
  await call('account.move', 'read');

  assertEquals(calls, ['account.move.action_post', 'account.move.read']);
  assertEquals(budget.used(), 2);
  assertEquals(budget.exhausted(), true);
});
