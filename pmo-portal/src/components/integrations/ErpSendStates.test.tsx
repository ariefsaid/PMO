import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from 'i18next';
import idAdministration from '../../../public/locales/id/administration.json';
import enAdministration from '../../../public/locales/en/administration.json';
import type { ConnectProposal, ConnectStatus } from '@/src/lib/repositories/contracts/integrations';

const repo = vi.hoisted(() => ({
  getConnectStatus: vi.fn<() => Promise<ConnectStatus>>(),
  retryConnectSend: vi.fn<(tier: string, id: string) => Promise<void>>(),
  listConnectProposals: vi.fn<(tier: string, kind: string | null, outcome: string | null) => Promise<{ proposals: ConnectProposal[]; nextAfterId: string | null }>>(),
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { integrations: repo } }));

import { ErpSendStates } from './ErpSendStates';
import { AccountLinkNotes } from './DirectCostAccounts';

const status = (waitingForSend: number): ConnectStatus => ({ run: null, census: [], waitingForSend });
const proposal = (over: Partial<ConnectProposal>): ConnectProposal => ({
  id: 'p', kind: 'item', outcome: 'review', pmo_ids: ['x'], external_ids: [], reason: null, reason_text: null, snapshot: {}, state: 'open', ...over,
});

function answer(waiting: number, review: ConnectProposal[] = [], sends: ConnectProposal[] = []) {
  repo.getConnectStatus.mockResolvedValue(status(waiting));
  repo.listConnectProposals.mockImplementation(async (_t, _k, outcome) => ({ proposals: outcome === 'review' ? review : sends, nextAfterId: null }));
}
const renderIt = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ErpSendStates enabled /></QueryClientProvider>,
);
afterEach(async () => { cleanup(); vi.clearAllMocks(); await i18n.changeLanguage('en'); });

