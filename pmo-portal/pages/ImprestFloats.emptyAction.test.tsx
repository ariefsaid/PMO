import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';

/**
 * The empty state repeats the page's create action, so exactly ONE filled "Establish float" may
 * exist: the header keeps the filled one and the empty-state repeat is outline (ListState's
 * `actionVariant`, forwarded by DataTable's `emptyActionVariant`). The variant is read off the
 * rendered control through a recording wrapper, never from a class name.
 */
const h = vi.hoisted(() => ({
  floats: { data: undefined as unknown, isPending: false, isError: false, refetch: vi.fn() },
  projects: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  users: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  establish: { mutateAsync: vi.fn(), isPending: false },
}));

vi.mock('@/src/hooks/useImprest', () => ({
  useImprestFloats: () => h.floats,
  useImprestPosition: () => ({ data: undefined, isPending: false, isError: false }),
  useEstablishFloat: () => h.establish,
}));
vi.mock('@/src/hooks/useProjects', () => ({ useProjectPickerOptions: () => h.projects }));
vi.mock('@/src/hooks/useUsers', () => ({ useUsers: () => h.users }));
let realRole: Role = 'Finance';
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole, effectiveRole: realRole }) }));

vi.mock('@/src/components/ui/Button', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/components/ui/Button')>();
  const React = await import('react');
  // The same recording wrapper the repo's other variant tests use (TimeAndMaterials.test.tsx:13-18): the real
  // Button renders, a data attribute records the variant, and no test reads a class name.
  const ButtonWithVariant = (props: React.ComponentProps<typeof actual.Button>) => {
    const buttonProps = { ...props, 'data-variant': props.variant ?? 'primary' } as React.ComponentProps<typeof actual.Button>;
    return React.createElement(actual.Button, buttonProps);
  };
  return { ...actual, Button: ButtonWithVariant };
});

import ImprestFloatsPage from './ImprestFloats';

const renderPage = () => render(
  <MemoryRouter initialEntries={['/imprest']}>
    <ToastProvider>
      <Routes>
        <Route path="/imprest" element={<ImprestFloatsPage />} />
        <Route path="/imprest/:floatId" element={<p>float record</p>} />
      </Routes>
    </ToastProvider>
  </MemoryRouter>,
);

beforeEach(() => {
  realRole = 'Finance';
  h.floats = { data: { rows: [], truncated: false }, isPending: false, isError: false, refetch: vi.fn() };
  h.establish.mutateAsync.mockReset();
  h.establish.isPending = false;
});

describe('Imprest float list empty state', () => {
  it('C21 the empty state repeats Establish float as the only outline action; one filled remains', async () => {
    renderPage();
    await screen.findByText('No site floats yet');

    const buttons = screen.getAllByRole('button', { name: 'Establish float' });
    expect(buttons).toHaveLength(2);
    expect(buttons.filter((b) => b.getAttribute('data-variant') === 'primary')).toHaveLength(1);
    const outline = buttons.filter((b) => b.getAttribute('data-variant') === 'outline');
    expect(outline).toHaveLength(1);

    await userEvent.click(outline[0]);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});
