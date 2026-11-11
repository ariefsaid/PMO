import { describe, vi } from 'vitest';
import * as dal from '@/src/lib/db/imprest';
import { imprestRepository } from './imprest';
import { itDelegates } from './__tests__/delegation';

vi.mock('@/src/lib/db/imprest');

describe('imprestRepository', () => {
  itDelegates(imprestRepository as never, dal, [
    ['requestReplenishment', 'requestReplenishment', ['f1', 'funding']],
    ['listFloats', 'listFloats', []],
    ['getPosition', 'getPosition', ['f1']],
    ['getPlanUsage', 'getPlanUsage', ['f1', '2026-11-01']],
    ['floatChoices', 'floatChoices', ['p1', 'Vehicle']],
    ['listPlans', 'listPlans', ['f1']],
    ['listPlanLines', 'listPlanLines', ['pl1']],
    ['listReplenishments', 'listReplenishments', ['f1']],
    ['listFloatChanges', 'listFloatChanges', ['f1']],
    ['listCounts', 'listCounts', ['f1']],
    ['listPostingStates', 'listPostingStates', ['f1']],
    ['setCashAccount', 'setCashAccount', ['f1', 'Site Cash - X']],
    ['listFloatClaims', 'listFloatClaims', ['f1']],
    ['listAwaitingImprest', 'listAwaitingImprest', []],
    ['getProcurementLimit', 'getProcurementLimit', []],
    ['setClaimFloat', 'setClaimFloat', ['c1', 'f1']],
    ['createPlan', 'createPlan', ['f1', '2026-11-01']],
    ['savePlanLine', 'savePlanLine', ['pl1', 'Vehicle', 100]],
    ['deletePlanLine', 'deletePlanLine', ['l1']],
    ['establishFloat', 'establishFloat', ['p1', 'u1', 100]],
    ['proposeFloatAmount', 'proposeFloatAmount', ['f1', 200]],
    ['recordCount', 'recordCount', ['f1', 100, 'n']],
  ]);
});
