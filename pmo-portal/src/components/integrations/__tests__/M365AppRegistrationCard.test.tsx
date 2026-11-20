import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppError } from '@/src/lib/appError';
import { describeM365Error, type M365OrgAppInfo } from '@/src/lib/m365/connectClient';

vi.unmock('@/src/components/integrations/M365AppRegistrationCard');

const mock = vi.hoisted(() => ({
  admin: true,
  get: vi.fn(),
  save: vi.fn(),
  clear: vi.fn(),
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => mock.admin }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'admin-1', org_id: 'org-1' } }) }));
vi.mock('@/src/lib/m365/connectClient', async () => {
  const actual = await vi.importActual<typeof import('@/src/lib/m365/connectClient')>('@/src/lib/m365/connectClient');
  return {
    ...actual,
    getM365OrgApp: (...a: unknown[]) => mock.get(...a),
    saveM365OrgApp: (...a: unknown[]) => mock.save(...a),
    clearM365OrgApp: (...a: unknown[]) => mock.clear(...a),
  };
});

import { M365AppRegistrationCard } from '../M365AppRegistrationCard';

const TENANT = '11111111-2222-3333-4444-555555555555';
const CLIENT = '66666666-7777-8888-9999-000000000000';
const OTHER_CLIENT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const SECRET = 'synthetic-secret-value-123';
const callbackUrls = { connect: 'https://fn.invalid/m365/callback', signIn: 'https://db.invalid/auth/v1/callback' };
const deploymentInfo: M365OrgAppInfo = { configured: false, source: 'deployment', tenantId: null, clientId: null, secretSet: false, validatedAt: null, callbackUrls };
const noneInfo: M365OrgAppInfo = { ...deploymentInfo, source: null };
const orgInfo: M365OrgAppInfo = { configured: true, source: 'org', tenantId: TENANT, clientId: CLIENT, secretSet: true, validatedAt: '2026-11-18T02:15:00+00:00', callbackUrls };

const view = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <M365AppRegistrationCard />
  </QueryClientProvider>,
);

beforeEach(() => {
  vi.clearAllMocks();
  mock.admin = true;
  mock.get.mockResolvedValue(orgInfo);
  mock.save.mockResolvedValue({ changedApp: false });
  mock.clear.mockResolvedValue(undefined);
});

async function openDetails() {
  await userEvent.click(await screen.findByTestId('m365-app-toggle'));
  return screen.getByTestId('m365-app-details');
}

async function openForm(name: RegExp) {
  await openDetails();
  await userEvent.click(await screen.findByRole('button', { name }));
  return screen.getByTestId('m365-app-form');
}

describe('AC-M365SS-017 — the role gate', () => {
  it('AC-M365SS-017: a non-Admin sees a read-only note, no values, no controls, and nothing is fetched', () => {
    mock.admin = false;
    view();
    const card = screen.getByTestId('m365-app-registration');
    expect(within(card).getByText('Your administrator manages this app.')).toBeInTheDocument();
    expect(within(card).queryByRole('button')).not.toBeInTheDocument();
    expect(within(card).queryByRole('textbox')).not.toBeInTheDocument();
    expect(mock.get).not.toHaveBeenCalled();
  });
});

