import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ManagementProfitLossCard } from './ManagementProfitLossCard';

const labels = { title: 'Management profit and loss', line: 'Ledger statements come from an accounting system when one is connected.', openReports: 'Open reports', setUp: 'Set up accounting', marginHint: 'Cost and margin appear in reports once this is on:', marginSetting: 'Profit per discipline' };

describe('ManagementProfitLossCard', () => {
  it('AC-NEF-001 shows title, one line and Open reports', async () => {
    const open = vi.fn();
    render(<ManagementProfitLossCard labels={labels} onOpenReports={open} />);
    expect(screen.getByRole('heading', { name: labels.title })).toBeTruthy();
    expect(screen.getByText(labels.line)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Open reports' }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Set up accounting' })).toBeNull();
    expect(screen.queryByText(labels.marginHint, { exact: false })).toBeNull();
  });
  it('AC-NEF-003 offers set-up and the margin setting pointer only when handlers are passed', async () => {
    const setUp = vi.fn(); const margin = vi.fn();
    render(<ManagementProfitLossCard labels={labels} onOpenReports={() => undefined} onSetUp={setUp} onOpenMarginSetting={margin} />);
    await userEvent.click(screen.getByRole('button', { name: 'Set up accounting' }));
    await userEvent.click(screen.getByRole('button', { name: 'Profit per discipline' }));
    expect(setUp).toHaveBeenCalled(); expect(margin).toHaveBeenCalled();
  });
  it('hides Open reports when the viewer has no Reports screen', () => {
    render(<ManagementProfitLossCard labels={labels} />);
    expect(screen.queryByRole('button', { name: 'Open reports' })).toBeNull();
    expect(screen.getByText(labels.line)).toBeTruthy();
  });
});