describe('ECA3-T11 ErpSendStates', () => {
  it('NFR-ECA-004 an accepted send shows "Sending to the ERP" until the ERP confirms; a rejection returns as "Needs a decision" with the reason', async () => {
    answer(3, [proposal({ id: 'r1', reason: 'rejected', snapshot: { name: 'Semen 50 kg' }, reason_text: 'The ERP refused this item: Value missing' })]);
    renderIt();
    expect(await screen.findByText('Sending to the ERP')).toBeTruthy();
    expect(screen.getByText(/3 waiting for the ERP to confirm/)).toBeTruthy();
    expect(await screen.findByText('Semen 50 kg')).toBeTruthy();
    expect(screen.getByText('Needs a decision')).toBeTruthy();
    expect(screen.getByText('The ERP refused this item: Value missing')).toBeTruthy();
    expect(screen.queryByText(/done|complete|sent/i)).toBeNull();   // a waiting row is never reported as finished
  });

  it.each(['en', 'id'])('AC-ECX-030 identifies each account and gives truthful guidance in %s', async (language) => {
    i18n.addResourceBundle('en', 'administration', enAdministration, true, true);
    i18n.addResourceBundle('id', 'administration', idAdministration, true, true);
    await i18n.changeLanguage(language);
    answer(0, [
      proposal({ id: 'a1', kind: 'account', reason: 'held', snapshot: { accountName: 'Site materials' }, reason_text: 'PMO could not confirm whether the account was created; your administrator has been told.' }),
      proposal({ id: 'a2', kind: 'account', reason: 'rejected', snapshot: { accountName: 'Site labour' }, reason_text: 'PMO could not create the account; your administrator has been told.' }),
    ]);
    renderIt();
    expect(await screen.findByText('Site materials')).toBeTruthy();
    expect(screen.getByText('Site labour')).toBeTruthy();
    expect(screen.queryByText(/administrator has been told|administrator Anda telah diberi tahu/i)).toBeNull();
    expect(screen.getAllByText(language === 'en' ? /contact your administrator/i : /hubungi administrator/i)).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /send it again|kirim lagi/i })).toBeNull();
  });

  it('AC-ECX-030 an account the ERP holds but PMO cannot use as a direct-cost account is refused in words that do not send the person to the ERP', async () => {
    answer(0, [proposal({ id: 'r3', kind: 'account', reason: 'rejected', snapshot: { name: 'Site materials' }, reason_text: 'The ERP account with this name cannot be used for direct costs. Ask again with a different account name.' })]);
    renderIt();
    expect(await screen.findByText('The ERP account with this name cannot be used for direct costs. Ask again with a different account name.')).toBeTruthy();
  });

  it('a send the ERP could not confirm is a decision with its plain reason, not a success', async () => {
    answer(0, [proposal({ id: 'r2', kind: 'project', reason: 'held', snapshot: { name: 'Jembatan' }, reason_text: 'We could not confirm whether the ERP created this record. Look for it in the ERP by name and tax id; if it is not there, send it again.' })]);
    renderIt();
    expect(await screen.findByText(/We could not confirm whether the ERP created this record/)).toBeTruthy();
    expect(screen.queryByText('Sending to the ERP')).toBeNull();
  });

  it('AC-ECX-030 an unconfirmed account waits for the administrator without an unsafe retry', async () => {
    answer(0, [proposal({ id: 'a1', kind: 'account', reason: 'held', snapshot: { name: 'Materials' }, reason_text: 'PMO could not confirm whether the account was created; your administrator has been told.' })]);
    renderIt();
    expect(await screen.findByText('PMO could not confirm whether the account was created. Contact your administrator.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /send it again/i })).toBeNull();
  });

  it('AC-ECX-030 shows an unresolved account for administrator attention', async () => {
    answer(0, [proposal({ id: 'a1', kind: 'account', reason: 'unresolved' as ConnectProposal['reason'], snapshot: { accountName: 'Materials' }, reason_text: 'PMO could not confirm this account. Contact your administrator.' })]);
    renderIt();
    expect(await screen.findByText('Materials')).toBeTruthy();
    expect(screen.getByText(/could not confirm whether the account was created/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /send it again/i })).toBeNull();
  });

  it('AC-ECX-030 Finance can read an account hold even when the all-kinds list is forbidden', async () => {
    repo.getConnectStatus.mockResolvedValue(status(0));
    repo.listConnectProposals.mockImplementation(async (_tier, kind, outcome) => {
      if (kind === null) throw new Error('Forbidden');
      return { proposals: kind === 'account' && outcome === 'review' ? [proposal({ id: 'a1', kind: 'account', reason: 'held', snapshot: { name: 'Materials' }, reason_text: 'PMO could not confirm whether the account was created; your administrator has been told.' })] : [], nextAfterId: null };
    });
    renderIt();
    expect(await screen.findByText('Materials')).toBeTruthy();
    expect(screen.getByText('PMO could not confirm whether the account was created. Contact your administrator.')).toBeTruthy();
  });

  it('AC-ECX-030 a completed send refreshes the different-parent notice without a page reload', async () => {
    let applied = false;
    repo.getConnectStatus.mockResolvedValue(status(2));
    repo.listConnectProposals.mockImplementation(async (_tier, kind, outcome) => ({
      proposals: kind === 'account' && outcome === 'send' && applied ? [proposal({ id: 'a1', kind: 'account', outcome: 'send', state: 'applied', reason_text: 'Materials already exists under Indirect; linked there.' })] : [], nextAfterId: null,
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><ErpSendStates enabled /><AccountLinkNotes /></QueryClientProvider>);
    await screen.findByText('Sending to the ERP');
    expect(screen.queryByText(/was already in the ERP under Indirect/)).toBeNull();
    applied = true;
    act(() => client.setQueryData(['integrations', 'connect-status', 'erpnext'], status(1)));
    expect(await screen.findByText('Materials was already in the ERP under Indirect, so PMO linked it there.')).toBeTruthy();
  });

  it('I2 a held send has a way out: "It is not there: send it again" releases it and the list is read again; a refused send has no such button', async () => {
    repo.retryConnectSend.mockResolvedValue(undefined);
    answer(0, [proposal({ id: 'r2', kind: 'project', reason: 'held', snapshot: { name: 'Jembatan' }, reason_text: 'We could not confirm' }),
      proposal({ id: 'r1', reason: 'rejected', snapshot: { name: 'Semen' }, reason_text: 'The ERP refused this item' })]);
    renderIt();
    fireEvent.click(await screen.findByRole('button', { name: 'It is not there: send it again' }));
    await waitFor(() => expect(repo.retryConnectSend).toHaveBeenCalledWith('erpnext', 'r2'));
    expect(screen.getAllByRole('button')).toHaveLength(1);
    await waitFor(() => expect(repo.listConnectProposals.mock.calls.length).toBeGreaterThan(2));
  });

  it('I2 a retry that fails says so in plain words', async () => {
    repo.retryConnectSend.mockRejectedValue(new Error('boom'));
    answer(0, [proposal({ id: 'r2', kind: 'project', reason: 'held', snapshot: { name: 'Jembatan' }, reason_text: 'We could not confirm' })]);
    renderIt();
    fireEvent.click(await screen.findByRole('button', { name: 'It is not there: send it again' }));
    expect((await screen.findByRole('alert')).textContent).toBe('We could not send it again. Try again in a moment.');
  });

  it('M10 a matcher review row is not a send state, even one that names no ERP record', async () => {
    answer(0, [proposal({ id: 'r3', reason: 'ambiguous', external_ids: [], reason_text: 'Two PMO companies share this name.' })]);
    const { container } = renderIt();
    await waitFor(() => expect(repo.listConnectProposals).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe('');
  });

  it('PQ-ECA-1 people the ERP cannot take are listed to add by hand, never sent and never invented', async () => {
    answer(0, [], [proposal({ id: 'e1', kind: 'employee', outcome: 'send', snapshot: { name: 'Siti Rahma' } }), proposal({ id: 'e2', kind: 'employee', outcome: 'send', snapshot: { name: 'Budi Santoso' } })]);
    renderIt();
    expect(await screen.findByText(/Add these people in the ERP/)).toBeTruthy();
    expect(await screen.findByText('Siti Rahma')).toBeTruthy();
    expect(screen.getByText('Budi Santoso')).toBeTruthy();
    expect(repo.listConnectProposals).toHaveBeenCalledWith('erpnext', 'employee', 'send', null);
  });

  it('nothing waiting, nothing refused, nobody to add: the section is not shown', async () => {
    answer(0);
    const { container } = renderIt();
    await waitFor(() => expect(repo.getConnectStatus).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe('');
  });

  it('is silent while disabled and when the status cannot be read', async () => {
    repo.getConnectStatus.mockRejectedValue(new Error('no'));
    repo.listConnectProposals.mockRejectedValue(new Error('no'));
    const { container } = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ErpSendStates enabled /></QueryClientProvider>,
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe('');
    cleanup();
    vi.clearAllMocks();
    render(<QueryClientProvider client={new QueryClient()}><ErpSendStates enabled={false} /></QueryClientProvider>);
    expect(repo.getConnectStatus).not.toHaveBeenCalled();
  });
});

describe('AC-ODS-003 Odoo send states', () => {
  const renderOdoo = () => render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ErpSendStates enabled tier="odoo" /></QueryClientProvider>,
  );

  it('AC-ODS-003 waiting sends and a held record are read from Odoo, named Odoo, and retry goes to Odoo', async () => {
    repo.retryConnectSend.mockResolvedValue(undefined);
    answer(3, [proposal({ id: 'h1', kind: 'project', reason: 'held', snapshot: { name: 'PT Sinar Baja' }, reason_text: 'We could not confirm whether Odoo created this record' })]);
    renderOdoo();
    expect(await screen.findByText('Sending to Odoo')).toBeTruthy();
    expect(screen.getByText(/3 waiting for Odoo to confirm/)).toBeTruthy();
    expect(screen.getByText('Records going to Odoo')).toBeTruthy();
    expect(repo.getConnectStatus).toHaveBeenCalledWith('odoo');
    expect(repo.listConnectProposals.mock.calls[0][0]).toBe('odoo');
    expect(await screen.findByText('PT Sinar Baja')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'It is not there: send it again' }));
    await waitFor(() => expect(repo.retryConnectSend).toHaveBeenCalledWith('odoo', 'h1'));
  });

  it('AC-ODS-003 people Odoo cannot take are listed to add in Odoo', async () => {
    answer(0, [], [proposal({ id: 'e1', kind: 'employee', outcome: 'send', snapshot: { name: 'Siti Rahma' } })]);
    renderOdoo();
    expect(await screen.findByText(/Add these people in Odoo/)).toBeTruthy();
    expect(repo.listConnectProposals).toHaveBeenCalledWith('odoo', 'employee', 'send', null);
  });
});

