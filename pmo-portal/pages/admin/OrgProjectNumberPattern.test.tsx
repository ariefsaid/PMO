import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), toast: vi.fn(), canManage: true }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { orgSettings: {
  getProjectNumberPattern: h.get, setProjectNumberPattern: h.save,
} } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-1' } }) }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => (action: string, entity: string) => h.canManage && action === 'manage' && entity === 'orgProjectNumbering' }));
vi.mock('@/src/components/ui', async (original) => {
  const actual = await original() as Record<string, unknown>;
  return { ...actual, useToast: () => ({ toast: h.toast }) };
});

import OrgProjectNumberPattern from './OrgProjectNumberPattern';

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider><OrgProjectNumberPattern /></ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.get.mockResolvedValue(null);
  h.save.mockResolvedValue(undefined);
  h.canManage = true;
});
afterEach(() => cleanup());

describe('AC-CODE-001 organisation PMO number pattern', () => {
  it('loads the system pattern, validates tokens inline, and saves a valid custom pattern', async () => {
    renderPanel();
    const input = await screen.findByRole('textbox', { name: /project number pattern/i });
    expect(input).toHaveValue('PRJ-{YY}-{SEQ4}');
    fireEvent.change(input, { target: { value: 'PRE-{CLIENT}-{YY}-{SEQ4}' } });
    expect(screen.queryByText(/include \{SEQ4\} exactly once/i, { selector: '[role="alert"]' })).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'PRE-{CLIENT}-{YY}' } });
    expect(screen.getByText(/include \{SEQ4\} exactly once/i, { selector: '[role="alert"]' })).toHaveTextContent(/include \{SEQ4\} exactly once/i);
    expect(screen.getByRole('button', { name: /save pattern/i })).toBeDisabled();
    fireEvent.change(input, { target: { value: 'PRE-{CLIENT}-{YY}-{SEQ4}' } });
    const save = screen.getByRole('button', { name: /save pattern/i });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(h.save).toHaveBeenCalledWith('PRE-{CLIENT}-{YY}-{SEQ4}'));
    expect(h.toast).toHaveBeenCalledWith(expect.stringMatching(/updated/i), expect.any(String), 'success');
  });

  it('shows only the effective pattern and Admin-only explanation to a non-Admin', async () => {
    h.canManage = false;
    h.get.mockResolvedValue('PRE-{CLIENT}-{YY}-{SEQ4}');
    renderPanel();
    expect(await screen.findByTestId('org-project-number-pattern-readonly')).toHaveTextContent('PRE-{CLIENT}-{YY}-{SEQ4}');
    expect(screen.getByTestId('org-project-number-pattern-readonly')).toHaveTextContent(/only an admin/i);
    expect(screen.queryByRole('textbox', { name: /project number pattern/i })).not.toBeInTheDocument();
    expect(h.save).not.toHaveBeenCalled();
  });

  it('reports a save failure without changing the effective value', async () => {
    h.save.mockRejectedValue(new Error('write failed'));
    renderPanel();
    const input = await screen.findByRole('textbox', { name: /project number pattern/i });
    fireEvent.change(input, { target: { value: 'PRE-{CLIENT}-{YY}-{SEQ4}' } });
    fireEvent.click(screen.getByRole('button', { name: /save pattern/i }));
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'warning'));
    expect(input).toHaveValue('PRE-{CLIENT}-{YY}-{SEQ4}');
  });

  it('offers retry on load failure rather than showing a guessed setting', async () => {
    h.get.mockRejectedValue(new Error('unavailable'));
    renderPanel();
    expect(await screen.findByText(/couldn't load the project number pattern/i)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /project number pattern/i })).not.toBeInTheDocument();
  });
});
