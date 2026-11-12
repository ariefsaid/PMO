/**
 * C16 — when the saved view changes under an editor, the banner offered Reload / Continue
 * without saying what either does to the draft. The repair states it; this test binds the
 * banner's copy to the visible, real conflict journey (type, the view changes, the banner appears).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({
  view: null as unknown,
}));

vi.mock('@/src/hooks/useUserViews', () => ({
  useUserView: () => ({ data: h.view, isPending: false, isError: false, errorUpdatedAt: 0, refetch: vi.fn() }),
  useUserViewMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'me', org_id: 'org-1' } }) }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));
vi.mock('@/src/lib/features', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/features')>();
  return { ...actual, isFeatureEnabled: () => false };
});
vi.mock('@/src/components/builder/PanelList', () => ({ default: () => null }));
vi.mock('@/src/components/builder/ViewPreview', () => ({ default: () => null }));
vi.mock('@/src/components/builder/PanelEditorForm', () => ({ default: () => null }));
vi.mock('@/src/components/builder/AIComposerModal', () => ({ default: () => null }));

import ViewBuilderPage from './ViewBuilderPage';

const savedView = (updatedAt: string) => ({
  id: 'v1', name: 'Ops view', description: '', scope: 'private',
  spec: { version: 1, panels: [] }, user_id: 'me', updated_at: updatedAt, archived_at: null,
});

const tree = () => (
  <ToastProvider>
    <MemoryRouter initialEntries={['/views/v1/edit']}>
      <ViewBuilderPage mode="edit" />
    </MemoryRouter>
  </ToastProvider>
);

beforeEach(() => {
  h.view = savedView('2026-11-01T00:00:00Z');
});

describe('ViewBuilderPage (C16 conflict banner)', () => {
  it('says what Reload and Continue do to the edits you have not saved', async () => {
    const { rerender } = render(tree());
    const nameInput = await screen.findByLabelText(/View name/);
    await userEvent.type(nameInput, ' two');

    // The saved view changes while the editor has unsaved work.
    h.view = savedView('2026-11-02T00:00:00Z');
    rerender(tree());

    const banner = await screen.findByText('The saved view changed while you were editing.');
    expect(banner).toBeInTheDocument();
    expect(screen.getByText('Reload drops the edits you have not saved; continue keeps them.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload saved view' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue editing' })).toBeInTheDocument();
  });
});
