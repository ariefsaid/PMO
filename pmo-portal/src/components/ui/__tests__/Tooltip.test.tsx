import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tooltip } from '../Tooltip';
import { ToastView } from '../Toast';

describe('Tooltip', () => {
  it('is hidden until hover/focus, then shows with role=tooltip', async () => {
    render(
      <Tooltip content="Weighted by stage probability">
        <button>info</button>
      </Tooltip>
    );
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    await userEvent.hover(screen.getByRole('button', { name: 'info' }));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Weighted by stage probability');
  });

  it('opens on keyboard FOCUS (not hover-only) — tooltip-keyboard', async () => {
    render(
      <Tooltip content="Keyboard reachable">
        <button>info</button>
      </Tooltip>
    );
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'info' })).toHaveFocus();
    expect(screen.getByRole('tooltip')).toHaveTextContent('Keyboard reachable');
  });
});

describe('Toast', () => {
  it('renders aria-live polite (does not steal focus) + maps kind to accent stripe', () => {
    render(<ToastView kind="success" title="Saved" sub="Budget v3 activated" />);
    const toast = screen.getByText('Saved').closest('[role="status"]')!;
    expect(toast).toHaveAttribute('aria-live', 'polite');
    expect(toast.className).toContain('border-l-success');
  });
});
