/**
 * PanelEditorForm floor rows: Remove filter (26), aggregate column+alias (29, 30), date range
 * column/from/to (31–33), order column+direction (34, 35), limit (36).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({
    currentUser: { id: 'u1', org_id: 'org1' },
    role: 'Admin',
    session: null,
    loading: false,
    profileError: null,
    signInWithPassword: vi.fn(),
    signInWithMagicLink: vi.fn(),
    signOut: vi.fn(),
  }),
}));

import PanelEditorForm from '@/src/components/builder/PanelEditorForm';

const noop = () => {};

function openForm(props?: Partial<React.ComponentProps<typeof PanelEditorForm>>) {
  return render(
    <PanelEditorForm open={true} initialPanel={null} onConfirm={noop} onClose={noop} {...props} />,
  );
}

async function startDataTable(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByRole('combobox', { name: /primitive/i }), 'DataTable');
  await user.selectOptions(screen.getByRole('combobox', { name: /entity/i }), 'projects');
}

describe('PanelEditorForm floor', () => {
  it('floor: Remove filter drops that filter from the submitted panel', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    openForm({ onConfirm });
    await startDataTable(user);
    await user.click(screen.getByRole('checkbox', { name: 'id' }));

    await user.click(screen.getByRole('button', { name: /add filter/i }));
    await user.selectOptions(screen.getByLabelText('Filter column'), 'status');
    await user.selectOptions(screen.getByLabelText('Filter operator'), 'eq');
    await user.type(screen.getByLabelText('Filter value'), 'Active');
    await user.click(screen.getByRole('button', { name: 'Remove filter' }));

    expect(screen.queryByLabelText('Filter value')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /add panel|confirm/i }));
    const submitted = onConfirm.mock.calls[0][0] as { querySpec: Record<string, unknown> };
    expect(submitted.querySpec).not.toHaveProperty('filters');
  });

  it('floor: an aggregate uses the chosen column and alias', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    openForm({ onConfirm });
    await startDataTable(user);
    await user.click(screen.getByRole('checkbox', { name: 'id' }));
    await user.click(screen.getByRole('checkbox', { name: 'budget' }));

    await user.selectOptions(screen.getByRole('combobox', { name: /aggregate function/i }), 'sum');
    await user.selectOptions(screen.getByRole('combobox', { name: /aggregate column/i }), 'budget');
    await user.type(screen.getByLabelText('Alias'), 'Total budget');

    await user.click(screen.getByRole('button', { name: /add panel|confirm/i }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      querySpec: expect.objectContaining({
        aggregate: { fn: 'sum', column: 'budget', alias: 'Total budget' },
      }),
    }));
  });

  it('floor: a date range uses the chosen date column and from/to dates', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    openForm({ onConfirm });
    await startDataTable(user);
    await user.click(screen.getByRole('checkbox', { name: 'id' }));

    await user.selectOptions(screen.getByRole('combobox', { name: /date column/i }), 'start_date');
    await user.type(screen.getByLabelText('From date'), '2026-01-01');
    await user.type(screen.getByLabelText('To date'), '2026-12-31');

    await user.click(screen.getByRole('button', { name: /add panel|confirm/i }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      querySpec: expect.objectContaining({
        timeRange: { column: 'start_date', from: '2026-01-01', to: '2026-12-31' },
      }),
    }));
  });

  it('floor: order column and direction land in the submitted panel', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    openForm({ onConfirm });
    await startDataTable(user);
    await user.click(screen.getByRole('checkbox', { name: 'id' }));

    await user.selectOptions(screen.getByRole('combobox', { name: /order column/i }), 'name');
    await user.selectOptions(screen.getByRole('combobox', { name: /direction/i }), 'desc');

    await user.click(screen.getByRole('button', { name: /add panel|confirm/i }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      querySpec: expect.objectContaining({ orderBy: { column: 'name', dir: 'desc' } }),
    }));
  });

  it('floor: the row limit lands in the submitted panel', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    openForm({ onConfirm });
    await startDataTable(user);
    await user.click(screen.getByRole('checkbox', { name: 'id' }));

    await user.type(screen.getByLabelText('Limit (1–500)'), '25');

    await user.click(screen.getByRole('button', { name: /add panel|confirm/i }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      querySpec: expect.objectContaining({ limit: 25 }),
    }));
  });
});
