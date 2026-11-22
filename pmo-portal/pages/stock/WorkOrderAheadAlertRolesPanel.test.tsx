import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const h = vi.hoisted(() => ({ roles: vi.fn(), setRoles: vi.fn(), errorText: vi.fn(() => '') }));
vi.mock('@/src/lib/repositories/workOrderMaterialAlerts', () => ({ workOrderMaterialAlertsRepository: { roles: h.roles, setRoles: h.setRoles } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }) }));
vi.mock('@/src/components/stock/useStockErrorText', () => ({ useStockErrorText: () => h.errorText }));
vi.mock('@/src/hooks/useOrgRoleNames', () => ({ useBuiltInRoleName: () => (key: string) => `name:${key}` }));

import { WorkOrderAheadAlertRolesPanel } from './WorkOrderAheadAlertRolesPanel';

const mount = (canEdit: boolean) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><WorkOrderAheadAlertRolesPanel canEdit={canEdit} /></QueryClientProvider>);
beforeEach(() => { h.roles.mockReset(); h.setRoles.mockReset(); h.errorText.mockReset(); h.errorText.mockReturnValue(''); h.roles.mockResolvedValue([]); h.setRoles.mockResolvedValue([]); });

describe('WorkOrderAheadAlertRolesPanel', () => {
  it('AC-MVP-013 an Admin ticks a role and saves the key', async () => {
    mount(true);
    const box = await screen.findByRole('checkbox', { name: 'name:site_supervisor' });
    await waitFor(() => expect((box as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(box);
    fireEvent.click(screen.getByRole('button', { name: 'siteWork.materialProgress.alert.roles.save' }));
    await waitFor(() => expect(h.setRoles).toHaveBeenCalledWith(['site_supervisor']));
  });

  it('AC-MVP-013 the list does not offer the light roles, who are never told', async () => {
    mount(true);
    await screen.findByRole('checkbox', { name: 'name:site_supervisor' });
    expect(screen.queryByRole('checkbox', { name: 'name:foreman' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'name:field_user' })).toBeNull();
  });

  it('AC-MVP-013 a non-Admin sees the ticked roles read-only, with the reason and no save', async () => {
    h.roles.mockResolvedValue(['site_supervisor']);
    mount(false);
    const box = await screen.findByRole('checkbox', { name: 'name:site_supervisor' });
    await waitFor(() => expect(box.getAttribute('aria-checked')).toBe('true'));
    expect((box as HTMLButtonElement).disabled || box.getAttribute('aria-disabled') === 'true' || box.hasAttribute('data-disabled')).toBe(true);
    expect(screen.getByText('siteWork.materialProgress.alert.roles.adminOnly')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'siteWork.materialProgress.alert.roles.save' })).toBeNull();
  });

  it('AC-MVP-013 an empty list says who is told by default', async () => {
    mount(true);
    expect(await screen.findByText('siteWork.materialProgress.alert.roles.none')).toBeTruthy();
  });

  it('AC-MVP-013 a refused save shows the refusal sentence', async () => {
    h.errorText.mockReturnValue('Only an Admin can change this.');
    h.setRoles.mockRejectedValue(new Error('refused'));
    mount(true);
    const box = await screen.findByRole('checkbox', { name: 'name:engineer' });
    await waitFor(() => expect((box as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(box);
    fireEvent.click(screen.getByRole('button', { name: 'siteWork.materialProgress.alert.roles.save' }));
    expect(await screen.findByText('Only an Admin can change this.')).toBeTruthy();
  });
});
