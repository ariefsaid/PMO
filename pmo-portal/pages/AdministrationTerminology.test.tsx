import { SettingsSaveProvider, SettingsSaveAction } from '@/src/components/admin/SettingsSave';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';

const permissions = vi.hoisted(() => ({ write: true }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => permissions.write }));

const save = vi.fn().mockResolvedValue(undefined);
const reset = vi.fn().mockResolvedValue(undefined);
vi.mock('@/src/lib/db/orgTerminology', async (orig) => ({
  ...(await orig<typeof import('@/src/lib/db/orgTerminology')>()),
  listOrgTerminology: vi.fn().mockResolvedValue({ en: { workOrder: { singular: 'Job card', plural: 'Job cards' } } }),
  saveOrgTerm: (...a: unknown[]) => save(...a),
  resetOrgTerm: (...a: unknown[]) => reset(...a),
}));
vi.mock('@/src/lib/db/orgRoleNames', async (orig) => ({
  ...(await orig<typeof import('@/src/lib/db/orgRoleNames')>()),
  listOrgRoleNames: vi.fn().mockResolvedValue({}),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'o1' } }) }));

import { listOrgTerminology } from '@/src/lib/db/orgTerminology';
import AdministrationTerminology from './AdministrationTerminology';
import { TERM_KEYS } from '@/src/lib/i18n/orgTerms';

const wrap = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider><SettingsSaveProvider><SettingsSaveAction />
        <AdministrationTerminology />
      </SettingsSaveProvider></ToastProvider>
    </QueryClientProvider>,
  );

describe('AC-TERM-004 Administration › Terminology', () => {
  beforeEach(() => { vi.clearAllMocks(); permissions.write = true; });
  it('#2813 shows the stored wording after the second language fails to save', async () => {
    save.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Failed to fetch'));
    wrap();
    await screen.findByTestId('term-card-workOrder');
    const english = within(screen.getByTestId('term-row-workOrder-en')).getByRole('textbox', { name: 'Singular' });
    const bahasa = within(screen.getByTestId('term-row-workOrder-id')).getByRole('textbox', { name: 'Singular' });
    expect(english).toHaveValue('Job card');
    vi.mocked(listOrgTerminology).mockResolvedValueOnce({ en: { workOrder: { singular: 'Job sheet', plural: 'Job sheets' } } });
    fireEvent.change(english, { target: { value: 'Job sheet' } });
    fireEvent.change(bahasa, { target: { value: 'Pengawas' } });
    const saveButton = screen.getByText('Save', { selector: 'button' });
    fireEvent.click(saveButton);
    await waitFor(() => expect(bahasa).toHaveValue(''));
    expect(english).toHaveValue('Job sheet');
    expect(saveButton).toBeDisabled();
  });
  it('AC-TR-002 lists a card, with its default wording in both languages, for every registry term', async () => {
    wrap();
    await screen.findByTestId('term-card-workOrder');
    for (const key of TERM_KEYS) {
      expect(screen.getByTestId(`term-card-${key}`)).toBeTruthy();
      expect(screen.getByTestId(`term-row-${key}-id`)).toBeTruthy();
    }
    expect(screen.getByTestId('term-card-billingStep').textContent).toContain('billing step');
  });
  it('shows terminology without write controls to a read-only viewer', async () => {
    permissions.write = false;
    wrap();
    const row = await screen.findByTestId('term-row-workOrder-en');
    await waitFor(() => expect((row.querySelector('input') as HTMLInputElement).value).toBe('Job card'));
    expect(screen.getByTestId('term-card-workOrder').querySelectorAll('button')).toHaveLength(0);
    expect((row.querySelector('input') as HTMLInputElement).disabled).toBe(true);
  });
  it('shows the saved override and saves an edit for one language with the page\'s single Save', async () => {
    wrap();
    const row = await screen.findByTestId('term-row-workOrder-en');
    const singular = row.querySelector('input') as HTMLInputElement;
    await waitFor(() => expect(singular.value).toBe('Job card'));
    fireEvent.change(singular, { target: { value: 'SPK' } });
    fireEvent.click(screen.getByText('Save', { selector: 'button' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ key: 'workOrder', locale: 'en', singular: 'SPK' })));
    expect(save).toHaveBeenCalledTimes(1);
  });
  it('one page Save covers both languages', async () => {
    wrap();
    await screen.findByTestId('term-card-workOrder');
    expect(screen.getAllByText('Save', { selector: 'button' })).toHaveLength(1);
    const bahasa = within(screen.getByTestId('term-row-workOrder-id')).getAllByRole('textbox')[0];
    fireEvent.change(bahasa, { target: { value: 'Perintah Kerja' } });
    fireEvent.click(screen.getByText('Save', { selector: 'button' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ key: 'workOrder', locale: 'id', singular: 'Perintah Kerja' })));
  });
  it('resets the term back to the default wording', async () => {
    wrap();
    const card = await screen.findByTestId('term-card-workOrder');
    await waitFor(() => expect((screen.getByTestId('term-row-workOrder-en').querySelector('input') as HTMLInputElement).value).toBe('Job card'));
    await userEvent.click(within(card).getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(reset).toHaveBeenCalledWith('workOrder', 'en'));
  });
  it('offers the role names on the same screen, one switch away', async () => {
    wrap();
    await userEvent.click(await screen.findByRole('button', { name: 'Role names' }));
    expect(await screen.findByTestId('role-name-card-storekeeper')).toBeInTheDocument();
  });
});
