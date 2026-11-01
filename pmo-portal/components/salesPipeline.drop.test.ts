import { describe, it, expect } from 'vitest';
import { resolveProjectDrop, SALES_COLUMNS } from './salesPipeline';
import { LEGAL_PROJECT_TRANSITIONS, type ProjectStatus } from '@/src/lib/db/projectTransitions';

const col = (testId: string) => SALES_COLUMNS.find((c) => c.testId === testId)!;

describe('resolveProjectDrop', () => {
  it('AC-DND-001: every (status, column) resolves to LEGAL_PROJECT_TRANSITIONS ∩ column.statuses', () => {
    for (const status of Object.keys(LEGAL_PROJECT_TRANSITIONS) as ProjectStatus[]) {
      for (const column of SALES_COLUMNS) {
        const legal = LEGAL_PROJECT_TRANSITIONS[status].filter((s) => column.statuses.includes(s));
        const r = resolveProjectDrop(status, column);
        if (column.statuses.includes(status)) expect(r).toEqual({ kind: 'noop' });
        else if (legal.length === 0) expect(r).toEqual({ kind: 'refused' });
        else if (legal.length === 1) expect(r).toEqual({ kind: 'target', to: legal[0] });
        else expect(r).toEqual({ kind: 'choice', options: legal });
      }
    }
  });
  it('AC-DND-001: named cases from the shipped map', () => {
    expect(resolveProjectDrop('Leads', col('stage-Tender Submitted'))).toEqual({ kind: 'refused' });
    expect(resolveProjectDrop('Negotiation', col('stage-Won'))).toEqual({ kind: 'target', to: 'Won, Pending KoM' });
    expect(resolveProjectDrop('Tender Submitted', col('stage-Lost'))).toEqual({ kind: 'choice', options: ['Loss Tender', 'Declined'] });
    expect(resolveProjectDrop('Ongoing Project', col('stage-Won'))).toEqual({ kind: 'noop' });
    expect(resolveProjectDrop('Loss Tender', col('stage-Negotiation'))).toEqual({ kind: 'target', to: 'Negotiation' });
  });
});
