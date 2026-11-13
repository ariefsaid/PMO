import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';

/**
 * Move 2 (equipment assets judging): an empty register offers the fix — a quiet "New asset" that
 * opens the same create form as the header's filled one, and only for a role that may create.
 * The variant is read the way the shared ListState tests read it: the Button primitive records the
 * variant it is handed, so the assertion is about the action a person gets, never a class string.
 */
const recorded = vi.hoisted(() => ({ buttons: [] as Array<{ variant: string; label: string }> }));

vi.mock('@/src/components/ui/Button', async () => {
  const ReactModule = await import('react');
  const labelOf = (node: React.ReactNode): string => {
    if (node == null || node === false) return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(labelOf).join('');
    if (ReactModule.isValidElement(node)) return labelOf((node.props as { children?: React.ReactNode }).children);
    return '';
  };
  return {
    Button: ({
      variant = 'primary',
      loading,
      size,
      iconOnly,
      children,
      ...rest
    }: {
      variant?: string;
      loading?: boolean;
      size?: string;
      iconOnly?: boolean;
      children?: React.ReactNode;
    } & React.ButtonHTMLAttributes<HTMLButtonElement>) => {
      recorded.buttons.push({ variant, label: labelOf(children).trim() });
      return ReactModule.createElement(
        'button',
        { type: 'button', ...rest, disabled: Boolean(rest.disabled) || Boolean(loading) },
        children,
      );
    },
  };
});

const h = vi.hoisted(() => ({
  role: 'Admin' as string,
  viewAs: null as string | null,
  assetPages: { data: undefined as unknown, total: undefined as number | undefined, isPending: false, isError: false, hasNextPage: false, isFetchingNextPage: false, fetchNextPage: vi.fn(), refetch: vi.fn() },
  create: vi.fn(), update: vi.fn(), del: vi.fn(),
}));
vi.mock('@/src/hooks/useEquipment', () => ({
  useEquipmentAssetPages: () => h.assetPages,
  useCreateAsset: () => ({ mutateAsync: h.create, isPending: false }),
  useUpdateAsset: () => ({ mutateAsync: h.update, isPending: false }),
  useDeleteAsset: () => ({ mutateAsync: h.del, isPending: false }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: h.role as Role, effectiveRole: (h.viewAs ?? h.role) as Role }),
}));

import EquipmentAssetsPage from './EquipmentAssets';

const emptyRegister = () => ({
  data: { pages: [{ rows: [], truncated: false }] },
  total: 0,
  isPending: false,
  isError: false,
  hasNextPage: false,
  isFetchingNextPage: false,
  fetchNextPage: vi.fn(),
  refetch: vi.fn(),
});

const renderPage = () => render(<MemoryRouter><ToastProvider><EquipmentAssetsPage /></ToastProvider></MemoryRouter>);

beforeEach(() => {
  recorded.buttons.length = 0;
  h.role = 'Admin';
  h.viewAs = null;
  h.assetPages = emptyRegister();
  h.create = vi.fn().mockResolvedValue({ id: 'a1' });
  h.update = vi.fn().mockResolvedValue(undefined);
  h.del = vi.fn().mockResolvedValue(undefined);
});

describe('Equipment assets empty state (move 2)', () => {
  it('move 2: the empty register keeps one filled action and offers a quiet New asset that opens the create form', async () => {
    renderPage();

    const filled = recorded.buttons.filter((button) => button.variant === 'primary');
    const quiet = recorded.buttons.filter((button) => button.variant === 'outline' && button.label === 'New asset');
    expect(filled.map((button) => button.label)).toEqual(['New asset']);
    expect(quiet).toHaveLength(1);

    const [headerAction, emptyAction] = screen.getAllByRole('button', { name: 'New asset' });
    expect(emptyAction).not.toBe(headerAction);
    await userEvent.click(emptyAction);
    expect(await screen.findByRole('dialog', { name: 'New equipment asset' })).toBeInTheDocument();
  });

  it('move 2: a role that may not create gets no New asset in the empty register', () => {
    h.role = 'Engineer';
    renderPage();

    expect(screen.getByText('No assets yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New asset' })).toBeNull();
    expect(recorded.buttons.some((button) => button.label === 'New asset')).toBe(false);
  });
});
