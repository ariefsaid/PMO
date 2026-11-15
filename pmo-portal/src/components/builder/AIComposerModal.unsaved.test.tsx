import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/src/hooks/useAIComposer', () => ({
  useAIComposer: () => ({ compose: vi.fn(), status: 'idle', error: null }),
}));

import AIComposerModal from './AIComposerModal';

describe('#2080 AIComposerModal unsaved prompt', () => {
  it('an empty prompt closes on Esc without a prompt', async () => {
    const onClose = vi.fn();
    render(<AIComposerModal open onClose={onClose} onComposed={vi.fn()} />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('a typed prompt asks before Esc discards it and Keep editing retains it', async () => {
    const onClose = vi.fn();
    render(<AIComposerModal open onClose={onClose} onComposed={vi.fn()} />);
    await userEvent.type(screen.getByRole('textbox'), 'show at-risk projects');
    await userEvent.keyboard('{Escape}');
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /keep editing/i }));
    expect(screen.getByRole('textbox')).toHaveValue('show at-risk projects');
  });

  it('Discard on a typed prompt closes the dialog', async () => {
    const onClose = vi.fn();
    render(<AIComposerModal open onClose={onClose} onComposed={vi.fn()} />);
    await userEvent.type(screen.getByRole('textbox'), 'x');
    await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    await userEvent.click(await screen.findByRole('button', { name: /^discard$/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
