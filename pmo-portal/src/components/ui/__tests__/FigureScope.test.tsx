import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { KPIRow, KPITile } from '../KPITile';
import { StatTiles } from '../StatTiles';
import { FigureScope, FigureHiddenLine } from '../FigureScope';
import { useFigureReport } from '../useFigureScope';
import { PageHeader } from '../PageHeader';

const wrap = (ui: React.ReactElement) => render(<MemoryRouter><FigureScope>{ui}</FigureScope></MemoryRouter>);

const ReportedReason: React.FC = () => {
  useFigureReport([{ label: 'Receivables', reason: 'Invoice balance is unknown', link: { to: '/finance/receivables', label: 'See invoices' } }]);
  return null;
};

describe('figure tiles: unknown value hides the tile and reports to ONE page line', () => {
  it('a child-reported reason appears in the shared Why list with its fix link', async () => {
    wrap(<><FigureHiddenLine compact /><ReportedReason /></>);

    const line = await screen.findByTestId('figures-hidden');
    expect(line).toHaveTextContent('1 figure hidden · Why');
    await userEvent.click(within(line).getByRole('button', { name: 'Why' }));

    expect(await screen.findByText('Invoice balance is unknown')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See invoices' })).toHaveAttribute('href', '/finance/receivables');
  });

  it('KPITile with an unavailable reason renders nothing and is counted in the line, with its fix link', async () => {
    wrap(
      <>
        <PageHeader title="Dashboard" />
        <FigureHiddenLine />
        <KPIRow aria-label="figures">
          <KPITile icon="dollar" tone="blue" label="Margin" value="—" unavailableReason="accounting is not connected" hiddenLink={{ to: '/administration/accounting', label: 'Set up' }} />
          <KPITile icon="dollar" tone="blue" label="Cash" value="—" unavailableReason="accounting is not connected" hiddenLink={{ to: '/administration/accounting', label: 'Set up' }} />
          <KPITile icon="dollar" tone="blue" label="Billed" value="IDR 7.7B" />
        </KPIRow>
      </>,
    );
    expect(screen.queryByText('Margin')).not.toBeInTheDocument();
    expect(screen.queryByText('Cash')).not.toBeInTheDocument();
    expect(screen.getByText('Billed')).toBeInTheDocument();
    const line = await screen.findByTestId('figures-hidden');
    expect(line).toHaveTextContent('2 figures hidden: accounting is not connected · Set up');
    expect(within(line).getByRole('link', { name: 'Set up' })).toHaveAttribute('href', '/administration/accounting');
    expect(screen.getAllByTestId('figures-hidden')).toHaveLength(1);
  });

  it('a tile with no value (null) is unknown too; the line says "1 figure hidden"', async () => {
    wrap(<><FigureHiddenLine /><KPITile icon="dollar" tone="blue" label="Margin" value={null} unavailableReason="no budget" /></>);
    expect(await screen.findByTestId('figures-hidden')).toHaveTextContent('1 figure hidden: no budget');
  });

  it('different reasons are listed together; the line disappears when every figure has a value', async () => {
    const { rerender } = wrap(
      <><FigureHiddenLine /><KPITile icon="dollar" tone="blue" label="A" value="—" unavailableReason="no budget" /><KPITile icon="dollar" tone="blue" label="B" value="—" unavailableReason="no ledger" /></>,
    );
    expect(await screen.findByTestId('figures-hidden')).toHaveTextContent('2 figures hidden: no budget; no ledger');
    rerender(<MemoryRouter><FigureScope><FigureHiddenLine /><KPITile icon="dollar" tone="blue" label="A" value="1" /><KPITile icon="dollar" tone="blue" label="B" value="2" /></FigureScope></MemoryRouter>);
    expect(screen.queryByTestId('figures-hidden')).not.toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('a loading or errored tile is not "unknown": it keeps its place', () => {
    wrap(<><KPITile icon="dollar" tone="blue" label="L" value="" loading /><KPITile icon="dollar" tone="blue" label="E" value="" error /></>);
    expect(screen.getByText('L')).toBeInTheDocument();
    expect(screen.getByText('E')).toBeInTheDocument();
    expect(screen.queryByTestId('figures-hidden')).not.toBeInTheDocument();
  });

  it('outside a FigureScope the reason still shows in place (nothing silently lost)', () => {
    render(<KPITile icon="dollar" tone="blue" label="Margin" value="—" unavailableReason="no budget" />);
    expect(screen.getByRole('status')).toHaveTextContent('no budget');
  });

  it('StatTiles drops unknown tiles inside a scope and reports them; all-unknown renders no strip', async () => {
    wrap(
      <>
        <FigureHiddenLine />
        <StatTiles columns={3} tiles={[
          { label: 'Billed', value: 'IDR 1M' },
          { label: 'Paid', value: '—', unavailableReason: 'no ledger' },
          { label: 'Due', value: 'IDR 2M', sub: 'in 5 days' },
        ]} />
        <StatTiles tiles={[{ label: 'X', value: null, unavailableReason: 'no ledger' }]} />
      </>,
    );
    expect(screen.getAllByTestId('stat-tile')).toHaveLength(2);
    expect(screen.queryByText('Paid')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('stat-tiles')).toHaveLength(1);
    expect(await screen.findByTestId('figures-hidden')).toHaveTextContent('2 figures hidden: no ledger');
  });

  it('per-tile help is not drawn; PageHeader collects it into its single "?"', async () => {
    wrap(
      <>
        <PageHeader title="Dashboard" help="Position today." />
        <KPITile icon="dollar" tone="blue" label="Cash" value="1" help="Money in the bank." />
        <KPITile icon="dollar" tone="blue" label="Billed" value="2" help="Invoiced this period." helpLabel="Billed in period" />
      </>,
    );
    const helpButtons = await screen.findAllByRole('button');
    expect(helpButtons).toHaveLength(1);
    expect(screen.queryByText('Money in the bank.')).not.toBeInTheDocument();
    await userEvent.click(helpButtons[0]);
    const list = await screen.findByTestId('figure-help-list');
    expect(list).toHaveTextContent('Cash');
    expect(list).toHaveTextContent('Money in the bank.');
    expect(list).toHaveTextContent('Billed in period');
    expect(screen.getByText('Position today.')).toBeInTheDocument();
  });

  it('a tile with help but a hidden value does not leave its help behind', async () => {
    wrap(<><PageHeader title="Dashboard" /><KPITile icon="dollar" tone="blue" label="Cash" value="—" unavailableReason="no ledger" help="Money in the bank." /></>);
    await screen.findByTestId('page-header');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('a tile carries one truncated caption', () => {
    render(<KPITile icon="dollar" tone="blue" label="Cash" value="1" caption="vs last month" />);
    const caption = screen.getByText('vs last month');
    expect(caption.className).toContain('truncate');
    expect(caption).toHaveAttribute('title', 'vs last month');
  });
});
