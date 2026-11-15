import { describe, expect, it } from 'vitest';
import { approvalChain, type ApprovalChainSource } from './approvalChain';

const NOW = new Date('2026-11-15T12:00:00Z');
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

function source(over: Partial<ApprovalChainSource> = {}): ApprovalChainSource {
  return {
    status: 'Requested',
    created_at: ago(10),
    requested_by: { full_name: 'Rina' },
    approved_by: null,
    approvalRoute: null,
    statusEvents: [{ to_status: 'Requested', created_at: ago(4), actor: { full_name: 'Rina' } }],
    ...over,
  };
}

describe('#2058 procurement approval chain', () => {
  it('names the requester, then who is next and how long it has waited, aged from creation as the approvals queue ages it', () => {
    const chain = approvalChain(source({
      approvalRoute: { approvers: [{ id: 'u1', fullName: 'Budi' }, { id: 'u2', fullName: 'Sari' }] },
    }), NOW);
    expect(chain).toEqual([
      { kind: 'requested', names: ['Rina'], at: ago(4) },
      { kind: 'next', names: ['Budi', 'Sari'], waitingDays: 10 },
    ]);
  });

  it('leaves the next approver unnamed when no route was read', () => {
    expect(approvalChain(source(), NOW)?.[1]).toEqual({ kind: 'next', names: [], waitingDays: 10 });
  });

  it('measures the wait from creation after a return and resubmit, so it matches the queue card', () => {
    const chain = approvalChain(source({
      statusEvents: [
        { to_status: 'Requested', created_at: ago(9), actor: { full_name: 'Rina' } },
        { to_status: 'Rejected', created_at: ago(8), actor: { full_name: 'Budi' } },
        { to_status: 'Requested', created_at: ago(1), actor: { full_name: 'Rina' } },
      ],
    }), NOW);
    expect(chain?.[1]).toMatchObject({ kind: 'next', waitingDays: 10 });
  });

  it('shows who approved and when, once approved', () => {
    const chain = approvalChain(source({
      status: 'Ordered',
      approved_by: { full_name: 'Budi' },
      statusEvents: [
        { to_status: 'Requested', created_at: ago(4), actor: { full_name: 'Rina' } },
        { to_status: 'Approved', created_at: ago(2), actor: { full_name: 'Budi' } },
        { to_status: 'Ordered', created_at: ago(1), actor: { full_name: 'Ani' } },
      ],
    }), NOW);
    expect(chain).toEqual([
      { kind: 'requested', names: ['Rina'], at: ago(4) },
      { kind: 'approved', names: ['Budi'], at: ago(2) },
    ]);
  });

  it('falls back to the record when the event log is empty', () => {
    const chain = approvalChain(source({ statusEvents: [] }), NOW);
    expect(chain?.[0]).toEqual({ kind: 'requested', names: ['Rina'], at: ago(10) });
    expect(chain?.[1]).toMatchObject({ waitingDays: 10 });
  });

  it('has no chain before submission or after a return without approval', () => {
    expect(approvalChain(source({ status: 'Draft', statusEvents: [] }), NOW)).toBeNull();
    expect(approvalChain(source({ status: 'Rejected' }), NOW)).toBeNull();
    expect(approvalChain(source({ status: 'Cancelled' }), NOW)).toBeNull();
  });
});
