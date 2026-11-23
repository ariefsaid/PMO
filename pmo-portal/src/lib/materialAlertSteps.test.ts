import { describe, it, expect } from 'vitest';
import { summariseWaitingMaterialAlerts } from './materialAlertSteps';

const row = (workOrderId: string, projectId: string) => ({ workOrderId, projectId, workOrderLabel: workOrderId, itemCount: 1 });

describe('summariseWaitingMaterialAlerts', () => {
  it('AC-MVP-012 nothing open is no entry', () => {
    expect(summariseWaitingMaterialAlerts([])).toBeNull();
  });
  it('AC-MVP-012 work orders on one project count and point at that project\'s work-order tab', () => {
    expect(summariseWaitingMaterialAlerts([row('a', 'p1'), row('b', 'p1')])).toEqual({ count: 2, href: '/projects/p1/work-orders' });
  });
  it('AC-MVP-012 work orders on several projects point at the project list', () => {
    expect(summariseWaitingMaterialAlerts([row('a', 'p1'), row('b', 'p2')])).toEqual({ count: 2, href: '/projects' });
  });
});
