import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PageHeader } from '../PageHeader';

describe('PageHeader: title, the one primary action, at most one help control', () => {
  it('renders the title as the page h1 with the action beside it', () => {
    render(<PageHeader title="Projects" count={12} action={<button type="button">New project</button>} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument();
    expect(screen.getByTestId('list-page-count')).toHaveTextContent('12');
    expect(within(screen.getByTestId('page-header')).getByRole('button', { name: 'New project' })).toBeInTheDocument();
  });

  it('an embedded page uses h2', () => {
    render(<PageHeader title="Invoices" headingLevel={2} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Invoices' })).toBeInTheDocument();
  });

  it('has no subtitle: the deprecated prop renders nothing', () => {
    render(<PageHeader title="Projects" subtitle="All your projects, in one place." />);
    expect(screen.queryByText('All your projects, in one place.')).not.toBeInTheDocument();
  });

  it('help is ONE button; its text opens from it', async () => {
    render(<PageHeader title="Projects" help="Percent used is spending over budget." />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    await userEvent.click(buttons[0]);
    expect(await screen.findByText('Percent used is spending over budget.')).toBeInTheDocument();
  });

  it('no help, no "?"', () => {
    render(<PageHeader title="Projects" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
