import { describe, it, expect } from 'vitest';
import { sodGateMessage } from '../mainAction';
import type { ProcurementDetail } from '@/src/lib/db/procurementLifecycle';

const p = (status: string, name?: string) =>
  ({ status, requested_by: name ? { full_name: name } : null }) as unknown as ProcurementDetail;

describe('sodGateMessage', () => {
  it('Requested + requester: names the requester, blocks self-approval', () => {
    expect(sodGateMessage(p('Requested', 'Dana'), 'Finance', true)).toContain('raised by Dana');
    expect(sodGateMessage(p('Requested'), 'Finance', true)).toContain('raised by you');
  });
  it('Requested + non-requester: no gate', () => {
    expect(sodGateMessage(p('Requested', 'Dana'), 'Finance', false)).toBeNull();
  });
  it('Ordered: gate unless requester or receipt role', () => {
    expect(sodGateMessage(p('Ordered'), 'Finance', false)).toContain('confirm receipt');
    expect(sodGateMessage(p('Ordered'), 'Project Manager', false)).toBeNull();
    expect(sodGateMessage(p('Ordered'), 'Finance', true)).toBeNull();
  });
  it('other stages: no gate', () => {
    expect(sodGateMessage(p('Approved'), 'Finance', false)).toBeNull();
  });
});
