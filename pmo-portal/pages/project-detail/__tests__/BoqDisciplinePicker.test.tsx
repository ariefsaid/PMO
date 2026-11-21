/** AC-DPR-003 (#2669) — the contract line's discipline: hidden while the setting is off, saved on change. */
import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';

vi.unmock('@/pages/project-detail/BoqDisciplinePicker'); // test/setup.ts stubs it for the contract-area suites
const h = vi.hoisted(() => ({ on: true, allowed: true, mutate: vi.fn() }));
vi.mock('@/src/hooks/useDisciplineProfit', () => ({
  useDisciplineProfitEnabled: () => ({ data: h.on }),
  useSetItemDiscipline: () => ({ isPending: false, mutate: h.mutate }),
}));
vi.mock('@/src/hooks/useWorkOrderCosts', () => ({ useCostDisciplines: () => ({ data: [{ id: 'civ', code: 'CIV', name: 'Civil' }] }) }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.allowed }));
import BoqDisciplinePicker from '../BoqDisciplinePicker';

beforeEach(() => { vi.clearAllMocks(); h.on = true; h.allowed = true; });
const renderIt = () => render(<ToastProvider><BoqDisciplinePicker projectId="p1" itemId="i1" disciplineId={null} /></ToastProvider>);

it('saves the chosen discipline for the line', async () => {
  renderIt();
  await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: /Discipline/ }), 'Civil');
  await waitFor(() => expect(h.mutate).toHaveBeenCalledWith({ itemId: 'i1', disciplineId: 'civ' }, expect.anything()));
});

it('AC-DPR-001 renders nothing while the setting is off, or for a role that may not write it', () => {
  h.on = false;
  const { unmount } = renderIt();
  expect(screen.queryByRole('combobox')).toBeNull();
  unmount();
  h.on = true; h.allowed = false;
  renderIt();
  expect(screen.queryByRole('combobox')).toBeNull();
});
