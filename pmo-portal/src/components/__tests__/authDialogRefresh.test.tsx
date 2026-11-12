import { useState } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';

const auth = vi.hoisted(() => ({ callback: null as null | ((event: string, session: unknown) => void) }));
vi.mock('@/src/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } }),
      onAuthStateChange: vi.fn((callback: typeof auth.callback) => {
        auth.callback = callback;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
    },
    from: vi.fn(() => ({ select: () => ({ eq: () => ({ single: async () => ({ data: {
      id: 'user-1', full_name: 'Test User', role: 'Project Manager', org_id: 'org-1',
    }, error: null }) }) }) })),
  },
}));

import { AuthProvider } from '@/src/auth/AuthProvider';
import { RequireAuth } from '@/src/auth/RequireAuth';
import { EntityFormModal } from '@/src/components/ui/EntityFormModal';
import { TextField } from '@/src/components/ui/FormFields';
import { useEntityForm } from '@/src/components/ui/useEntityForm';

function RateForm() {
  const [open, setOpen] = useState(false);
  const form = useEntityForm({ initialValues: { label: '', rate: '' } });
  return <>
    <button onClick={() => setOpen(true)}>Add labour rate</button>
    {open && <EntityFormModal open title="Add labour rate" submitLabel="Save rate" onSubmit={() => {}} onClose={() => setOpen(false)} dirty={form.isDirty}>
      <TextField label="Role or work description" {...form.fieldProps('label')} />
      <TextField label="Rate per hour" {...form.fieldProps('rate')} />
    </EntityFormModal>}
  </>;
}

describe('form state across auth events', () => {
  it.each(['TOKEN_REFRESHED', 'SIGNED_IN'])('preserves a half-filled dialog after one same-user %s event', async (event) => {
    const user = userEvent.setup();
    render(<AuthProvider><MemoryRouter initialEntries={['/']}><Routes><Route element={<RequireAuth />}><Route path="/" element={<RateForm />} /></Route></Routes></MemoryRouter></AuthProvider>);
    await user.click(await screen.findByRole('button', { name: 'Add labour rate' }));
    const dialog = screen.getByRole('dialog', { name: 'Add labour rate' });
    await user.type(within(dialog).getByLabelText('Role or work description'), 'Engineer');
    await user.type(within(dialog).getByLabelText('Rate per hour'), '125');
    expect(auth.callback).not.toBeNull();
    await act(async () => { auth.callback?.(event, { user: { id: 'user-1' } }); });
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Add labour rate' })).toBeInTheDocument());
    expect(within(dialog).getByLabelText('Role or work description')).toHaveValue('Engineer');
    expect(within(dialog).getByLabelText('Rate per hour')).toHaveValue('125');
  });
});
