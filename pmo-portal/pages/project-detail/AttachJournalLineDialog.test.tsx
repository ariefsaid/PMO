/** FR-JEC-010/011/013 — attach dialog: dry run before commit, refusal in plain words, real attach on Confirm. */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock('@/src/hooks/useErpJournalLines', () => ({ useAttachJournalLines: () => ({ mutateAsync: h.mutate, isPending: false }) }));
const ALL = [
  { id: 'pr1', title: 'Lab works', status: 'Ordered', project_id: 'p1', vendor: { name: 'Vendor Lab' } },
  { id: 'pr2', title: 'Other project', status: 'Ordered', project_id: 'p2', vendor: null },
  { id: 'pr3', title: 'Dropped', status: 'Cancelled', project_id: 'p1', vendor: null },
];
// The server filters by project: the dialog asks for the line's project only, not the org's whole list.
const byProject = vi.fn((projectId: string) => ({
  isPending: false, isError: false, refetch: vi.fn(), data: ALL.filter((p) => p.project_id === projectId),
}));
vi.mock('@/src/hooks/useProcurements', () => ({ useProjectProcurements: (id: string) => byProject(id) }));
vi.mock('@/src/hooks/useProjectStatusLabel', () => ({ useProcurementStatusLabel: () => (s: string) => s }));

import { AttachJournalLineDialog } from './AttachJournalLineDialog';

const line = {
  erpDoctype: 'Journal Entry', voucherNo: 'ACC-JV-0001', projectId: 'p1', account: 'Sub - X', category: 'Subcontractors', postingDate: '2026-03-01',
  amount: 60000, currency: 'IDR', remarks: 'Vendor Lab inv 7', party: null, isCancelled: false, erpUrl: null, linkId: null, procurementId: null, procurementTitle: null, possiblyReversed: false,
};
const rowFor = (id: string) => ({ erp_doctype: 'Journal Entry', voucher_no: 'ACC-JV-0001', project_id: 'p1', account: 'Sub - X', procurement_id: id });

async function choose(name: string) {
  await userEvent.click(screen.getByRole('combobox', { name: /Purchase/ }));
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(name) }));
}

beforeEach(() => h.mutate.mockReset());

describe('AttachJournalLineDialog', () => {
  it('offers only the line\'s own project\'s open purchases', async () => {
    h.mutate.mockResolvedValue({ dry_run: true, results: [{ row: 1, outcome: 'attach', reason: null }] });
    render(<AttachJournalLineDialog line={line} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('combobox', { name: /Purchase/ }));
    expect(await screen.findByRole('option', { name: /Lab works/ })).toBeVisible();
    expect(byProject).toHaveBeenCalledWith('p1');
    expect(screen.queryByRole('option', { name: /Other project/ })).toBeNull();
    expect(screen.queryByRole('option', { name: /Dropped/ })).toBeNull();
  });

  it('FR-JEC-013: choosing a purchase dry-runs first, then Attach writes and closes', async () => {
    const onClose = vi.fn();
    h.mutate.mockResolvedValueOnce({ dry_run: true, results: [{ row: 1, outcome: 'attach', reason: null }] })
      .mockResolvedValueOnce({ dry_run: false, results: [{ row: 1, outcome: 'attach', reason: null }] });
    render(<AttachJournalLineDialog line={line} onClose={onClose} />);
    await choose('Lab works');
    await waitFor(() => expect(h.mutate).toHaveBeenCalledWith({ rows: [rowFor('pr1')], dryRun: true }));
    await screen.findByText(/Ready to attach/);
    await userEvent.click(screen.getByRole('button', { name: 'Attach' }));
    await waitFor(() => expect(h.mutate).toHaveBeenLastCalledWith({ rows: [rowFor('pr1')] }));
    expect(onClose).toHaveBeenCalled();
  });

  it('FR-JEC-011: a refused dry run says why and keeps Attach disabled', async () => {
    h.mutate.mockResolvedValueOnce({ dry_run: true, results: [{ row: 1, outcome: 'refused', reason: 'currency_mismatch' }] });
    render(<AttachJournalLineDialog line={line} onClose={vi.fn()} />);
    await choose('Lab works');
    expect(await screen.findByRole('alert')).toHaveTextContent('currency differs');
    expect(screen.getByRole('button', { name: 'Attach' })).toBeDisabled();
  });

  describe('F2-11: dismiss must not silently drop the chosen purchase', () => {
    it('Escape with a purchase chosen asks first; Keep editing keeps the choice, Discard closes', async () => {
      const onClose = vi.fn();
      h.mutate.mockResolvedValue({ dry_run: true, results: [{ row: 1, outcome: 'attach', reason: null }] });
      render(<AttachJournalLineDialog line={line} onClose={onClose} />);
      await choose('Lab works');
      await screen.findByText(/Ready to attach/);
      await userEvent.keyboard('{Escape}');
      // The dialog asks before throwing the choice away.
      expect(onClose).not.toHaveBeenCalled();
      expect(await screen.findByRole('alertdialog')).toHaveTextContent(/Discard/i);
      await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
      expect(onClose).not.toHaveBeenCalled();
      // The chosen purchase is still chosen: Attach stays enabled.
      expect(screen.getByRole('button', { name: 'Attach' })).toBeEnabled();
      // A second dismiss offers the confirm again, and Discard closes.
      await userEvent.keyboard('{Escape}');
      await userEvent.click(await screen.findByRole('button', { name: 'Discard' }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('Escape with nothing chosen closes at once — no confirm', async () => {
      const onClose = vi.fn();
      render(<AttachJournalLineDialog line={line} onClose={onClose} />);
      await userEvent.keyboard('{Escape}');
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
  });
});
