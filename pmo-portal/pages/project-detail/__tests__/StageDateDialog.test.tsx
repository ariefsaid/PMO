import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import StageDateDialog from '../StageDateDialog';

vi.mock('@/src/hooks/useOrgToday', () => ({ useOrgToday: () => '2026-11-01' }));

describe('StageDateDialog (#1638)', () => {
  it('AC-PSH-013: nothing is saved until Save date; an out-of-range date cannot be saved', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<StageDateDialog title="Change date" initialDate="2026-10-12" min="2026-10-01" max="2026-10-20"
      onConfirm={onConfirm} onClose={vi.fn()} />);
    const field = screen.getByLabelText('Stage date');
    await userEvent.clear(field);
    await userEvent.type(field, '2026-10-25');
    const saveButton = screen.getByRole('button', { name: 'Save date' });
    expect(saveButton).toBeDisabled();
    expect(saveButton).toHaveAccessibleDescription(/Pick a date between 2026-10-01 and 2026-10-20/);
    await userEvent.clear(field);
    await userEvent.type(field, '2026-10-05');
    expect(onConfirm).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Save date' }));
    expect(onConfirm).toHaveBeenCalledWith({ enteredOn: '2026-10-05', stage: undefined });
  });

  it('AC-PSH-013: accessible name includes stage and subtitle shows current date', () => {
    render(<StageDateDialog title="Change date · Quoted" subtitle="Currently 12 Oct" initialDate="2026-10-12"
      onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Change date · Quoted' })).toBeInTheDocument();
    expect(screen.getByText('Currently 12 Oct')).toBeInTheDocument();
  });
});
