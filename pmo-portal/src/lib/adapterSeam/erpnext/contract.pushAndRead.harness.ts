/**
 * ERPNext's harness for the push preflights and reads of the shared suites (spec §6.2): drives the SHIPPED dispatch
 * factory and feed code with the transport mocked and answers in PMO terms. No behaviour lives here.
 */
import type { ErpHarness } from '../contractSuite/harness.ts';

type PushAndRead = Pick<ErpHarness, 'pushTimesheet' | 'pushProcurement' | 'pushRevenue' | 'pushBudgetVersion' | 'readActuals' | 'classifyPayment' | 'mirrorPurchases'>;

const notYet = (name: string) => () => { throw new Error(`erpnext harness ${name} is not wired yet`); };

export function createPushAndReadHarness(): PushAndRead {
  return {
    pushTimesheet: notYet('pushTimesheet'),
    pushProcurement: notYet('pushProcurement'),
    pushRevenue: notYet('pushRevenue'),
    pushBudgetVersion: notYet('pushBudgetVersion'),
    readActuals: notYet('readActuals'),
    classifyPayment: notYet('classifyPayment'),
    mirrorPurchases: notYet('mirrorPurchases'),
  };
}
