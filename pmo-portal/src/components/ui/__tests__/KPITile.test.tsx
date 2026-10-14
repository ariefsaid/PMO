import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { KPITile } from '../KPITile';

describe('KPITile', () => {
  it('AC-IXD-DASH-W5-C2A: only a drillable (link) tile carries the hover-lift affordance; a plain tile is static (design-review I1)', () => {
    const { rerender } = render(
      <MemoryRouter>
        <KPITile icon="dollar" tone="blue" label="At risk" value="3" testId="kpi-x" to="/projects?filter=at-risk" linkLabel="Open at-risk" />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('kpi-x').className).toContain('hover:shadow-');
    rerender(
      <MemoryRouter>
        <KPITile icon="dollar" tone="blue" label="On-hand margin" value="12%" testId="kpi-x" />
      </MemoryRouter>,
    );
    // plain tile: no hover-lift (no false affordance)
    expect(screen.getByTestId('kpi-x').className).not.toContain('hover:shadow-');
  });

  it('renders label + tabular value', () => {
    render(<KPITile icon="dollar" tone="blue" label="Pipeline value" value="$4.2M" />);
    expect(screen.getByText('Pipeline value')).toBeInTheDocument();
    const v = screen.getByText('$4.2M');
    expect(v.className).toContain('tabular');
  });

  it('negative value turns destructive', () => {
    render(<KPITile icon="dollar" tone="red" label="Margin" value="-$120K" negative />);
    expect(screen.getByText('-$120K').className).toContain('text-destructive');
  });

  it('delta direction maps to the right chip tone', () => {
    const { rerender } = render(
      <KPITile icon="up" tone="green" label="x" value="1" delta={{ dir: 'up', text: '+12%' }} />
    );
    expect(screen.getByTestId('kpi-delta').className).toContain('text-success');
    rerender(
      <KPITile icon="down" tone="red" label="x" value="1" delta={{ dir: 'down', text: '-4%' }} />
    );
    expect(screen.getByTestId('kpi-delta').className).toContain('text-destructive');
  });

  it('help is a native keyboard-focusable button with an accessible name', () => {
    render(<KPITile icon="dollar" tone="blue" label="x" value="1" help="Weighted by stage" />);
    expect(screen.getByRole('button', { name: /help/i })).toBeInTheDocument();
  });

  it('loading renders a skeleton tile', () => {
    render(<KPITile icon="dollar" tone="blue" label="x" value="" loading />);
    expect(screen.getByTestId('kpi-skeleton')).toBeInTheDocument();
  });

  // ── Link variant (Wave-5 N15: tile shortcut + independent help) ───────────
  describe('link variant (to=)', () => {
    it('keeps the destination link as the tile doorway', () => {
      render(
        <MemoryRouter>
          <KPITile
            icon="check"
            tone="amber"
            label="Awaiting your approval"
            value="3"
            to="/approvals"
            linkLabel="Awaiting your approval: 3 items"
            testId="approval-tile"
          />
        </MemoryRouter>,
      );
      const tile = screen.getByTestId('approval-tile');
      const link = within(tile).getByRole('link', { name: 'Awaiting your approval: 3 items' });
      expect(link).toHaveAttribute('href', '/approvals');
      expect(tile).toHaveTextContent('3');
    });

    it('AC-986-003: linked help is independently keyboard/touch reachable and never navigates', async () => {
      const user = userEvent.setup();
      function CurrentPath() {
        const location = useLocation();
        return <output data-testid="current-path">{location.pathname}</output>;
      }

      render(
        <MemoryRouter initialEntries={['/']}>
          <CurrentPath />
          <KPITile
            icon="check"
            tone="amber"
            label="Awaiting your approval"
            value="3"
            to="/approvals"
            linkLabel="Approval destination"
            help="Items waiting on your decision"
            helpLabel="Approval help"
            testId="approval-tile"
          />
        </MemoryRouter>,
      );

      const tile = screen.getByTestId('approval-tile');
      const link = within(tile).getByRole('link', { name: 'Approval destination' });
      const help = within(tile).getByRole('button', { name: 'Approval help: Awaiting your approval' });
      expect(link).toHaveAttribute('href', '/approvals');
      expect(link.contains(help)).toBe(false);
      expect(help).toHaveClass('touch-target');

      await user.tab();
      expect(link).toHaveFocus();
      await user.tab();
      expect(help).toHaveFocus();
      expect(screen.getByRole('tooltip')).toHaveTextContent('Items waiting on your decision');

      await user.keyboard('{Enter}');
      expect(screen.getByTestId('current-path')).toHaveTextContent('/');
      await user.click(help);
      expect(screen.getByTestId('current-path')).toHaveTextContent('/');

      await user.click(link);
      expect(screen.getByTestId('current-path')).toHaveTextContent('/approvals');
    });

    it('non-link tile is a div (no router needed)', () => {
      render(<KPITile icon="dollar" tone="blue" label="Pipeline" value="$1" />);
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });
  });

  it('AC-W6-H1: KPITone no longer accepts cyan (off-palette literal removed)', () => {
    // @ts-expect-error cyan is no longer a member of KPITone
    render(<KPITile icon="folder" tone="cyan" label="x" value="1" />);
  });

  it('dual-lens toggle switches value + aria-selected', async () => {
    const onLens = vi.fn();
    render(
      <KPITile
        icon="dollar"
        tone="blue"
        label="Backlog"
        value="$4.2M"
        dual={{ lens: 'onhand', onLens, options: [
          { value: 'onhand', label: 'On hand' },
          { value: 'weighted', label: 'Weighted' },
        ] }}
      />
    );
    const weighted = screen.getByRole('tab', { name: 'Weighted' });
    expect(screen.getByRole('tab', { name: 'On hand' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(weighted);
    expect(onLens).toHaveBeenCalledWith('weighted');
  });
});
