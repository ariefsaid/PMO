import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppError } from '@/src/lib/appError';

const h = vi.hoisted(() => ({
  data: null as unknown,
  state: { isPending: false, isError: false, refetch: vi.fn() },
  save: vi.fn(),
  loadTemplate: vi.fn(),
}));
vi.mock('@/src/hooks/useBillingStages', () => ({
  useProjectBillingTerms: () => ({ data: h.data, ...h.state }),
  useSaveBillingTerms: () => ({ mutateAsync: h.save, isPending: false }),
}));
vi.mock('@/src/hooks/useBillingSteps', () => ({
  useStepTemplates: () => ({ data: [{ id: 'tpl-1', name: 'Fit-out' }] }),
  useLoadTemplateOntoProject: () => ({ mutateAsync: h.loadTemplate, isPending: false }),
}));

import { BillingTermsModal } from '../BillingTermsModal';
import { QueryClientTestProvider } from '@/test/QueryClientTestProvider';

beforeEach(() => {
  h.data = {
    stages: [
      { name: 'Internal measurement', clientSide: false, documents: [{ name: 'Measurement sheet', required: true }] },
      { name: 'Client approval', clientSide: true, documents: [{ name: 'Approval letter', required: true }, { name: 'Photos', required: false }] },
    ],
    terms: { deadlineDay: 25, warnDays: 5, retentionPct: 5 },
  };
  h.state = { isPending: false, isError: false, refetch: vi.fn() };
  h.save.mockReset().mockResolvedValue(undefined);
  h.loadTemplate.mockReset().mockResolvedValue(undefined);
});

const renderIt = (onClose = vi.fn()) => { render(<QueryClientTestProvider><BillingTermsModal projectId="p1" onClose={onClose} /></QueryClientTestProvider>); return { user: userEvent.setup(), onClose }; };

describe('BillingTermsModal', () => {
  it('AC-BSX-020 the template tools sit in the modal: pick a template and replace the stages (#2680)', () => {
    renderIt();
    expect(screen.getByRole('button', { name: 'Manage templates' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replace stages with template' })).toBeDisabled();
  });

  it('AC-BST-002 shows the current stage list, deadline and retention', () => {
    renderIt();
    const stages = screen.getAllByRole('group', { name: /^Stage \d/ });
    expect(stages).toHaveLength(2);
    expect(within(stages[0]).getByRole('textbox', { name: 'Stage name' })).toHaveValue('Internal measurement');
    expect(within(stages[1]).getByRole('checkbox', { name: "In the client's system" })).toBeChecked();
    expect(within(stages[1]).getByRole('textbox', { name: 'Required documents, one per line' })).toHaveValue('Approval letter');
    expect(within(stages[1]).getByRole('textbox', { name: 'Optional documents, one per line' })).toHaveValue('Photos');
    expect(screen.getByRole('textbox', { name: 'Invoice deadline (day of month)' })).toHaveValue('25');
    expect(screen.getByRole('textbox', { name: 'Retention (%)' })).toHaveValue('5');
  });

  it('AC-BST-002 Finance adds a stage and saves the whole list in order, with the deadline and retention', async () => {
    const { user, onClose } = renderIt();
    await user.click(screen.getByRole('button', { name: 'Add stage' }));
    const third = screen.getAllByRole('group', { name: /^Stage \d/ })[2];
    await user.type(within(third).getByRole('textbox', { name: 'Stage name' }), 'Acceptance');
    await user.type(within(third).getByRole('textbox', { name: 'Required documents, one per line' }), 'Acceptance certificate{enter}Minutes');
    await user.clear(screen.getByRole('textbox', { name: 'Retention (%)' }));
    await user.type(screen.getByRole('textbox', { name: 'Retention (%)' }), '2.5');
    await user.click(screen.getByRole('button', { name: 'Save billing terms' }));
    expect(h.save).toHaveBeenCalledWith({
      stages: [
        { name: 'Internal measurement', clientSide: false, documents: [{ name: 'Measurement sheet', required: true }] },
        { name: 'Client approval', clientSide: true, documents: [{ name: 'Approval letter', required: true }, { name: 'Photos', required: false }] },
        { name: 'Acceptance', clientSide: false, documents: [{ name: 'Acceptance certificate', required: true }, { name: 'Minutes', required: true }] },
      ],
      deadlineDay: 25, warnDays: 5, retentionPct: 2.5,
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('AC-BST-002 a stage can be moved up and removed before saving', async () => {
    const { user } = renderIt();
    await user.click(screen.getByRole('button', { name: 'Move Client approval up' }));
    await user.click(screen.getByRole('button', { name: 'Remove Internal measurement' }));
    await user.click(screen.getByRole('button', { name: 'Save billing terms' }));
    expect(h.save.mock.calls[0][0].stages.map((s: { name: string }) => s.name)).toEqual(['Client approval']);
  });

  it('FR-BST-031 an out-of-range deadline day or retention is refused before saving', async () => {
    const { user } = renderIt();
    await user.clear(screen.getByRole('textbox', { name: 'Invoice deadline (day of month)' }));
    await user.type(screen.getByRole('textbox', { name: 'Invoice deadline (day of month)' }), '32');
    await user.click(screen.getByRole('button', { name: 'Save billing terms' }));
    expect(screen.getByText('Enter a day from 1 to 31, or leave it empty.')).toBeInTheDocument();
    expect(h.save).not.toHaveBeenCalled();
  });

  it('rejects retention with more than two decimal places', async () => {
    const { user } = renderIt();
    await user.clear(screen.getByRole('textbox', { name: 'Retention (%)' }));
    await user.type(screen.getByRole('textbox', { name: 'Retention (%)' }), '2.555');
    await user.click(screen.getByRole('button', { name: 'Save billing terms' }));
    expect(h.save).not.toHaveBeenCalled();
    expect(screen.getByText(/at most 2 decimal places/)).toBeInTheDocument();
  });

  it('a refused save stays open and says why', async () => {
    h.save.mockRejectedValue(new AppError('only Finance or an Admin can set a project\'s billing stages', '42501'));
    const { user, onClose } = renderIt();
    await user.click(screen.getByRole('button', { name: 'Save billing terms' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
