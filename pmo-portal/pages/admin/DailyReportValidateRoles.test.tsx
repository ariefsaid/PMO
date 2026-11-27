import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
import { BahasaProvider } from '@/test/bahasa';
import { AuthContext, type Role } from '@/src/auth/AuthContext';

const h = vi.hoisted(() => ({
  realRole: 'Admin' as Role,
  effectiveRole: 'Admin' as Role,
  builtInOn: true,
  get: vi.fn(),
  set: vi.fn(),
}));

vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: h.realRole, effectiveRole: h.effectiveRole }),
}));
vi.mock('@/src/hooks/useOrgSwitch', () => ({ useOrgSwitch: () => ({ data: h.builtInOn }) }));
vi.mock('@/src/hooks/useOrgRoleNames', () => ({
  useBuiltInRoleName: () => (key: string) => (key === 'site_supervisor' ? 'Field Superintendent' : key),
}));
vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    dailySiteReport: {
      validateRoles: h.get,
      setValidateRoles: h.set,
    },
  },
}));
vi.unmock('@/src/hooks/useDailyReportValidateRoles');

import DailyReportValidateRoles from './DailyReportValidateRoles';

const mount = (bahasa = false) => {
  const tree = (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AuthContext.Provider value={{ currentUser: { id: 'u1', org_id: 'org-1', built_in_role: null }, role: h.realRole } as never}>
        <ToastProvider><DailyReportValidateRoles /></ToastProvider>
      </AuthContext.Provider>
    </QueryClientProvider>
  );
  return render(bahasa ? <BahasaProvider>{tree}</BahasaProvider> : tree);
};

describe('Administration › Validate daily site reports (AC-DRVR-004..006)', () => {
  beforeEach(() => {
    h.realRole = 'Admin';
    h.effectiveRole = 'Admin';
    h.builtInOn = true;
    h.get.mockReset().mockResolvedValue([]);
    h.set.mockReset().mockImplementation(async (keys: string[]) => keys);
  });

  it('AC-DRVR-004 defaults to no job role ticked, hides field roles, shows custom role names, and saves through the repository', async () => {
    const user = userEvent.setup();
    mount();
    // #1126: nothing chosen reads as one line; the checklist opens from "Choose roles".
    expect(await screen.findByText('No role chosen')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Choose roles' }));
    const box = await screen.findByRole('checkbox', { name: 'Field Superintendent' });
    expect(box).not.toBeChecked();
    expect(screen.queryAllByRole('checkbox', { checked: true })).toHaveLength(0);
    // Field roles cannot validate site reports in the database, so they are never offered.
    expect(screen.queryByRole('checkbox', { name: 'foreman' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'field_user' })).toBeNull();

    await user.click(box);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.set).toHaveBeenCalledWith(['site_supervisor']));
  });

  it('AC-DRVR-004 is read-only for a non-Admin and when viewing as another role', async () => {
    h.realRole = 'Executive';
    h.effectiveRole = 'Executive';
    h.get.mockResolvedValue(['site_supervisor']);
    const { unmount } = mount();
    // Read-only: the chosen role shows; the checklist cannot be opened.
    expect(await screen.findByText('Field Superintendent')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Choose roles' })).toBeNull();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.getByText('Only an Admin can change this.')).toBeInTheDocument();
    unmount();

    h.realRole = 'Admin';
    h.effectiveRole = 'Project Manager';
    mount();
    expect(await screen.findByText('Field Superintendent')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Choose roles' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('AC-DRVR-004 disables checkboxes with a clear explanation when built-in roles are off', async () => {
    h.builtInOn = false;
    mount();
    expect(await screen.findByText('No role chosen')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Choose roles' })).toBeNull();
    expect(screen.getByText(/Turn on built-in roles/)).toBeInTheDocument();
  });

  it('AC-DRVR-006 renders refusal codes and Bahasa Indonesia copy cleanly', async () => {
    h.set.mockRejectedValue(Object.assign(new Error('DSR_VALIDATE_ROLE_OFF: turn on built-in roles before naming roles that validate site reports'), { code: 'P0001' }));
    const user = userEvent.setup();
    const { unmount } = mount();
    await user.click(await screen.findByRole('button', { name: 'Choose roles' }));
    await user.click(await screen.findByRole('checkbox', { name: 'Field Superintendent' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/before naming roles that validate site reports/i)).toBeInTheDocument();
    unmount();

    mount(true);
    expect(await screen.findByRole('heading', { name: 'Validasi laporan harian lokasi' })).toBeInTheDocument();
    expect(screen.queryByText('Validate daily site reports')).toBeNull();
  });
});

it('keeps unsaved role choices when saved roles change and offers reload', async () => {
  h.realRole = 'Admin'; h.effectiveRole = 'Admin'; h.builtInOn = true; h.get.mockResolvedValue([]); h.set.mockClear();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><ToastProvider><DailyReportValidateRoles /></ToastProvider></QueryClientProvider>);
  await userEvent.click(await screen.findByRole('button', { name: 'Choose roles' })); await userEvent.click(screen.getByRole('checkbox', { name: 'Field Superintendent' }));
  act(() => qc.setQueryData(['daily-report-validate-roles', 'org-1'], ['project_control_manager']));
  expect(await screen.findByRole('button', { name: /Reload saved/ })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(h.set).toHaveBeenCalledWith(['site_supervisor']);
});
