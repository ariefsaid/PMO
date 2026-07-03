import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import ProjectCardShell from './ProjectCardShell';

/**
 * CW-3b — the ONE canonical project-card visual vocabulary. Every project card
 * (grid cards-view, Projects kanban, Sales pipeline kanban) renders through this
 * shell so a project looks the SAME wherever it appears. The shell owns the chrome
 * (border, hover-lift, icon tile, name activation target, client·code subtitle,
 * status slot, body slot, foot slot); content varies by lens via props/slots.
 */
describe('ProjectCardShell (CW-3b canonical project-card vocabulary)', () => {
  const baseProps = {
    initial: 'I',
    name: 'Innovate Corp HQ Fit-Out',
    client: 'Innovate Corp',
    code: 'PRJ-001',
    status: <span data-testid="status-slot">Ongoing Project</span>,
  };

  it('renders the canonical head: icon initial, name, client and code', () => {
    render(<ProjectCardShell {...baseProps} />);
    expect(screen.getByText('Innovate Corp HQ Fit-Out')).toBeInTheDocument();
    expect(screen.getByText('Innovate Corp')).toBeInTheDocument();
    expect(screen.getByText(/PRJ-001/)).toBeInTheDocument();
    expect(screen.getByTestId('status-slot')).toBeInTheDocument();
  });

  it('lets long project names wrap to two lines before truncating in both grid and kanban variants', () => {
    const { rerender } = render(<ProjectCardShell {...baseProps} />);
    const gridName = screen.getByRole('button', { name: /Innovate Corp HQ Fit-Out/i });
    expect(gridName.className).toContain('line-clamp-2');
    expect(gridName.className).toContain('break-words');
    expect(gridName.className).not.toContain('truncate');

    rerender(<ProjectCardShell {...baseProps} variant="kanban" />);
    const kanbanCard = screen.getByRole('button', { name: /Innovate Corp HQ Fit-Out/i });
    const kanbanName = within(kanbanCard).getByText('Innovate Corp HQ Fit-Out');
    expect(kanbanName.className).toContain('line-clamp-2');
    expect(kanbanName.className).toContain('break-words');
    expect(kanbanName.className).not.toContain('truncate');
  });

  it('exposes a single project-card test carrier so every surface is the same molecule', () => {
    render(<ProjectCardShell {...baseProps} />);
    const card = screen.getByTestId('project-card');
    expect(card).toBeInTheDocument();
    expect(card.className).toMatch(/hover:shadow-\[0_2px_10px_hsl\(var\(--foreground\)\/0\.06\)\]/);
    expect(card.className).not.toMatch(/240_6%_10%/);
  });

  it('makes the name the activation target and calls onOpen when clicked', async () => {
    const onOpen = vi.fn();
    render(<ProjectCardShell {...baseProps} onOpen={onOpen} />);
    await userEvent.click(screen.getByRole('button', { name: /Innovate Corp HQ Fit-Out/i }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('renders em-dash for a missing client rather than blank', () => {
    render(<ProjectCardShell {...baseProps} client={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders the body and foot slots when provided', () => {
    render(
      <ProjectCardShell
        {...baseProps}
        body={<div data-testid="body-slot">money</div>}
        foot={<div data-testid="foot-slot">pm</div>}
      />,
    );
    const card = screen.getByTestId('project-card');
    expect(within(card).getByTestId('body-slot')).toBeInTheDocument();
    expect(within(card).getByTestId('foot-slot')).toBeInTheDocument();
  });

  it('the kanban variant uses a single role=button activation target (no nested button)', () => {
    const onOpen = vi.fn();
    render(<ProjectCardShell {...baseProps} variant="kanban" onOpen={onOpen} />);
    // kanban variant: the whole card is the button (no inner name <button>)
    const card = screen.getByRole('button', { name: /Innovate Corp HQ Fit-Out/i });
    expect(card).toBeInTheDocument();
    expect(within(card).queryByRole('button')).toBeNull();
  });
});
