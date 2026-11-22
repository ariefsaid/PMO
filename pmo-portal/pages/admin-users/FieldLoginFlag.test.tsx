/** AC-WCI-070 — giving someone the Foreman or Field user role flags a login with no person, or a person in no crew, with the one fix. */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { FieldLoginFlag } from './FieldLoginFlag';
import { RoleFormModal } from './UserForms';

const link = vi.hoisted(() => vi.fn());
vi.mock('@/src/lib/db/adminUsers', () => ({ fieldLoginLink: link }));

const mount = (key: string) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <FieldLoginFlag userId="u1" roleKey={key} />
  </QueryClientProvider>);

describe('FieldLoginFlag', () => {
  it('AC-WCI-070 no person: says add the person to the workforce list', async () => {
    link.mockResolvedValue('no_person');
    mount('foreman');
    expect(await screen.findByRole('status')).toHaveTextContent('not in the workforce list');
  });
  it('AC-WCI-070 a person in no crew: says place them in a crew', async () => {
    link.mockResolvedValue('no_crew');
    mount('field_user');
    expect(await screen.findByRole('status')).toHaveTextContent('not in any crew');
  });
  it('AC-WCI-070 fully placed: says nothing', async () => {
    link.mockResolvedValue('ok');
    mount('foreman');
    await vi.waitFor(() => expect(link).toHaveBeenCalled());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
  it('AC-WCI-070 any other role: not asked, nothing shown', () => {
    link.mockClear();
    mount('planner');
    expect(link).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('Edit role form', () => {
  it('AC-WCI-070 choosing Foreman shows the flag in the form', async () => {
    link.mockResolvedValue('no_person');
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RoleFormModal user={{ id: 'u1', full_name: 'T P', email: 't@example.com', role: 'Engineer', built_in_role: null, status: 'active', org_id: 'o1', manager_id: null, manager: null }}
          submitError={null} onClose={() => {}} onSubmit={() => {}} builtInEnabled />
      </QueryClientProvider>);
    await userEvent.setup().selectOptions(screen.getByLabelText('Job role'), 'foreman');
    expect(await screen.findByRole('status')).toHaveTextContent('not in the workforce list');
  });
});
