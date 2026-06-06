import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Breadcrumb } from '../Breadcrumb';
import { BackBar } from '../BackBar';

describe('Breadcrumb', () => {
  it('renders parts; the last is current (not a link), others navigate', async () => {
    const onNavigate = vi.fn();
    render(
      <Breadcrumb
        parts={[
          { label: 'Projects', onClick: onNavigate },
          { label: 'Alpha' },
        ]}
      />
    );
    expect(screen.getByText('Alpha')).toHaveAttribute('aria-current', 'page');
    const link = screen.getByRole('button', { name: 'Projects' });
    await userEvent.click(link);
    expect(onNavigate).toHaveBeenCalled();
  });

  it('current part is not a button', () => {
    render(<Breadcrumb parts={[{ label: 'Alpha' }]} />);
    expect(screen.queryByRole('button', { name: 'Alpha' })).not.toBeInTheDocument();
  });
});

describe('BackBar', () => {
  it('renders Back to {label} and navigates on click + Enter', async () => {
    const onBack = vi.fn();
    render(<BackBar label="Projects" onBack={onBack} />);
    const btn = screen.getByRole('button', { name: /Back to Projects/ });
    await userEvent.click(btn);
    expect(onBack).toHaveBeenCalledTimes(1);
    btn.focus();
    await userEvent.keyboard('{Enter}');
    expect(onBack).toHaveBeenCalledTimes(2);
  });
});
