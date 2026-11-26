import { SettingsSaveProvider, SettingsSaveAction } from '@/src/components/admin/SettingsSave';
/**
 * AC-EML-014 — Administration email settings and the per-user opt-out. An Admin toggles events, picks extra roles and the
 * email language; a non-Admin gets no controls; the labels read in Bahasa Indonesia; the opt-out switch saves.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';
import en from '../../../public/locales/en/emailNotifications.json';
import id from '../../../public/locales/id/emailNotifications.json';

const repo = vi.hoisted(() => ({
  getSettings: vi.fn(), setEvent: vi.fn(), setLocale: vi.fn(), getMyOptOut: vi.fn(), setMyOptOut: vi.fn(),
}));
vi.mock('@/src/lib/repositories/emailNotifications', () => ({ emailNotificationsRepository: repo }));

import { EmailNotificationsSetting } from './EmailNotificationsSetting';
import { EmailOptOutSetting } from './EmailOptOutSetting';

const DEFAULTS = {
  locale: 'en',
  events: ['approval_request', 'billing_step', 'overdue_item', 'document_expiry'].map((event) => ({ event, enabled: false, extraRoles: [] as string[] })),
};

function i18n(lng: 'en' | 'id') {
  const inst = i18next.createInstance();
  void inst.init({ lng, fallbackLng: 'en', ns: ['emailNotifications'], defaultNS: 'emailNotifications', resources: { en: { emailNotifications: en }, id: { emailNotifications: id } }, initImmediate: false });
  return inst;
}
const renderUi = (ui: React.ReactElement, role: 'Admin' | 'Finance' = 'Admin', lng: 'en' | 'id' = 'en') =>
  render(
    <I18nextProvider i18n={i18n(lng)}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
        <ImpersonationProvider realRole={role}><ToastProvider>{ui}</ToastProvider></ImpersonationProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  );

beforeEach(() => {
  Object.values(repo).forEach((f) => f.mockReset());
  repo.getSettings.mockResolvedValue(DEFAULTS);
  repo.setEvent.mockResolvedValue(undefined);
  repo.setLocale.mockResolvedValue(undefined);
  repo.getMyOptOut.mockResolvedValue(false);
  repo.setMyOptOut.mockResolvedValue(undefined);
});

describe('AC-EML-014 Administration email settings', () => {
  it('shows every event off by default and an Admin switches one on', async () => {
    renderUi(<EmailNotificationsSetting />);
    const sw = await screen.findByRole('switch', { name: 'Approval requests' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(screen.getAllByRole('switch')).toHaveLength(4);
    fireEvent.click(sw);
    await waitFor(() => expect(repo.setEvent).toHaveBeenCalledWith('approval_request', true, []));
  });

  it('an enabled event offers extra roles and saves the chosen role', async () => {
    repo.getSettings.mockResolvedValue({ ...DEFAULTS, events: DEFAULTS.events.map((e) => (e.event === 'overdue_item' ? { ...e, enabled: true } : e)) });
    renderUi(<EmailNotificationsSetting />);
    const finance = await screen.findByRole('checkbox', { name: 'Finance' });
    fireEvent.click(finance);
    await waitFor(() => expect(repo.setEvent).toHaveBeenCalledWith('overdue_item', true, ['Finance']));
  });

  it('an Admin changes the email language', async () => {
    renderUi(<EmailNotificationsSetting />);
    const select = await screen.findByLabelText('Email language');
    fireEvent.change(select, { target: { value: 'id' } });
    await waitFor(() => expect(repo.setLocale).toHaveBeenCalledWith('id'));
  });

  it('a non-Admin gets no switch and no language control', async () => {
    renderUi(<EmailNotificationsSetting />, 'Finance');
    await screen.findByText('Approval requests');
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByLabelText('Email language')).toBeNull();
  });

  it('reads in Bahasa Indonesia', async () => {
    renderUi(<EmailNotificationsSetting />, 'Admin', 'id');
    expect(await screen.findByRole('switch', { name: 'Permintaan persetujuan' })).toBeInTheDocument();
    expect(screen.getByText('Notifikasi email')).toBeInTheDocument();
    expect(screen.getByLabelText('Bahasa email')).toBeInTheDocument();
  });

  it('a failed load offers a retry', async () => {
    repo.getSettings.mockRejectedValueOnce(new Error('x'));
    renderUi(<EmailNotificationsSetting />);
    expect(await screen.findByText('Email settings could not be loaded.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('switch', { name: 'Approval requests' })).toBeInTheDocument();
  });
});

describe('AC-EML-014 per-user opt-out', () => {
  it('is on by default and opting out saves', async () => {
    renderUi(<EmailOptOutSetting />, 'Finance');
    const sw = await screen.findByRole('switch', { name: 'Send me email notifications' });
    expect(sw).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(sw);
    await waitFor(() => expect(repo.setMyOptOut).toHaveBeenCalledWith(true));
  });

  it.each([false, true])('labels the stored opt-out state %s without reversing the switch', async (optedOut) => {
    repo.getMyOptOut.mockResolvedValue(optedOut);
    renderUi(<EmailOptOutSetting />, 'Finance');
    const sw = await screen.findByRole('switch', { name: 'Send me email notifications' });
    expect(sw).toHaveAttribute('aria-checked', String(!optedOut));
    expect(screen.getByText('Receive emails from PMO about approvals, overdue items and expiring documents. In-app notifications are not affected.')).toBeInTheDocument();
    expect(screen.getByText(optedOut ? 'Email notifications are off' : 'Email notifications are on')).toBeInTheDocument();
    expect(repo.setMyOptOut).not.toHaveBeenCalled();
  });

  it('reads in Bahasa Indonesia', async () => {
    renderUi(<EmailOptOutSetting />, 'Finance', 'id');
    expect(await screen.findByRole('switch', { name: 'Kirim notifikasi email kepada saya' })).toBeInTheDocument();
  });
});

describe('Email preferences on a settings page', () => {
  it('stages notification polarity until the page Save is selected', async () => {
    renderUi(<SettingsSaveProvider><SettingsSaveAction /><EmailOptOutSetting /></SettingsSaveProvider>);
    const sw = await screen.findByRole('switch', { name: 'Send me email notifications' });
    fireEvent.click(sw);
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(repo.setMyOptOut).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Save', { selector: 'button' }));
    await waitFor(() => expect(repo.setMyOptOut).toHaveBeenCalledWith(true));
  });
  it('saves changed organisation events and locale together without writing while editing', async () => {
    renderUi(<SettingsSaveProvider><SettingsSaveAction /><EmailNotificationsSetting /></SettingsSaveProvider>);
    fireEvent.click(await screen.findByRole('switch', { name: 'Approval requests' }));
    fireEvent.change(screen.getByLabelText('Email language'), { target: { value: 'id' } });
    expect(repo.setEvent).not.toHaveBeenCalled(); expect(repo.setLocale).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Save', { selector: 'button' }));
    await waitFor(() => expect(repo.setLocale).toHaveBeenCalledWith('id'));
    expect(repo.setEvent).toHaveBeenCalledWith('approval_request', true, []);
  });
});
