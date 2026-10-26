import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import ProjectCardShell from './ProjectCardShell';

/** Shared Sales card shell behavior remains covered while Projects uses page-specific cards. */
describe('ProjectCardShell', () => {
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

  it('renders the project name, client, reference and supplied status', () => {
    render(<ProjectCardShell {...baseProps} />);
    expect(screen.getByText('Innovate Corp HQ Fit-Out')).toBeInTheDocument();
    expect(screen.getByText('Innovate Corp')).toBeInTheDocument();
    expect(screen.getByText(/PRJ-001/)).toBeInTheDocument();
    expect(screen.getByTestId('status-slot')).toBeInTheDocument();
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
    expect(screen.getByTestId('body-slot')).toBeInTheDocument();
    expect(screen.getByTestId('foot-slot')).toBeInTheDocument();
  });

  it('AC-002 #1325: short-first grid and kanban titles disclose contractual name and retain one activation target', () => {
    const { rerender } = render(<ProjectCardShell {...baseProps} name="Harbor Operations" contractualName="Contractual Harbor Works" onOpen={vi.fn()} />);
    const gridButton = screen.getByRole('button', { name: 'Harbor Operations' });
    expect(gridButton).toHaveAttribute('title', 'Contractual Harbor Works');
    expect(gridButton).toHaveAccessibleDescription('Contractual Harbor Works');
    expect(screen.getAllByRole('button')).toEqual([gridButton]);
    rerender(<ProjectCardShell {...baseProps} name="Harbor Operations" contractualName="Contractual Harbor Works" variant="kanban" onOpen={vi.fn()} />);
    const kanbanButton = screen.getByRole('button', { name: /Harbor Operations/ });
    expect(within(kanbanButton).getByTitle('Contractual Harbor Works')).toHaveTextContent('Harbor Operations');
    expect(kanbanButton).toHaveAccessibleDescription('Contractual Harbor Works');
    expect(within(kanbanButton).queryByRole('button')).toBeNull();
    rerender(<ProjectCardShell {...baseProps} name="Harbor Operations" variant="kanban" />);
    expect(screen.getByTitle('Harbor Operations')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Harbor Operations/ })).toHaveAccessibleDescription('');
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