describe('AC-M365SS-017 — read states', () => {
  it('AC-M365AV-003: the standing card is one status line and one action, with the setup detail closed', async () => {
    view();
    // The one status line: usable, and how old Microsoft's last check is.
    expect(await screen.findByTestId('m365-app-status')).toHaveTextContent(/^Connected, /);
    const card = screen.getByTestId('m365-app-registration');
    // The one action opens the detail; no field, label or help text is on the standing card.
    const toggle = within(card).getByTestId('m365-app-toggle');
    expect(toggle).toHaveTextContent('Manage');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(card).queryByTestId('m365-app-details')).not.toBeInTheDocument();
    expect(within(card).queryByText('Directory (tenant) ID')).not.toBeInTheDocument();
    expect(within(card).queryByText(/redirect URI/i)).not.toBeInTheDocument();
    expect(within(card).queryByText(/organization approval is only needed/i)).not.toBeInTheDocument();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const details = within(card).getByTestId('m365-app-details');
    expect(details).toHaveTextContent(TENANT);
    // Setup help that used to sit on the approval card, one card up, now opens here (#2260).
    expect(details).toHaveTextContent(/organization approval is only needed/i);
    await userEvent.click(toggle);
    expect(within(card).queryByTestId('m365-app-details')).not.toBeInTheDocument();
  });

  it('AC-M365SS-017: shows a loading state while the app is read', () => {
    mock.get.mockReturnValue(new Promise(() => {}));
    view();
    expect(screen.getByTestId('m365-app-loading')).toBeInTheDocument();
  });

  it('AC-M365SS-017: a failed read is a status line with one retry, never "not set up"', async () => {
    mock.get.mockRejectedValueOnce(new AppError(describeM365Error('INTERNAL_ERROR'), 'INTERNAL_ERROR'));
    view();
    expect(await screen.findByTestId('m365-app-status')).toHaveTextContent('Settings unavailable');
    // The reason is still available to assistive tech (the standing card spends no line on it).
    expect(screen.getByTestId('m365-app-status-reason')).toHaveTextContent(describeM365Error('INTERNAL_ERROR'));
    expect(screen.queryByText(/platform app/)).not.toBeInTheDocument();
    mock.get.mockResolvedValueOnce(orgInfo);
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByTestId('m365-app-status')).toHaveTextContent(/^Connected, /);
  });

  it('AC-M365SS-017: with the platform app, says so and offers to use our own registration', async () => {
    mock.get.mockResolvedValue(deploymentInfo);
    view();
    expect(await screen.findByText('Connected, platform app')).toBeInTheDocument();
    await openDetails();
    expect(screen.getByText('Your organization uses the platform-provided app.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use our own app registration' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove our app registration' })).not.toBeInTheDocument();
  });

  it('AC-M365SS-017: with no app at all, says none is set up', async () => {
    mock.get.mockResolvedValue(noneInfo);
    view();
    expect(await screen.findByText('Not set up')).toBeInTheDocument();
    await openDetails();
    expect(screen.getByText('No Microsoft app is set up yet.')).toBeInTheDocument();
  });

  it('AC-M365SS-017: a saved app shows its ids and only that a secret is set', async () => {
    view();
    const details = await openDetails();
    expect(within(details).getByText(TENANT)).toBeInTheDocument();
    expect(within(details).getByText(CLIENT)).toBeInTheDocument();
    expect(within(details).getByText('Saved')).toBeInTheDocument();
  });

  it('AC-M365AV-003: a saved app shows how old the last check with Microsoft is', async () => {
    mock.get.mockResolvedValue({ ...orgInfo, validatedAt: new Date(Date.now() - 3 * 86_400_000).toISOString() });
    view();
    expect(await screen.findByTestId('m365-app-status')).toHaveTextContent('Connected, 3 days ago');
  });

  it('AC-M365AV-003: a check inside the last day reads as today, not a long relative phrase', async () => {
    mock.get.mockResolvedValue({ ...orgInfo, validatedAt: new Date(Date.now() - 3_600_000).toISOString() });
    view();
    expect(await screen.findByTestId('m365-app-status')).toHaveTextContent('Connected, today');
  });

  it('AC-M365AV-003: an app with no recorded check says so rather than showing a blank or a fake time', async () => {
    mock.get.mockResolvedValue({ ...orgInfo, validatedAt: null });
    view();
    expect(await screen.findByTestId('m365-app-status')).toHaveTextContent('Connected, check not recorded');
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });

  it('AC-M365SS-017: an app whose secret is gone says it is not connected', async () => {
    mock.get.mockResolvedValue({ ...orgInfo, secretSet: false });
    view();
    expect(await screen.findByTestId('m365-app-status')).toHaveTextContent('Not connected, secret missing');
  });

  it('AC-M365SS-017: both callback URLs from org_app_info render with a working copy button', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    view();
    await openDetails();
    expect(await screen.findByText(callbackUrls.connect)).toBeInTheDocument();
    expect(screen.getByText(callbackUrls.signIn)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Copy the connection redirect URI' }));
    expect(writeText).toHaveBeenLastCalledWith(callbackUrls.connect);
    await userEvent.click(screen.getByRole('button', { name: 'Copy the sign-in redirect URI' }));
    expect(writeText).toHaveBeenLastCalledWith(callbackUrls.signIn);
  });
});

