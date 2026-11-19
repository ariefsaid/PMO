import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { AppError } from '@/src/lib/appError';
import type { ClaimBillingTrace } from '@/src/lib/db/billingStages';

const h = vi.hoisted(() => ({
  role: 'Project Manager' as string,
  trace: null as unknown,
  traceState: { isPending: false, isError: false, refetch: vi.fn() },
  docs: [] as unknown[],
  attach: vi.fn(),
  complete: vi.fn(),
}));
vi.mock('@/src/auth/usePermission', async () => {
  const { can } = await vi.importActual<typeof import('@/src/auth/policy')>('@/src/auth/policy');
  return { usePermission: () => (action: never, entity: never, ctx: Record<string, unknown> = {}) => can(action, entity, { realRole: h.role, ...ctx } as never) };
});
vi.mock('@/src/hooks/useBillingStages', () => ({
  useClaimBillingTrace: () => ({ data: h.trace, ...h.traceState }),
  useBillingStageMutations: () => ({
    attachDocument: { mutateAsync: h.attach, isPending: false },
    completeStage: { mutateAsync: h.complete, isPending: false },
  }),
}));
vi.mock('@/src/hooks/useDocuments', () => ({ useDocuments: () => ({ data: h.docs, isPending: false, isError: false }) }));

import { ClaimBillingStages } from '../ClaimBillingStages';

const doc = (id: string, title: string, status = 'Approved', file: string | null = `o/p/${id}/f.pdf`) => ({ id, title, status, file_path: file });

function trace(): ClaimBillingTrace {
  return {
    stages: [
      { id: 's1', position: 1, name: 'Internal measurement', clientSide: false, startedOn: '2026-03-01', completedOn: '2026-03-04',
        clientReference: null, note: null, documents: [{ id: 'i1', position: 1, name: 'Measurement sheet', required: true, documentId: 'd1' }] },
      { id: 's2', position: 2, name: 'Joint survey', clientSide: true, startedOn: '2026-03-04', completedOn: null, clientReference: null, note: null,
        documents: [{ id: 'i2', position: 1, name: 'Survey minutes', required: true, documentId: null },
                    { id: 'i3', position: 2, name: 'Photos', required: false, documentId: null }] },
      { id: 's3', position: 3, name: 'Client approval', clientSide: true, startedOn: null, completedOn: null, clientReference: null, note: null, documents: [] },
    ],
    retention: { pct: 5, amount: 50000, scheduled: 0, released: 0, held: 50000 },
    deadline: { day: 25, warnDays: 5 },
  };
}

function renderIt(props: Partial<React.ComponentProps<typeof ClaimBillingStages>> = {}) {
  render(<MemoryRouter><ClaimBillingStages claimId="c1" projectId="p1" currency="IDR" invoiced={false} withdrawn={false} today="2026-03-20" {...props} /></MemoryRouter>);
  return userEvent.setup();
}

beforeEach(() => {
  h.role = 'Project Manager';
  h.trace = trace();
  h.traceState = { isPending: false, isError: false, refetch: vi.fn() };
  h.docs = [doc('d1', 'Measurement sheet March'), doc('d2', 'Joint survey minutes'), doc('d3', 'Draft note', 'Draft'), doc('d4', 'No file yet', 'Approved', null)];
  h.attach.mockReset().mockResolvedValue(undefined);
  h.complete.mockReset().mockResolvedValue(undefined);
});

