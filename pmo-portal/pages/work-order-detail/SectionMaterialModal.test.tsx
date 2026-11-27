import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import enCommon from '../../public/locales/en/common.json';
import enWos from '../../public/locales/en/workOrderSections.json';
import enRefusals from '../../public/locales/en/refusals.json';
import { ToastProvider } from '@/src/components/ui';
import type { SectionRollupRow } from '@/src/lib/repositories/workOrderSections';

const h = vi.hoisted(() => ({
  allocations: [] as Array<{ id: string; sectionId: string; itemId: string; quantity: string }>,
  set: vi.fn(),
  plan: 100,
}));
vi.mock('@/src/hooks/useWorkOrderSectionMaterials', () => ({
  useSectionAllocations: () => ({ data: h.allocations, isPending: false }),
  useSetAllocation: () => ({ mutateAsync: h.set, isPending: false }),
}));
vi.mock('@/src/hooks/useStock', () => ({
  useStockItems: () => ({ data: [{ id: 'i1', code: 'CBL', name: 'Cable', unit_id: 'u1', archived_at: null }, { id: 'i2', code: 'PIP', name: 'Pipe', unit_id: 'u1', archived_at: null }] }),
  useStockUnits: () => ({ data: [{ id: 'u1', code: 'm' }] }),
}));
vi.mock('@/src/hooks/useMaterialRequests', () => ({ useLinePlans: (_w: unknown, ids: string[]) => ({ data: ids.map((itemId) => ({ itemId, planQty: h.plan, priorQty: 0 })), isPending: false }) }));

import { SectionMaterialModal } from './SectionMaterialModal';

const section = { sectionId: 's1', code: 'A', name: 'North' } as SectionRollupRow;

async function mount() {
  const i18n = createInstance();
  await i18n.init({ lng: 'en', ns: ['common', 'workOrderSections', 'refusals'], defaultNS: 'common', interpolation: { escapeValue: false },
    resources: { en: { common: enCommon, workOrderSections: enWos, refusals: enRefusals } } });
  return render(<I18nextProvider i18n={i18n}><ToastProvider><SectionMaterialModal workOrderId="w1" section={section} onClose={vi.fn()} /></ToastProvider></I18nextProvider>);
}

beforeEach(() => { h.allocations = []; h.set.mockReset(); h.set.mockResolvedValue(undefined); h.plan = 100; });

describe('SectionMaterialModal (FR-WOS-013)', () => {
  it('lists this section\'s allocations only and offers items not yet planned', async () => {
    h.allocations = [{ id: 'a1', sectionId: 's1', itemId: 'i1', quantity: '60.000' }, { id: 'a2', sectionId: 's2', itemId: 'i2', quantity: '5.000' }];
    await mount();
    const list = screen.getByTestId('wos-allocations');
    expect(list.textContent).toContain('Cable');
    expect(list.textContent).toContain('60.000 m');
    expect(list.textContent).not.toContain('Pipe');
    const options = Array.from((screen.getByLabelText('Item') as HTMLSelectElement).options).map((o) => o.textContent);
    expect(options).toContain('PIP · Pipe');
    expect(options).not.toContain('CBL · Cable');
  });

  it('shows the room left under the work order\'s plan and writes the allocation', async () => {
    h.allocations = [{ id: 'a2', sectionId: 's2', itemId: 'i2', quantity: '30.000' }];
    await mount();
    await userEvent.selectOptions(screen.getByLabelText('Item'), 'i2');
    expect(screen.getByText(/Work-order plan 100.000; planned on other sections 30.000; room 70.000/)).toBeTruthy();
    await userEvent.type(screen.getByLabelText('Planned quantity'), '40');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(h.set).toHaveBeenCalledWith({ sectionId: 's1', itemId: 'i2', quantity: '40' });
    expect(screen.getByLabelText('Item')).toHaveValue('');
    expect(screen.getByLabelText('Planned quantity')).toHaveValue('');
  });

  it('refuses a malformed or zero quantity before asking the database', async () => {
    await mount();
    await userEvent.selectOptions(screen.getByLabelText('Item'), 'i1');
    await userEvent.type(screen.getByLabelText('Planned quantity'), '0');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(h.set).not.toHaveBeenCalled();
    expect(await screen.findByText('Enter a quantity above zero, with up to 3 decimals.')).toBeTruthy();
  });

  it('AC-WOS-008 a figure above the plan is refused by the database and the screen says so in plain words', async () => {
    h.set.mockRejectedValue(Object.assign(new Error('WOS_ALLOCATION_CAP: the allocations would be 110.000 against a work-order plan of 100.000'), { code: '23514' }));
    await mount();
    await userEvent.selectOptions(screen.getByLabelText('Item'), 'i1');
    await userEvent.type(screen.getByLabelText('Planned quantity'), '110');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText('Above the work-order plan')).toBeTruthy();
    expect(screen.getByText('The planned quantities would add up to 110.000 against a work-order plan of 100.000.')).toBeTruthy();
    expect(screen.getByLabelText('Item')).toHaveValue('i1');
    expect(screen.getByLabelText('Planned quantity')).toHaveValue('110');
  });

  it('removes an allocation', async () => {
    h.allocations = [{ id: 'a1', sectionId: 's1', itemId: 'i1', quantity: '60.000' }];
    await mount();
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(h.set).toHaveBeenCalledWith({ sectionId: 's1', itemId: 'i1', quantity: null });
  });
});