describe('AC-M365SS-017 — the secret is write-only', () => {
  it('AC-M365SS-017: an Admin sees tenant, client and an empty secret field even when a secret is saved', async () => {
    view();
    const form = await openForm(/edit app/i);
    expect(within(form).getByLabelText(/Directory \(tenant\) ID/)).toHaveValue(TENANT);
    expect(within(form).getByLabelText(/Application \(client\) ID/)).toHaveValue(CLIENT);
    const secret = within(form).getByLabelText(/Client secret/);
    expect(secret).toHaveValue('');
    expect(secret).toHaveAttribute('type', 'password');
    expect(secret).toHaveAttribute('autocomplete', 'off');
    expect(within(form).getByText('A secret is saved. Enter a new one only to replace it.')).toBeInTheDocument();
  });

  it('AC-M365SS-017: after a save the typed secret is nowhere in the page; only "Saved" shows', async () => {
    mock.get.mockResolvedValueOnce(deploymentInfo).mockResolvedValue(orgInfo);
    mock.save.mockResolvedValue({ changedApp: true });
    const { container } = view();
    const form = await openForm(/use our own app registration/i);
    await userEvent.type(within(form).getByLabelText(/Directory \(tenant\) ID/), TENANT);
    await userEvent.type(within(form).getByLabelText(/Application \(client\) ID/), CLIENT);
    await userEvent.type(within(form).getByLabelText(/Client secret/), SECRET);
    await userEvent.click(within(form).getByRole('button', { name: 'Save app' }));
    await waitFor(() => expect(mock.save).toHaveBeenCalledWith({ tenantId: TENANT, clientId: CLIENT, clientSecret: SECRET }));
    await waitFor(() => expect(screen.queryByTestId('m365-app-form')).not.toBeInTheDocument());
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(container.innerHTML).not.toContain(SECRET);
    expect(document.body.innerHTML).not.toContain(SECRET);
  });

  it('AC-M365SS-017: a new registration requires a secret before it saves', async () => {
    mock.get.mockResolvedValue(deploymentInfo);
    view();
    const form = await openForm(/use our own app registration/i);
    await userEvent.type(within(form).getByLabelText(/Directory \(tenant\) ID/), TENANT);
    await userEvent.type(within(form).getByLabelText(/Application \(client\) ID/), CLIENT);
    await userEvent.click(within(form).getByRole('button', { name: 'Save app' }));
    expect(await within(form).findByText('Enter the client secret.')).toBeInTheDocument();
    expect(mock.save).not.toHaveBeenCalled();
  });

  it('AC-M365SS-017: a malformed id is refused before any call', async () => {
    mock.get.mockResolvedValue(deploymentInfo);
    view();
    const form = await openForm(/use our own app registration/i);
    await userEvent.type(within(form).getByLabelText(/Directory \(tenant\) ID/), 'not-an-id');
    await userEvent.type(within(form).getByLabelText(/Application \(client\) ID/), CLIENT);
    await userEvent.type(within(form).getByLabelText(/Client secret/), SECRET);
    await userEvent.click(within(form).getByRole('button', { name: 'Save app' }));
    expect(await within(form).findByText("Paste the ID from the app's Overview page in Microsoft Entra.")).toBeInTheDocument();
    expect(mock.save).not.toHaveBeenCalled();
  });
});

