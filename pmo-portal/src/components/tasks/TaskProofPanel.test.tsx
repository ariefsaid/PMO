import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const h = vi.hoisted(() => ({
  proofs: [] as Array<{ id: string; file_name: string; file_path: string }>,
  list: vi.fn(),
  add: vi.fn(),
  remove: vi.fn(),
  url: vi.fn(),
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { taskProof: { list: h.list, add: h.add, remove: h.remove, url: h.url } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }) }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: { count?: number }) => (o?.count !== undefined ? `${k}:${o.count}` : k),
  }),
}));

import { TaskProofPanel } from './TaskProofPanel';

function renderPanel(over: Partial<React.ComponentProps<typeof TaskProofPanel>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onMarkDone = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <TaskProofPanel taskId="t1" status="In Progress" proofRequired canAttach canSetStatus onMarkDone={onMarkDone} {...over} />
    </QueryClientProvider>,
  );
  return { onMarkDone };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.proofs = [];
  h.list.mockImplementation(async () => h.proofs);
  h.add.mockImplementation(async () => {
    h.proofs = [{ id: 'p1', file_name: 'site.jpg', file_path: 'o/t1/p1/site.jpg' }];
    return h.proofs[0];
  });
});

describe('AC-TWOP-008 Done is disabled with the reason until proof is attached', () => {
  it('without proof the done control is disabled and says why; after uploading a photo it enables', async () => {
    const { onMarkDone } = renderPanel();
    const done = await screen.findByRole('button', { name: 'proof.markDone' });
    expect(done).toBeDisabled();
    expect(screen.getByText('proof.doneBlocked')).toBeInTheDocument();

    const input = screen.getByTestId('proof-photo-input') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'site.jpg', { type: 'image/jpeg' })] } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'proof.markDone' })).toBeEnabled());
    expect(screen.queryByText('proof.doneBlocked')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'proof.markDone' }));
    expect(onMarkDone).toHaveBeenCalledOnce();
  });

  it('opens an attachment through a signed URL', async () => {
    h.proofs = [{ id: 'p1', file_name: 'site.jpg', file_path: 'o/t1/p1/site.jpg' }];
    h.url.mockResolvedValue('https://example.test/proof');
    const tab = { opener: window, location: { href: '' }, close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockImplementation(() => tab as unknown as Window);
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'site.jpg' }));
    expect(open).toHaveBeenCalledWith('', '_blank');
    await waitFor(() => expect(tab.location.href).toBe('https://example.test/proof'));
    expect(tab.opener).toBeNull();
    expect(h.url).toHaveBeenCalledWith('o/t1/p1/site.jpg');
    open.mockRestore();
  });

  it('the photo input asks the phone for its camera', async () => {
    renderPanel();
    const input = await screen.findByTestId('proof-photo-input');
    expect(input).toHaveAttribute('accept', 'image/*');
    expect(input).toHaveAttribute('capture', 'environment');
  });

  it('a disallowed file is refused with its reason and is not uploaded', async () => {
    renderPanel();
    const input = await screen.findByTestId('proof-document-input');
    fireEvent.change(input, { target: { files: [new File(['x'], 'run.exe', { type: 'application/x-msdownload' })] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('proof.refused.type');
    expect(h.add).not.toHaveBeenCalled();
  });

  it('a viewer who cannot set the status gets no done control; one who cannot attach gets no upload buttons', async () => {
    renderPanel({ canSetStatus: false, canAttach: false });
    await screen.findByText('proof.missing');
    expect(screen.queryByRole('button', { name: 'proof.markDone' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'proof.addPhoto' })).not.toBeInTheDocument();
  });

  it('proof of a Done proof-required task is append-only: no remove or add controls', async () => {
    h.proofs = [{ id: 'p1', file_name: 'site.jpg', file_path: 'o/t1/p1/site.jpg' }];
    renderPanel({ status: 'Done' });
    await screen.findByText('site.jpg');
    expect(screen.queryByRole('button', { name: 'proof.remove' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'proof.addPhoto' })).not.toBeInTheDocument();
  });
});
