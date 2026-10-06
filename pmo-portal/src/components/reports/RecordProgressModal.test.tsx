import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({ mutateAsync: vi.fn() }));
vi.mock('@/src/hooks/useManagementPack', () => ({
  useRecordProjectProgress: () => ({ mutateAsync: h.mutateAsync, isPending: false }),
}));

import { RecordProgressModal, parsePercentComplete } from './RecordProgressModal';

const onClose = vi.fn();
const renderModal = (deliveryPct: number | null = 42.4) =>
  render(
    <ToastProvider>
      <RecordProgressModal open onClose={onClose} projectId="p1" projectName="Alpha" defaultMonth="2026-09-01" deliveryPct={deliveryPct} />
    </ToastProvider>,
  );

beforeEach(() => { h.mutateAsync.mockReset().mockResolvedValue(undefined); onClose.mockReset(); });

describe('AC-MMP-014 Record progress', () => {
  it('AC-MMP-014: accepts 0–100 with at most two decimals only', () => {
    expect(parsePercentComplete('42.5')).toBe(42.5);
    expect(parsePercentComplete('100')).toBe(100);
    expect(parsePercentComplete('-1')).toBeNull();
    expect(parsePercentComplete('101')).toBeNull();
    expect(parsePercentComplete('33.333')).toBeNull();
  });

  it('AC-MMP-014: pre-fills the as-at month and offers the milestone delivery % as a suggestion', () => {
    renderModal();
    expect(screen.getByLabelText(/^Month/)).toHaveValue('2026-09');
    expect(screen.getByText('Milestone delivery: 42%')).toBeInTheDocument();
  });

  it('AC-MMP-014: refuses an out-of-range percent with the range message and does not save', async () => {
    renderModal(null);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Percent complete to date/), '101');
    await user.click(screen.getByRole('button', { name: 'Save progress' }));
    expect(await screen.findAllByText('Enter a number from 0 to 100, with at most two decimals.')).not.toHaveLength(0);
    expect(h.mutateAsync).not.toHaveBeenCalled();
  });

  it('AC-MMP-014: saves the month as YYYY-MM-01 and closes', async () => {
    renderModal();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Percent complete to date/), '45');
    await user.click(screen.getByRole('button', { name: 'Save progress' }));
    await waitFor(() => expect(h.mutateAsync).toHaveBeenCalledWith({ projectId: 'p1', month: '2026-09-01', pctComplete: 45, note: null }));
    expect(onClose).toHaveBeenCalled();
  });
});
