import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HelpPopover } from '../HelpPopover';

describe('HelpPopover', () => {
  it('hides the explanation until the ? button is activated by keyboard, and names the subject', async () => {
    const user = userEvent.setup();
    render(<HelpPopover subject="Pipeline">Weighted by win probability.</HelpPopover>);
    expect(screen.queryByText('Weighted by win probability.')).toBeNull();
    await user.tab();
    const trigger = screen.getByRole('button', { name: 'About Pipeline' });
    expect(trigger).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(await screen.findByText('Weighted by win probability.')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByText('Weighted by win probability.')).toBeNull();
  });
});
