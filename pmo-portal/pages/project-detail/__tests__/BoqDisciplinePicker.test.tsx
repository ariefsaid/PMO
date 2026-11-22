/** AC-DPR-003 (#2669) — the contract line's discipline: hidden while the setting is off, saved on change. */
import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';

vi.unmock('@/pages/project-detail/BoqDisciplinePicker'); // test/setup.ts stubs it for the contract-area suites
const h = vi.hoisted(() => ({ on: true, allowed: true, mutate: vi.fn(), list: [{ id: 'civ', code: 'CIV', name: 'Civil' }] as Array<{ id: string; code: string; name: string }> }));
vi.mock('@/src/hooks/useOrgSwitch', () => ({ useOrgSwitch: () => ({ data: h.on }) }));
vi.mock('@/src/hooks/useDisciplineProfit', () => ({
  useSetItemDiscipline: () => ({ isPending: false, mutate: h.mutate }),
}));
vi.mock('@/src/hooks/useWorkOrderCosts', () => ({ useCostDisciplines: () => ({ data: h.list }) }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.allowed }));
import BoqDisciplinePicker from '../BoqDisciplinePicker';

beforeEach(() => { vi.clearAllMocks(); h.on = true; h.allowed = true; h.list = [{ id: 'civ', code: 'CIV', name: 'Civil' }]; });
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

it('with no disciplines yet it says so and who adds them, never an empty picker', () => {
  h.list = [];
  renderIt();
  expect(screen.getByTestId('boq-discipline-none').textContent).toBe('No disciplines yet. An Admin adds them under Cost disciplines in Project setup.');
  expect(screen.queryByRole('combobox')).toBeNull();
});
