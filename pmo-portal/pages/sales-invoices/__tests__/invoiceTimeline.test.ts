import { describe, expect, it } from 'vitest';
import { invoiceTimelineSteps } from '../invoiceTimeline';

const t = ((_k: string, d: string) => d) as never;
const states = (inv: Parameters<typeof invoiceTimelineSteps>[0]) => invoiceTimelineSteps(inv, t)?.map((s) => s.state);

describe('2057: invoice status timeline', () => {
  const base = { received_date: null };
  it('a draft sits at the first step', () => {
    expect(states({ ...base, status: 'Draft' })).toEqual(['current', 'upcoming', 'upcoming', 'upcoming']);
  });
  it('a submitted invoice is current at Submitted until the client receipt is recorded', () => {
    expect(states({ ...base, status: 'Unpaid' })).toEqual(['done', 'current', 'upcoming', 'upcoming']);
    expect(states({ ...base, status: 'Submitted', received_date: '2026-11-03' })).toEqual(['done', 'done', 'current', 'upcoming']);
  });
  it('a paid invoice completes every step; a cancelled one has no forward path', () => {
    expect(states({ ...base, status: 'Paid' })).toEqual(['done', 'done', 'done', 'paid']);
    expect(invoiceTimelineSteps({ ...base, status: 'Cancelled' }, t)).toBeNull();
  });
});
