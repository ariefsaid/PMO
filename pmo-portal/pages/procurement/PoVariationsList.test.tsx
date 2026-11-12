import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { ToastProvider } from '@/src/components/ui';
import enProcurement from '@/public/locales/en/procurement.json';
import idProcurement from '@/public/locales/id/procurement.json';
import type { PoVariationWithLines } from '@/src/lib/db/subcontracts';

const h = vi.hoisted(() => ({
  variations: { data: [] as unknown[] | undefined, isPending: false, isError: false, refetch: vi.fn() },
  workOrders: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  route: { data: { route: 'project', reason: 'project route', approver_ids: ['u2'], line_budget: 100, line_used: 0 }, isPending: false, isError: false, refetch: vi.fn() },
  may: vi.fn((_action: string, _entity: string) => true),
  mutations: {
    requestVariation: { mutateAsync: vi.fn().mockResolvedValue('v-new'), isPending: false },
    decideVariation: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    issueRevision: { mutateAsync: vi.fn().mockResolvedValue(2), isPending: false },
    linkVariation: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
  },
}));

vi.mock('@/src/hooks/useSubcontract', () => ({
  usePoVariations: () => h.variations,
  useVariationRoute: () => h.route,
  useSubcontractMutations: () => h.mutations,
}));
vi.mock('@/src/hooks/useWorkOrders', () => ({ useProjectWorkOrders: () => h.workOrders }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => h.may }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org1' } }) }));
vi.mock('@/src/hooks/useUsers', () => ({ useUsers: () => ({ data: [{ id: 'u2', full_name: 'Approver' }] }) }));

import { PoVariationsList } from './PoVariationsList';

function variation(overrides: Partial<PoVariationWithLines> = {}): PoVariationWithLines {
  return {
    id: 'var-1', org_id: 'org1', po_id: 'po1', procurement_id: 'proc1', project_id: 'project1',
    number: 'VAR-1', origin: 'post_work', reason: 'Extra measured work', amount: 2000000,
    requested_at: '2026-11-01T00:00:00Z', requested_by: 'u1', approved_at: null, approved_by: null,
    decided_at: null, decided_by: null, decided_notes: null, linked_at: null, linked_by: null,
    not_passed_reason: null, revision: null, status: 'Requested', work_order_id: null, lines: [],
    ...overrides,
  };
}

function renderList(lng: 'en' | 'id' = 'en') {
  const i18n = createInstance();
  void i18n.init({ lng, fallbackLng: 'en', ns: ['procurement'], defaultNS: 'procurement', interpolation: { escapeValue: false },
    resources: { en: { procurement: enProcurement }, id: { procurement: idProcurement } } });
  return render(<I18nextProvider i18n={i18n}><ToastProvider><PoVariationsList poId="po1" projectId="project1" currency="IDR" /></ToastProvider></I18nextProvider>);
}

beforeEach(() => {
  h.variations = { data: [variation()], isPending: false, isError: false, refetch: vi.fn() };
  h.workOrders = { data: [], isPending: false, isError: false, refetch: vi.fn() };
  h.route = { data: { route: 'project', reason: 'project route', approver_ids: ['u2'], line_budget: 100, line_used: 0 }, isPending: false, isError: false, refetch: vi.fn() };
  h.may = vi.fn(() => true);
  for (const mutation of Object.values(h.mutations)) mutation.mutateAsync.mockClear();
});

describe('PoVariationsList', () => {
  it('R2: the reject dialog says the variation will not increase the PO', async () => {
    const user = userEvent.setup();
    h.variations = { data: [variation({ requested_by: 'u2', approved_by: null })], isPending: false, isError: false, refetch: vi.fn() };
    h.route = { data: { route: 'project', reason: 'project route', approver_ids: ['u1'], line_budget: 100, line_used: 0 }, isPending: false, isError: false, refetch: vi.fn() };
    renderList();
    const row = await screen.findByTestId('po-variation-var-1');
    await user.click(within(row).getByRole('button', { name: /reject/i }));
    // Reject is the destructive tone, so the confirm is an alertdialog.
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('This variation will be rejected or disputed and will not increase the PO.');
  });

  it('FR-SCA-036 hides Approve and Reject from the requester', async () => {
    renderList();
    expect(await screen.findByText('VAR-1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /reject/i })).toBeNull();
  });

  it('FR-SCA-036 hides Issue revision from the variation approver', async () => {
    h.variations = { data: [variation({ requested_by: 'u2', approved_by: 'u1', status: 'Approved' })], isPending: false, isError: false, refetch: vi.fn() };
    renderList();
    expect(await screen.findByText('VAR-1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /issue revision/i })).toBeNull();
  });

  it('shows loading, empty and retryable error states for variation reads', async () => {
    h.variations = { data: undefined, isPending: true, isError: false, refetch: vi.fn() };
    const view = renderList();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    view.unmount();
    h.variations = { data: [], isPending: false, isError: false, refetch: vi.fn() };
    const empty = renderList();
    expect(await screen.findByText(/no cost variations/i)).toBeInTheDocument();
    empty.unmount();
    const refetch = vi.fn();
    h.variations = { data: undefined, isPending: false, isError: true, refetch };
    renderList();
    const retry = await screen.findByRole('button', { name: /retry/i });
    retry.click();
    expect(refetch).toHaveBeenCalled();
  });

  it('gates all variation writes with poVariation permissions', async () => {
    h.may = vi.fn(() => false);
    h.variations = { data: [variation({ requested_by: 'u2', status: 'Approved' })], isPending: false, isError: false, refetch: vi.fn() };
    renderList();
    const row = await screen.findByTestId('po-variation-var-1');
    expect(within(row).queryByRole('button', { name: /issue revision|approve|reject|save work order|not passed on/i })).toBeNull();
  });

  it('FR-SCA-022 reports a revision refusal as not sent, never as a completed push', async () => {
    const user = userEvent.setup();
    h.variations = { data: [variation({ requested_by: 'u3', approved_by: 'u2', status: 'Approved' })], isPending: false, isError: false, refetch: vi.fn() };
    h.mutations.issueRevision.mutateAsync.mockRejectedValue({ details: 'erp_revise_pending' });
    renderList();
    const row = await screen.findByTestId('po-variation-var-1');
    await user.click(within(row).getByRole('button', { name: /issue revision/i }));
    const dialog = await screen.findByRole('dialog', { name: /issue a new po revision/i });
    await user.click(within(dialog).getByRole('button', { name: /issue revision/i }));

    expect(await within(row).findByRole('status', { name: /not sent: the erp revision route is not available yet/i })).toHaveTextContent('Not sent');
    expect(screen.queryByText('PO revision issued')).toBeNull();
  });

  it('FR-SCA-040 records a reason when a variation was not passed on to a client work order', async () => {
    const user = userEvent.setup();
    h.workOrders = { data: [{ id: 'wo1', wo_number: 'WO-1', title: 'Fit-out', status: 'Active' }], isPending: false, isError: false, refetch: vi.fn() };
    renderList();
    const row = await screen.findByTestId('po-variation-var-1');
    await user.selectOptions(within(row).getByLabelText('Client work order'), 'not-passed');
    await user.click(within(row).getByRole('button', { name: 'Save link' }));
    expect(await within(row).findByText('Give a reason this variation was not passed on.')).toBeInTheDocument();
    expect(h.mutations.linkVariation.mutateAsync).not.toHaveBeenCalled();

    await user.type(within(row).getByLabelText(/Reason not passed on/), 'No matching client work order');
    await user.click(within(row).getByRole('button', { name: 'Save link' }));
    expect(h.mutations.linkVariation.mutateAsync).toHaveBeenCalledWith({
      variationId: 'var-1', workOrderId: null, reason: 'No matching client work order',
    });
  });

  describe('revise refusal reason plain-words in en and id (#1998)', () => {
    const REFUSAL_CODES = [
      'revision_superseded',
      'po_has_submitted_bill',
      'revision_not_issued',
      'po_not_found',
      'below-received',
    ] as const;

    it.each(REFUSAL_CODES)('renders plain words for %s in en (toast and panel badge)', async (code) => {
      const user = userEvent.setup();
      h.variations = { data: [variation({ requested_by: 'u3', approved_by: 'u2', status: 'Approved' })], isPending: false, isError: false, refetch: vi.fn() };
      h.mutations.issueRevision.mutateAsync.mockRejectedValue({ message: code });
      renderList('en');
      const row = await screen.findByTestId('po-variation-var-1');
      await user.click(within(row).getByRole('button', { name: /issue revision/i }));
      const dialog = await screen.findByRole('dialog', { name: /issue a new po revision/i });
      await user.click(within(dialog).getByRole('button', { name: /issue revision/i }));

      // Panel badge
      const badge = await within(row).findByRole('status');
      expect(badge).toBeInTheDocument();
      expect(badge.textContent).not.toContain(code);

      // Toast
      const toasts = await screen.findAllByRole('status');
      const toastText = toasts.map((t) => t.textContent).join(' ');
      expect(toastText).not.toContain(code);
    });

    it.each(REFUSAL_CODES)('renders plain words for %s in id (toast and panel badge)', async (code) => {
      const user = userEvent.setup();
      h.variations = { data: [variation({ requested_by: 'u3', approved_by: 'u2', status: 'Approved' })], isPending: false, isError: false, refetch: vi.fn() };
      h.mutations.issueRevision.mutateAsync.mockRejectedValue({ message: code });
      renderList('id');
      const row = await screen.findByTestId('po-variation-var-1');
      await user.click(within(row).getByRole('button', { name: /terbitkan revisi/i }));
      const dialog = await screen.findByRole('dialog', { name: /terbitkan revisi po baru/i });
      await user.click(within(dialog).getByRole('button', { name: /terbitkan revisi/i }));

      // Panel badge
      const badge = await within(row).findByRole('status');
      expect(badge).toBeInTheDocument();
      expect(badge.textContent).not.toContain(code);

      // Toast
      const toasts = await screen.findAllByRole('status');
      const toastText = toasts.map((t) => t.textContent).join(' ');
      expect(toastText).not.toContain(code);
    });
  });
});
