import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({ data: null as unknown, save: vi.fn() }));
vi.mock('@/src/hooks/useBillingStages', () => ({
  useProjectBillingTerms: () => ({ data: h.data, isPending: false, isError: false, refetch: vi.fn() }),
  useSaveBillingTerms: () => ({ mutateAsync: h.save, isPending: false }),
}));
vi.mock('@/src/hooks/useBillingSteps', () => ({
  useStepTemplates: () => ({ data: [] }),
  useLoadTemplateOntoProject: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
import { BillingTermsModal } from '../BillingTermsModal';
import { QueryClientTestProvider } from '@/test/QueryClientTestProvider';

beforeEach(() => {
  h.data = {
    stages: [
      { name: 'Measure', clientSide: false, targetDays: 10, optional: false, documents: [] },
      { name: 'Review', clientSide: false, targetDays: null, optional: true, documents: [] },
    ],
    terms: { deadlineDay: null, warnDays: 5, retentionPct: 0 },
  };
  h.save.mockReset().mockResolvedValue(undefined);
});

describe('BillingTermsModal target days and optional stages (#2592)', () => {
  it('AC-BSX-001 shows each stage\'s target and optional flag and saves a changed target and flag with the list', async () => {
    const user = userEvent.setup();
    render(<QueryClientTestProvider><BillingTermsModal projectId="p1" onClose={vi.fn()} /></QueryClientTestProvider>);
    const [first, second] = screen.getAllByRole('group', { name: /^Stage \d/ });
    expect(within(first).getByRole('textbox', { name: 'Target (days)' })).toHaveValue('10');
    expect(within(second).getByRole('checkbox', { name: 'Optional stage' })).toBeChecked();
    await user.type(within(second).getByRole('textbox', { name: 'Target (days)' }), '5');
    await user.click(within(first).getByRole('checkbox', { name: 'Optional stage' }));
    await user.click(screen.getByRole('button', { name: 'Save billing terms' }));
    expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ stages: [
      { name: 'Measure', clientSide: false, targetDays: 10, optional: true, documents: [] },
      { name: 'Review', clientSide: false, targetDays: 5, optional: true, documents: [] },
    ] }));
  });

  it('AC-BSX-001 a target outside 1 to 365 days is explained and nothing is saved', async () => {
    const user = userEvent.setup();
    render(<QueryClientTestProvider><BillingTermsModal projectId="p1" onClose={vi.fn()} /></QueryClientTestProvider>);
    const first = screen.getAllByRole('group', { name: /^Stage \d/ })[0];
    const field = within(first).getByRole('textbox', { name: 'Target (days)' });
    await user.clear(field);
    await user.type(field, '400');
    await user.click(screen.getByRole('button', { name: 'Save billing terms' }));
    expect(await screen.findByText('Enter 1 to 365 days, or leave it empty.')).toBeInTheDocument();
    expect(h.save).not.toHaveBeenCalled();
  });
});
