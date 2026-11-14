import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';
import type { ProcurementDetail } from '@/src/lib/db/procurementLifecycle';
import type { ProcurementItemRow } from '@/src/lib/db/procurementCrud';
import { ProcurementItemsTab } from './ProcurementDetailTabs';

const item: ProcurementItemRow = {
  id: 'item-1', org_id: 'org-1', procurement_id: 'proc-1', name: 'Clip', description: null,
  quantity: 2, rate: 15.25, amount: 30.5,
  erp_docstatus: null, erp_line_amount: null, erp_modified: null,
};

function mockPhoneViewport() {
  vi.stubGlobal('matchMedia', vi.fn((media: string) => ({
    matches: false, media, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })));
}

function makeRecord(items: ProcurementItemRow[]) {
  return {
    id: 'proc-1', currency: 'USD', items, is_subcontract: false, project_id: null, purchase_orders: [],
  } as unknown as ProcurementDetail;
}

function itemTabProps(p: ProcurementDetail, crud: unknown, canEditItems: boolean) {
  return {
    p,
    ownership: { mode: 'internal' },
    ownershipReady: true,
    casePushInFlight: false,
    canEditItems,
    canEditItemValues: canEditItems,
    itemEligibility: { isError: false, isPending: false, isFetching: false, refetch: vi.fn() },
    erpItems: { connected: false },
    crud,
    onMutationError: vi.fn(),
    currentUserId: null,
    managerId: null,
  } as unknown as React.ComponentProps<typeof ProcurementItemsTab>;
}

afterEach(() => vi.unstubAllGlobals());

describe('ProcurementItemsTab record caller', () => {
  it('shows the estimated total in the phone line-items list', () => {
    mockPhoneViewport();
    const crud = {
      createItem: { isPending: false, mutateAsync: vi.fn() },
      updateItem: { isPending: false, mutateAsync: vi.fn() },
      deleteItem: { isPending: false, mutateAsync: vi.fn() },
    };
    render(
      <ToastProvider>
        <ProcurementItemsTab {...itemTabProps(makeRecord([item]), crud, false)} />
      </ToastProvider>,
    );

    expect(screen.getByTestId('dt-card-branch')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Estimated total' })).toHaveTextContent('$31');
  });

  it('keeps whole-unit amounts on the record caller after Add and submits the original quantity and rate', async () => {
    mockPhoneViewport();
    const createItem = vi.fn().mockResolvedValue(undefined);
    const AddedLineRecord: React.FC = () => {
      const [items, setItems] = React.useState<ProcurementItemRow[]>([]);
      const crud = {
        createItem: {
          isPending: false,
          mutateAsync: async (input: { name: string; quantity: number; rate: number }) => {
            await createItem(input);
            setItems([{
              ...item, id: 'added-item', name: input.name, quantity: input.quantity, rate: input.rate,
              amount: input.quantity * input.rate,
            }]);
          },
        },
        updateItem: { isPending: false, mutateAsync: vi.fn() },
        deleteItem: { isPending: false, mutateAsync: vi.fn() },
      };
      return <ProcurementItemsTab {...itemTabProps(makeRecord(items), crud, true)} />;
    };

    render(<ToastProvider><AddedLineRecord /></ToastProvider>);
    await userEvent.type(screen.getByLabelText('New item description'), 'Clip');
    await userEvent.type(screen.getByLabelText('New item quantity'), '2');
    await userEvent.type(screen.getByLabelText('New item unit price'), '15.25');
    await userEvent.click(screen.getByRole('button', { name: /add line item/i }));

    expect(createItem).toHaveBeenCalledWith({ name: 'Clip', quantity: 2, rate: 15.25 });
    expect(await screen.findByText('$15')).toBeInTheDocument();
    expect(screen.getAllByText('$31')).toHaveLength(2);
    expect(screen.getByRole('group', { name: 'Estimated total' })).toHaveTextContent('$31');
  });
});
