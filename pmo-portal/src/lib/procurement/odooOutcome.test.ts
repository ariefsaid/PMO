import { describe, expect, it } from 'vitest';
import { odooOutcome } from './odooOutcome';

const READ = '2026-11-03T10:00:00Z';

describe('AC-OPP-080 odooOutcome: the plain outcome class of one Odoo-bound record', () => {
  it('a mirrored document with nothing wrong is confirmed, with the age of the last read', () => {
    expect(odooOutcome({ erpState: 'posted', erpReadAt: READ })).toEqual({ cls: 'confirmed', asOf: READ, reason: null });
  });

  it('a document with an attention reason is needs-attention and carries the reason', () => {
    expect(odooOutcome({ erpState: 'posted', erpReadAt: READ, erpAttention: 'total-mismatch' })).toEqual({ cls: 'needs-attention', asOf: READ, reason: 'total-mismatch' });
  });

  it.each(['pending', 'committing', 'committed', 'quarantined'])('a command in state %s is pending: sent, not read back', (state) => {
    expect(odooOutcome({ outboxState: state, outboxUpdatedAt: READ })?.cls).toBe('pending');
  });

  it('a held command is held and never confirmed, even when an older mirror read exists', () => {
    expect(odooOutcome({ outboxState: 'held', outboxUpdatedAt: READ, erpState: 'posted', erpReadAt: READ })?.cls).toBe('held');
  });

  it('a rejected command is refused; a transient failure stays pending (a retry reuses the same key)', () => {
    expect(odooOutcome({ outboxState: 'failed', lastError: 'config-rejected: tax not valid' })?.cls).toBe('refused');
    expect(odooOutcome({ outboxState: 'failed', lastError: 'commit-rejected' })?.cls).toBe('refused');
    expect(odooOutcome({ outboxState: 'failed', lastError: 'external-unreachable' })?.cls).toBe('pending');
  });

  it('an order Odoo holds for its own approval is pending with that reason, not confirmed', () => {
    expect(odooOutcome({ erpState: 'to approve', erpReadAt: READ })).toEqual({ cls: 'pending', asOf: READ, reason: 'awaiting-approval' });
  });

  it('a confirmed command with no mirror yet is pending; a record with no Odoo fact at all has no outcome', () => {
    expect(odooOutcome({ outboxState: 'confirmed' })).toBeNull();
    expect(odooOutcome({})).toBeNull();
  });
});