describe('AC-M365SS-018 — confirmation before an app change', () => {
  it('AC-M365SS-018: changing the client id asks for confirmation before saving', async () => {
    view();
    const form = await openForm(/edit app/i);
    const client = within(form).getByLabelText(/Application \(client\) ID/);
    await userEvent.clear(client);
    await userEvent.type(client, OTHER_CLIENT);
    await userEvent.click(within(form).getByRole('button', { name: 'Save app' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Everyone in your organization will need to reconnect Microsoft 365.')).toBeInTheDocument();
    expect(mock.save).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save and reconnect everyone' }));
    await waitFor(() => expect(mock.save).toHaveBeenCalledWith({ tenantId: TENANT, clientId: OTHER_CLIENT }));
  });

  it('AC-M365SS-018: a secret-only change saves directly', async () => {
    view();
    const form = await openForm(/edit app/i);
    await userEvent.type(within(form).getByLabelText(/Client secret/), SECRET);
    await userEvent.click(within(form).getByRole('button', { name: 'Save app' }));
    await waitFor(() => expect(mock.save).toHaveBeenCalledWith({ tenantId: TENANT, clientId: CLIENT, clientSecret: SECRET }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});

describe('AC-M365SS-017 — saving and errors', () => {
  it('AC-M365SS-017: while saving, the save button is busy and cannot be pressed again', async () => {
    let finish: (v: { changedApp: boolean }) => void = () => {};
    mock.save.mockReturnValue(new Promise((r) => { finish = r; }));
    view();
    const form = await openForm(/edit app/i);
    await userEvent.type(within(form).getByLabelText(/Client secret/), SECRET);
    await userEvent.click(within(form).getByRole('button', { name: 'Save app' }));
    const button = await within(form).findByRole('button', { name: /Checking with Microsoft/ });
    expect(button).toBeDisabled();
    expect(mock.save).toHaveBeenCalledTimes(1);
    finish({ changedApp: false });
    await waitFor(() => expect(screen.queryByTestId('m365-app-form')).not.toBeInTheDocument());
  });

  it('AC-M365SS-009: a rejected save shows the localized APP_REJECTED copy, not the server message', async () => {
    const err = new AppError(describeM365Error('APP_REJECTED'), 'APP_REJECTED');
    err.message = 'raw server detail';
    mock.save.mockRejectedValue(err);
    view();
    const form = await openForm(/edit app/i);
    await userEvent.type(within(form).getByLabelText(/Client secret/), SECRET);
    await userEvent.click(within(form).getByRole('button', { name: 'Save app' }));
    const alert = await within(form).findByRole('alert');
    expect(alert).toHaveTextContent('Microsoft rejected the app credentials. Check them and try again.');
    expect(alert).not.toHaveTextContent('raw server detail');
    expect(within(form).getByLabelText(/Client secret/)).toHaveValue(SECRET);
  });
});

describe('AC-M365SS-017 — removing the registration', () => {
  it('AC-M365SS-017: remove asks first, warns about reconnecting, then clears', async () => {
    view();
    await openDetails();
    await userEvent.click(await screen.findByRole('button', { name: 'Remove our app registration' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/Everyone in your organization will need to reconnect Microsoft 365/)).toBeInTheDocument();
    expect(mock.clear).not.toHaveBeenCalled();
    mock.get.mockResolvedValue(deploymentInfo);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove registration' }));
    await waitFor(() => expect(mock.clear).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Your organization uses the platform-provided app.')).toBeInTheDocument();
  });

  it('AC-M365SS-017: a failed remove keeps the dialog open with the reason', async () => {
    mock.clear.mockRejectedValue(new AppError(describeM365Error('FORBIDDEN'), 'FORBIDDEN'));
    view();
    await openDetails();
    await userEvent.click(await screen.findByRole('button', { name: 'Remove our app registration' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove registration' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent("Couldn't remove the app registration.");
  });
});
