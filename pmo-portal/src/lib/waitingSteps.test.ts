import { describe, expect, it } from 'vitest';
import { summariseWaitingSteps } from './waitingSteps';
import type { WaitingStep } from './db/billingSteps';

const step = (over: Partial<WaitingStep> = {}): WaitingStep => ({
  stageId: 's1', claimId: 'c1', projectId: 'p1', projectName: 'P', stepName: 'Review', dueOn: null, daysOver: 0, ...over,
});

describe('summariseWaitingSteps (AC-CBS-012)', () => {
  it('returns no pointer for no rows', () => {
    expect(summariseWaitingSteps([])).toBeNull();
  });

  it('counts the steps and links to the project billing tab when they share a project', () => {
    expect(summariseWaitingSteps([step(), step({ stageId: 's2', claimId: 'c2' })])).toEqual({
      count: 2, overdue: 0, oldestOverdueDays: null, href: '/projects/p1/billing',
    });
  });

  it('reports the number overdue and the oldest overdue days', () => {
    const fact = summariseWaitingSteps([step({ daysOver: 3 }), step({ stageId: 's2', daysOver: 11 }), step({ stageId: 's3', daysOver: 0 })]);
    expect(fact).toMatchObject({ count: 3, overdue: 2, oldestOverdueDays: 11 });
  });

  it('links to the project list when the steps span projects', () => {
    expect(summariseWaitingSteps([step(), step({ stageId: 's2', projectId: 'p2' })])?.href).toBe('/projects');
  });

  it('encodes the project id in the link', () => {
    expect(summariseWaitingSteps([step({ projectId: 'a b' })])?.href).toBe('/projects/a%20b/billing');
  });
});
