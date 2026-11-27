import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({
  canManage: true,
  getSettings: vi.fn(),
  setSettings: vi.fn(),
}));

vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    procurement: {
      purchaseOrderSettings: h.getSettings,
      setPurchaseOrderSettings: h.setSettings,
    },
  },
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'usr-1', org_id: 'org-test' } }),
}));

vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => (action: string, entity: string) =>
    h.canManage && action === 'manage' && entity === 'orgAccounting',
}));

vi.unmock('@/src/hooks/usePurchaseOrderSettings'); // test/setup.ts stubs it for the procurement page suites

import PurchaseOrderSettingsSection from './PurchaseOrderSettingsSection';

const DEFAULT_SETTINGS = {
  enabled: true,
  signatureBlocks: ['Prepared by', 'Approved by', 'Accepted by'],
  authorisedCollectors: ['Budi Santoso', 'Siti Rahma'],
};

function renderComponent() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <PurchaseOrderSettingsSection />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('PurchaseOrderSettingsSection (#2688)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.canManage = true;
    h.getSettings.mockResolvedValue(DEFAULT_SETTINGS);
    h.setSettings.mockResolvedValue({
      enabled: true,
      signature_blocks: DEFAULT_SETTINGS.signatureBlocks,
      authorised_collectors: DEFAULT_SETTINGS.authorisedCollectors,
    });
  });

  it('renders existing settings, signature blocks and collectors, with no print switch (on for everyone, #2746)', async () => {
    renderComponent();

    expect(await screen.findByText('Prepared by')).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.getByText('Prepared by')).toBeInTheDocument();
    expect(screen.getByText('Approved by')).toBeInTheDocument();
    expect(screen.getByText('Accepted by')).toBeInTheDocument();

    expect(screen.getByText('Budi Santoso')).toBeInTheDocument();
    expect(screen.getByText('Siti Rahma')).toBeInTheDocument();
  });

  it('renders read-only state for non-admin users', async () => {
    h.canManage = false;
    renderComponent();

    expect(await screen.findByText('Prepared by')).toBeInTheDocument();
    expect(screen.getByText('Only an Admin can change this.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save changes/i })).not.toBeInTheDocument();
  });

  it('allows Admin to add and remove authorised collectors', async () => {
    const user = userEvent.setup();
    renderComponent();

    // Add a new collector
    const input = await screen.findByLabelText(/new authorised collector/i);
    await user.type(input, 'Ahmad Fauzi');
    const addButton = screen.getByRole('button', { name: /add collector/i });
    await user.click(addButton);

    expect(screen.getByText('Ahmad Fauzi')).toBeInTheDocument();

    // Remove first collector ('Budi Santoso')
    const removeBtn = screen.getByRole('button', { name: /remove collector.*budi santoso/i });
    await user.click(removeBtn);
    expect(screen.queryByText('Budi Santoso')).not.toBeInTheDocument();

    // Save
    const saveButton = screen.getByRole('button', { name: /save changes/i });
    await user.click(saveButton);

    expect(h.setSettings).toHaveBeenCalledWith(
      true,
      DEFAULT_SETTINGS.signatureBlocks,
      ['Siti Rahma', 'Ahmad Fauzi'],
    );
  });

  it('allows Admin to add and remove signature blocks', async () => {
    const user = userEvent.setup();
    renderComponent();

    // Add a new block
    const input = await screen.findByLabelText(/new signature block/i);
    await user.type(input, 'Received by');
    const addButton = screen.getByRole('button', { name: /add block/i });
    await user.click(addButton);

    expect(screen.getByText('Received by')).toBeInTheDocument();

    // Remove 'Prepared by'
    const removeBtn = screen.getByRole('button', { name: /remove signature block.*prepared by/i });
    await user.click(removeBtn);
    expect(screen.queryByText('Prepared by')).not.toBeInTheDocument();

    // Save
    const saveButton = screen.getByRole('button', { name: /save changes/i });
    await user.click(saveButton);

    expect(h.setSettings).toHaveBeenCalledWith(
      true,
      ['Approved by', 'Accepted by', 'Received by'],
      DEFAULT_SETTINGS.authorisedCollectors,
    );
  });

  it('displays error message when saving fails', async () => {
    h.setSettings.mockRejectedValue(new Error('Admin authority required'));
    const user = userEvent.setup();
    renderComponent();

    await user.type(await screen.findByLabelText(/new authorised collector/i), 'Ahmad Fauzi');
    await user.click(screen.getByRole('button', { name: /add collector/i }));

    const saveButton = screen.getByRole('button', { name: /save changes/i });
    await user.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText(/admin authority required/i)).toBeInTheDocument();
    });
  });
});

it('preserves disabled printing when an Admin saves a signature block', async () => {
  h.getSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, enabled: false });
  renderComponent();
  await userEvent.type(await screen.findByLabelText(/new signature block/i), 'Checked by');
  await userEvent.click(screen.getByRole('button', { name: /add block/i }));
  await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
  expect(h.setSettings).toHaveBeenCalledWith(false, expect.any(Array), expect.any(Array));
});
