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

  it('AC-CODE-003: labels the PMO number and Client Project Code separately, with PMO retained when code is absent', () => {
    const { rerender } = render(<ProjectCardShell {...baseProps} pmoProjectNumber="PMO-26-0042" code="CLIENT-77" />);
    expect(screen.getByText((_, element) => element?.textContent?.replace(/\s+/g, ' ').trim() === 'PMO Project Number: PMO-26-0042')).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.textContent?.replace(/\s+/g, ' ').trim() === 'Client Project Code: CLIENT-77')).toBeInTheDocument();
    rerender(<ProjectCardShell {...baseProps} pmoProjectNumber="PMO-26-0042" code={null} />);
    expect(screen.getByText((_, element) => element?.textContent?.replace(/\s+/g, ' ').trim() === 'PMO Project Number: PMO-26-0042')).toBeInTheDocument();
    expect(screen.queryByText(/Client Project Code:/)).not.toBeInTheDocument();
  });

  it('AC-CODE-003: kanban button accessible name includes both identity labels', () => {
    render(<ProjectCardShell {...baseProps} variant="kanban" pmoProjectNumber="PMO-26-0042" code="CLIENT-77" />);
    expect(screen.getByRole('button', { name: /Innovate Corp HQ Fit-Out.*PMO Project Number: PMO-26-0042.*Client Project Code: CLIENT-77/ })).toBeInTheDocument();
  });

  it('renders the canonical head: icon initial, name, client and code', () => {
    render(<ProjectCardShell {...baseProps} />);
    expect(screen.getByText('Innovate Corp HQ Fit-Out')).toBeInTheDocument();
    expect(screen.getByText('Innovate Corp')).toBeInTheDocument();
    expect(screen.getByText(/PRJ-001/)).toBeInTheDocument();
    expect(screen.getByTestId('status-slot')).toBeInTheDocument();
  });

  it('AC-KTR-001: shows the complete Kanban title before status and client/code', () => {
    const longName = 'Integrated maintenance planning for regional facilities';
    const statusLabel = 'Awaiting commercial closeout';
    render(
      <ProjectCardShell
        {...baseProps}
        name={longName}
        client="Client Example"
        code="PRJ-685"
        status={<span data-testid="status-slot">{statusLabel}</span>}
        variant="kanban"
      />,
    );

    const card = screen.getByRole('button', { name: new RegExp(longName) });
    const kanbanName = within(card).getByText(longName);
    const status = within(card).getByTestId('status-slot');
    const textColumn = kanbanName.parentElement!;
    const headText = textColumn.textContent!;

    expect(kanbanName.className).toContain('break-words');
    expect(kanbanName.className).not.toMatch(/line-clamp|truncate/);
    expect(textColumn).toContainElement(status);
    expect(headText.indexOf(longName)).toBeLessThan(headText.indexOf(statusLabel));
    expect(headText.indexOf(statusLabel)).toBeLessThan(headText.indexOf('Client Example'));
    expect(headText.indexOf('Client Example')).toBeLessThan(headText.indexOf('PRJ-685'));
  });

  it('AC-KTR-002: preserves the grid title button, clamp, and status placement', () => {
    render(<ProjectCardShell {...baseProps} />);
    const gridName = screen.getByRole('button', { name: /Innovate Corp HQ Fit-Out/i });
    const textColumn = gridName.parentElement!;
    const status = screen.getByTestId('status-slot');

    expect(gridName.className).toContain('line-clamp-2');
    expect(gridName.className).toContain('break-words');
    expect(textColumn).not.toContainElement(status);
    expect(textColumn.parentElement).toContainElement(status);
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

  it('AC-KTR-003: activates one Kanban card for click, Enter, and Space without nested buttons', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<ProjectCardShell {...baseProps} variant="kanban" onOpen={onOpen} />);
    const card = screen.getByRole('button', { name: /Innovate Corp HQ Fit-Out/i });

    expect(within(card).queryByRole('button')).toBeNull();
    await user.click(card);
    expect(onOpen).toHaveBeenCalledTimes(1);
    card.focus();
    await user.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledTimes(2);
    await user.keyboard(' ');
    expect(onOpen).toHaveBeenCalledTimes(3);
  });
});