describe('#2429 ERP send refusals read in Bahasa', () => {
  afterEach(async () => { await i18n.changeLanguage('en'); });
  // every sentence the server can store for a refused or unconfirmed send, as written by the send drain and its result functions
  const KNOWN = [
    'This record is no longer in PMO, or (an item) no longer on an open purchase.',
    'This ERP asks for a birth date and gender for each person, which PMO does not hold. Add this person in the ERP.',
    'Odoo people are not sent from PMO yet. Add this person in Odoo.',
    'The Admin who accepted this is no longer an Admin. Accept it again.',
    'Two ERP records match this company. Link the right one by hand.',
    'This record is already linked to another ERP record.',
    'We could not finish sending this record. Check it in the ERP, then try again.',
    'The ERP refused this item: Value missing',
    'The ERP refused this project. Check it in the ERP, then try again.',
    'The ERP refused this item: its unit has no match in Odoo yet',
    'We could not confirm whether the ERP created this record. Look for it in the ERP by name and tax id; if it is not there, send it again.',
    'We could not confirm whether Odoo created this record. Look for it in Odoo by name and tax id; if it is not there, send it again.',
    'Choose the cost-account plan for projects first, then send this project again.',
    'This project has no project number yet, so its cost account cannot be named. Give it one, then send it again.',
    'This row could not be applied',
    'Something the server said that we never mapped',
  ];
  it('shows a held account in Bahasa without directing Finance into the ERP', async () => {
    i18n.addResourceBundle('id', 'administration', idAdministration, true, true);
    await i18n.changeLanguage('id');
    answer(0, [proposal({ id: 'a1', kind: 'account', reason: 'held', snapshot: { name: 'Materials' }, reason_text: 'PMO could not confirm whether the account was created; your administrator has been told.' })]);
    renderIt();
    expect(await screen.findByText('PMO belum dapat memastikan akun telah dibuat. Hubungi administrator Anda.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /kirim lagi|send it again/i })).toBeNull();
  });

  it('shows no English sentence for any known refusal, and one plain Bahasa line for an unmapped one', async () => {
    i18n.addResourceBundle('id', 'administration', idAdministration, true, true);
    await i18n.changeLanguage('id');
    answer(0, KNOWN.map((text, i) => proposal({ id: `k${i}`, reason: 'rejected', snapshot: { name: `Rec ${i}` }, reason_text: text })));
    renderIt();
    await screen.findByText('Rec 0');
    const lines = screen.getAllByText(/\S/).map((n) => n.textContent ?? '');
    for (const text of KNOWN) expect(lines.filter((l) => l.includes(text)), text).toEqual([]);
    // the ERP's own reason is kept verbatim and marked [data-erp-reason]; everything else must hold no English
    const english = screen.queryAllByText(/ERP refused|Value missing|could not|no longer|already linked/i).filter((n) => !n.closest('[data-erp-reason]'));
    expect(english.map((n) => n.textContent)).toEqual([]);
    expect(screen.getAllByText('Kami tidak dapat mengirim data ini. Periksa di ERP, lalu coba lagi.')).toHaveLength(1);
  });
  it('under Bahasa a refusal with an ERP reason shows the translated sentence, then the ERP\'s own reason verbatim', async () => {
    i18n.addResourceBundle('id', 'administration', idAdministration, true, true);
    await i18n.changeLanguage('id');
    answer(0, [proposal({ id: 'e2', reason: 'rejected', snapshot: { name: 'Semen' }, reason_text: 'The ERP refused this item: Account 5100 is not a group account' })]);
    renderIt();
    const reason = await screen.findByText(/^Alasan dari ERP: Account 5100 is not a group account$/);
    expect(reason.closest('[data-erp-reason]')).not.toBeNull();
    expect(screen.queryByText(/The ERP refused this item/)).toBeNull();
    expect(screen.getAllByText(/\S/).some((n) => /menolak item ini/i.test(n.textContent ?? '') && /ERP/.test(n.textContent ?? ''))).toBe(true);
  });
  it('keeps the ERP\'s own reason in English', async () => {
    answer(0, [proposal({ id: 'e1', reason: 'rejected', snapshot: { name: 'Semen' }, reason_text: 'The ERP refused this item: Value missing' })]);
    renderIt();
    expect(await screen.findByText('The ERP refused this item: Value missing')).toBeTruthy();
  });
});
