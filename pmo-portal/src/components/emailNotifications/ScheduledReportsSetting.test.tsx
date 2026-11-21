/**
 * AC-SCH-011 — scheduled reports inside the Administration email card. An Admin lists, creates, switches off and archives a
 * report; a non-Admin sees none of it; the labels read in Bahasa Indonesia; and an organisation with no reports and no email event
 * switched on sees the card exactly as before (no Scheduled reports heading at all).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';
import en from '../../../public/locales/en/emailNotifications.json';
import id from '../../../public/locales/id/emailNotifications.json';

const email = vi.hoisted(() => ({ getSettings: vi.fn(), setEvent: vi.fn(), setLocale: vi.fn(), getMyOptOut: vi.fn(), setMyOptOut: vi.fn() }));
const sched = vi.hoisted(() => ({ list: vi.fn(), recipientOptions: vi.fn(), save: vi.fn(), setEnabled: vi.fn(), archive: vi.fn() }));
vi.mock('@/src/lib/repositories/emailNotifications', () => ({ emailNotificationsRepository: email }));
vi.mock('@/src/lib/repositories/scheduledReports', () => ({ scheduledReportsRepository: sched }));

import { EmailNotificationsSetting } from './EmailNotificationsSetting';

const events = (on: boolean) =>
  ['approval_request', 'billing_step', 'overdue_item', 'document_expiry'].map((event, i) => ({ event, enabled: on && i === 0, extraRoles: [] as string[] }));
const REPORT = {
  id: 'r1', name: 'Morning progress', kind: 'daily_progress', frequency: 'daily', weekday: null, sendTime: '08:00',
  recipientUserIds: [], recipientRoles: ['Finance'], enabled: true,
};

function i18n(lng: 'en' | 'id') {
  const inst = i18next.createInstance();
  void inst.init({ lng, fallbackLng: 'en', ns: ['emailNotifications'], defaultNS: 'emailNotifications', resources: { en: { emailNotifications: en }, id: { emailNotifications: id } }, initImmediate: false });
  return inst;
}
const renderUi = (role: 'Admin' | 'Finance' = 'Admin', lng: 'en' | 'id' = 'en') =>
  render(
    <I18nextProvider i18n={i18n(lng)}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
        <ImpersonationProvider realRole={role}><ToastProvider><EmailNotificationsSetting /></ToastProvider></ImpersonationProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  );

beforeEach(() => {
  [...Object.values(email), ...Object.values(sched)].forEach((f) => f.mockReset());
  email.getSettings.mockResolvedValue({ locale: 'en', events: events(true) });
  sched.list.mockResolvedValue([REPORT]);
  sched.recipientOptions.mockResolvedValue([{ id: 'u1', name: 'Sari' }]);
  sched.save.mockResolvedValue('r2');
  sched.setEnabled.mockResolvedValue(undefined);
  sched.archive.mockResolvedValue(undefined);
});

describe('AC-SCH-011 scheduled reports in the email card', () => {
  it('an organisation with no email event on and no report sees the card as before: no Scheduled reports section', async () => {
    email.getSettings.mockResolvedValue({ locale: 'en', events: events(false) });
    sched.list.mockResolvedValue([]);
    renderUi();
    await screen.findByRole('switch', { name: 'Approval requests' });
    await waitFor(() => expect(sched.list).toHaveBeenCalled());
    expect(screen.getAllByRole('switch')).toHaveLength(4);
    expect(screen.queryByText('Scheduled reports')).toBeNull();
    expect(screen.queryByText('Add a scheduled report')).toBeNull();
  });

  it('with an event on and no report, only the heading and its empty state are added', async () => {
    sched.list.mockResolvedValue([]);
    renderUi();
    expect(await screen.findByRole('heading', { name: 'Scheduled reports' })).toBeInTheDocument();
    expect(await screen.findByText('No scheduled reports yet.')).toBeInTheDocument();
    expect(screen.getAllByRole('switch')).toHaveLength(4);
  });

  it('lists a report with its schedule and switches it off', async () => {
    renderUi();
    expect(await screen.findByText('Morning progress')).toBeInTheDocument();
    expect(screen.getByText(/Daily progress summary · Every day at 08:00/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: 'Morning progress' }));
    await waitFor(() => expect(sched.setEnabled).toHaveBeenCalledWith('r1', false));
  });

  it('an Admin creates a weekly report for a role and a person', async () => {
    renderUi();
    fireEvent.click(await screen.findByRole('button', { name: 'Add a scheduled report' }));
    const form = await screen.findByRole('form', { name: 'Scheduled report' });
    expect(screen.getByRole('button', { name: 'Save report' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Weekly overdue' } });
    fireEvent.change(screen.getByLabelText('Report'), { target: { value: 'overdue_tasks' } });
    fireEvent.change(screen.getByLabelText('Repeats'), { target: { value: 'weekly' } });
    fireEvent.change(screen.getByLabelText('On'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText(/^Send time/), { target: { value: '17:30' } });
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Finance' }));
    fireEvent.click(await within(form).findByRole('checkbox', { name: 'Sari' }));
    expect(form).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save report' }));
    await waitFor(() => expect(sched.save).toHaveBeenCalledWith({
      id: null, name: 'Weekly overdue', kind: 'overdue_tasks', frequency: 'weekly', weekday: 5, sendTime: '17:30',
      recipientUserIds: ['u1'], recipientRoles: ['Finance'], enabled: true,
    }));
  });

  it('archives a report after confirmation', async () => {
    renderUi();
    fireEvent.click(await screen.findByRole('button', { name: 'Archive' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(sched.archive).toHaveBeenCalledWith('r1'));
  });

  it('a non-Admin gets no scheduled-reports controls and no read', async () => {
    renderUi('Finance');
    await screen.findByText('Approval requests');
    expect(screen.queryByText('Scheduled reports')).toBeNull();
    expect(sched.list).not.toHaveBeenCalled();
  });

  it('renders the labels in Bahasa Indonesia', async () => {
    renderUi('Admin', 'id');
    expect(await screen.findByRole('heading', { name: 'Laporan terjadwal' })).toBeInTheDocument();
    expect(await screen.findByText(/Ringkasan kemajuan harian · Setiap hari pukul 08:00/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tambah laporan terjadwal' })).toBeInTheDocument();
  });
});