describe('ClaimBillingStages', () => {
  it('AC-TRACE-001 shows each stage in order with its age, its documents, the deadline and the retention held', () => {
    renderIt();
    const items = within(screen.getByRole('list', { name: 'Billing stages' })).getAllByRole('listitem', { name: /./ });
    expect(items.map((li) => li.getAttribute('aria-label'))).toEqual(['Internal measurement', 'Joint survey', 'Client approval']);
    expect(within(items[0]).getByText(/Completed 4 Mar 2026/)).toBeInTheDocument();
    expect(within(items[0]).getByText('3 days')).toBeInTheDocument();
    expect(within(items[0]).getByRole('link', { name: 'Measurement sheet March' })).toHaveAttribute('href', '/projects/p1/documents?open=d1');
    expect(within(items[1]).getByText('16 days')).toBeInTheDocument();
    expect(within(items[1]).getByText("In the client's system")).toBeInTheDocument();
    expect(within(items[2]).getByText('Waiting')).toBeInTheDocument();
    expect(screen.getByText('1 of 3 complete')).toBeInTheDocument();
    expect(screen.getByText(/Invoice deadline 25 Mar 2026 · 5 days left/)).toBeInTheDocument();
    expect(screen.getByText(/Retention held/)).toHaveTextContent('Retention held: IDR 50,000 (5%)');
    expect(screen.getByText('Complete every stage before raising the invoice.')).toBeInTheDocument();
  });

  it('AC-BST-003 a Project Manager attaches an issued or approved document with a file to the current stage', async () => {
    const user = renderIt();
    const select = screen.getByRole('combobox', { name: 'Document for Survey minutes' });
    const offered = within(select).getAllByRole('option').map((o) => o.textContent);
    expect(offered).toEqual(['Choose a document', 'Measurement sheet March', 'Joint survey minutes']);
    await user.selectOptions(select, 'd2');
    await user.click(screen.getByRole('button', { name: 'Attach to Survey minutes' }));
    expect(h.attach).toHaveBeenCalledWith({ itemId: 'i2', documentId: 'd2' });
  });

  it("AC-BST-004 completing a client-side stage needs the client's document number, then sends date and number", async () => {
    const user = renderIt();
    await user.click(screen.getByRole('button', { name: 'Complete Joint survey' }));
    expect(screen.getByText("Enter the client's document number.")).toBeInTheDocument();
    expect(h.complete).not.toHaveBeenCalled();
    await user.type(screen.getByRole('textbox', { name: "Client's document number" }), 'JS-001');
    await user.click(screen.getByRole('button', { name: 'Complete Joint survey' }));
    expect(h.complete).toHaveBeenCalledWith({ stageId: 's2', completedOn: '2026-03-20', clientReference: 'JS-001', note: null });
  });

  it('AC-BST-003 a refusal from the database is explained in words', async () => {
    h.complete.mockRejectedValue(new AppError('x', 'stage-documents-missing'));
    const user = renderIt();
    await user.type(screen.getByRole('textbox', { name: "Client's document number" }), 'JS-001');
    await user.click(screen.getByRole('button', { name: 'Complete Joint survey' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Attach every required document before completing this stage.');
  });

  it('NFR-BST-001 an Executive sees the stages but no recording controls', () => {
    h.role = 'Executive';
    renderIt();
    expect(screen.getByRole('list', { name: 'Billing stages' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Complete/ })).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('FR-BST-013 a withdrawn or invoiced claim shows its record without controls or the deadline', () => {
    renderIt({ invoiced: true });
    expect(screen.queryByRole('button', { name: /Complete/ })).toBeNull();
    expect(screen.queryByText(/Invoice deadline/)).toBeNull();
    expect(screen.queryByText('Complete every stage before raising the invoice.')).toBeNull();
  });

  it('shows deadline and retention without a stage plan', () => {
    h.trace = { ...trace(), stages: [] };
    renderIt();
    expect(screen.getByText(/Invoice deadline 25 Mar 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Retention held/)).toHaveTextContent('IDR 50,000');
  });

  it('renders nothing when no stages, deadline or retention exist', () => {
    h.trace = { stages: [], deadline: null, retention: null };
    const { container } = render(<MemoryRouter><ClaimBillingStages claimId="c1" projectId="p1" currency="IDR" invoiced={false} withdrawn={false} today="2026-03-20" /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });

  it('a failed read says so and offers a retry, never an empty plan', async () => {
    h.trace = undefined;
    h.traceState = { isPending: false, isError: true, refetch: vi.fn() };
    const user = renderIt();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.traceState.refetch).toHaveBeenCalled();
  });
});
