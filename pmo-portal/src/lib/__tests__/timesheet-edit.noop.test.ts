import { describe, it, expect } from 'vitest';
import { saveToastForChangeCount } from '../timesheet-edit';

/**
 * AC-IXD-TS-003 (timesheet Save+Submit, OD-UX-1; plan task 15):
 *   Given no changes since the last save, when Save is clicked, the toast does
 *   NOT say "0 changes saved" — a no-op Save reports "Nothing to save — no
 *   changes" (info), not a fake "0 changes saved" success. A real save reports
 *   "N change(s) saved" (success). Pluralization is correct (1 change / N changes).
 *
 * The message is a pure function of the change count so the page never inlines a
 * "{n} changes saved" string that prints "0 changes saved" on a no-op. The shape
 * is `[title, sub, kind]` so the page can spread it straight into `toast(...)`.
 */
describe('AC-IXD-TS-003: the Save toast suppresses the "0 changes saved" no-op message', () => {
  it('AC-IXD-TS-003: 0 changes → info "Nothing to save — no changes" (never "0 changes saved")', () => {
    const [title, sub, kind] = saveToastForChangeCount(0);
    expect(kind).toBe('info');
    expect(title).toBe('Nothing to save');
    expect(sub).toMatch(/no changes/i);
    expect(sub).not.toMatch(/0 changes saved/i);
  });

  it('AC-IXD-TS-003: 1 change → success "1 change saved" (singular)', () => {
    const [title, sub, kind] = saveToastForChangeCount(1);
    expect(kind).toBe('success');
    expect(title).toBe('Timesheet saved');
    expect(sub).toBe('1 change saved');
  });

  it('AC-IXD-TS-003: N>1 changes → success "N changes saved" (plural)', () => {
    const [title, sub, kind] = saveToastForChangeCount(3);
    expect(kind).toBe('success');
    expect(title).toBe('Timesheet saved');
    expect(sub).toBe('3 changes saved');
  });
});
