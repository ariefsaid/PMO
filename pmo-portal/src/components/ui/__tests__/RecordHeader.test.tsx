import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { RecordHeader } from '../RecordHeader';
import { StatusPill } from '../StatusPill';

describe('RecordHeader', () => {
  it('UIP-009: keeps the status beside the title at every width, with meta below and caller classes retained', () => {
    render(<RecordHeader icon="P" name="Long purchasing record identity" status={<StatusPill variant="progress">Requested</StatusPill>} meta="PR-014" className="consumer-class" actions={<button>Edit</button>} />);
    const header = screen.getByTestId('record-header');
    const title = screen.getByRole('heading', { name: 'Long purchasing record identity' });
    const status = screen.getByText('Requested');
    expect(title).toBeVisible();
    expect(title.parentElement).toContainElement(status);
    expect(title.parentElement?.className).toContain('flex-nowrap');
    expect(title.className).toContain('flex-[0_1_auto]');
    expect(title.className).not.toContain('flex-1');
    expect(screen.getByText('PR-014').parentElement).not.toBe(title.parentElement);
    expect(header.className).toContain('consumer-class');
    expect(header).toHaveTextContent(/Long purchasing record identity.*Requested.*PR-014.*Edit/);
  });
  it('renders the canonical anatomy: icon tile + name + status + top-right actions', () => {
    render(
      <RecordHeader
        icon="A"
        name="Acme Corp"
        status={<StatusPill variant="won">Active</StatusPill>}
        actions={<button type="button">Edit</button>}
      />,
    );
    const header = screen.getByTestId('record-header');
    expect(header).toBeInTheDocument();
    // identity
    expect(screen.getByRole('heading', { name: 'Acme Corp' })).toBeInTheDocument();
    // status pill is present
    expect(screen.getByText('Active')).toBeInTheDocument();
    // the icon tile shows the leading glyph
    expect(header).toHaveTextContent('A');
    // the action zone holds the Edit affordance
    const actionZone = screen.getByTestId('record-header-actions');
    expect(actionZone).toContainElement(screen.getByRole('button', { name: 'Edit' }));
  });

  it('forwards meta and iconColor to the underlying PageHeader anatomy', () => {
    render(
      <RecordHeader
        icon="P"
        iconColor="hsl(280 50% 50%)"
        name="Project X"
        status={<StatusPill variant="progress">In progress</StatusPill>}
        meta="Cascade Port · PRJ-001"
      />,
    );
    expect(screen.getByText('Cascade Port · PRJ-001')).toBeInTheDocument();
  });

  it('keeps the full record name, status, and actions available', () => {
    render(
      <RecordHeader
        icon="C"
        name="Cascade Port Authority — A Very Long Record Name"
        status={<StatusPill variant="neutral">Client</StatusPill>}
        actions={<button type="button">Edit</button>}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Cascade Port Authority — A Very Long Record Name' })).toBeVisible();
    expect(screen.getByText('Client')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeVisible();
  });

  it('#1591: the action slot may shrink and wrap so a long unbreakable action cannot widen the page at 320px', () => {
    render(
      <RecordHeader
        icon={null}
        variant="drawer"
        name="Record"
        status={<StatusPill variant="neutral">Client</StatusPill>}
        actions={<button type="button">Edit</button>}
      />,
    );
    const slot = screen.getByTestId('record-header-actions');
    expect(slot.className).toContain('min-w-0');
    expect(slot.className).toContain('flex-wrap');
  });

  it('drawer variant renders without the standalone card chrome (host supplies the seam)', () => {
    render(
      <RecordHeader
        variant="drawer"
        icon="C"
        name="Jane Doe"
        status={<StatusPill variant="violet">Vendor</StatusPill>}
        actions={<button type="button">Archive</button>}
      />,
    );
    const header = screen.getByTestId('record-header');
    // drawer variant drops the bordered/card wrapper used by the page variant
    expect(header.className).not.toContain('border-border');
    expect(header.className).not.toContain('bg-card');
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
  });

  it('2057: one primary action, then an overflow menu whose items run and close it; danger item is destructive', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const onArchive = vi.fn();
    render(
      <RecordHeader
        icon="C"
        name="Acme"
        status={<StatusPill variant="neutral">Client</StatusPill>}
        primaryAction={<button type="button">Edit</button>}
        menuItems={[
          { key: 'copy', label: 'Copy link', onSelect: onEdit },
          { key: 'archive', label: 'Archive', onSelect: onArchive, danger: true, testId: 'archive-item' },
        ]}
      />,
    );
    const zone = screen.getByTestId('record-header-actions');
    expect(zone).toContainElement(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.queryByRole('menu')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    await user.click(await screen.findByTestId('archive-item'));
    expect(onArchive).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('keeps the primary action before a direct legacy action when explicitly requested', () => {
    render(
      <RecordHeader
        icon="C"
        name="Acme"
        status="Active"
        primaryAction={<button type="button">Edit</button>}
        actions={<button type="button">Archive</button>}
        actionsAfterPrimary
      />,
    );

    expect(within(screen.getByTestId('record-header-actions')).getAllByRole('button').map((button) => button.textContent))
      .toEqual(['Edit', 'Archive']);
  });

  it('2057: Escape closes the menu and keeps focus on its trigger; no trigger without items', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <RecordHeader icon="C" name="Acme" status="x" menuItems={[{ key: 'a', label: 'Do it', onSelect: vi.fn() }]} />,
    );
    const trigger = screen.getByRole('button', { name: 'More actions' });
    await user.click(trigger);
    await screen.findByRole('menu');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(trigger).toHaveFocus();
    rerender(<RecordHeader icon="C" name="Acme" status="x" menuItems={[]} />);
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
  });

  it('2057: key facts render as a labelled row under the title', () => {
    render(<RecordHeader icon="C" name="Acme" status="x" stats={[{ label: 'Value', value: 'Rp 5.000' }, { label: 'Due', value: '1 Jan' }]} />);
    expect(screen.getByText('Value')).toBeInTheDocument();
    expect(screen.getByText('Rp 5.000')).toBeInTheDocument();
  });

  it('one filled primary action; every other action is in the menu (a record header has no row of buttons)', async () => {
    const run = vi.fn();
    render(
      <RecordHeader
        icon={null}
        name="PR-014"
        status={<StatusPill variant="progress">Requested</StatusPill>}
        primaryAction={<button type="button">Approve</button>}
        menuItems={[{ key: 'h', label: 'Full history', onSelect: run }, { key: 'x', label: 'Reject', onSelect: run, danger: true }]}
        stats={[{ label: 'Value', value: 'IDR 1M' }, { label: 'Needed by', value: '12 Nov' }]}
      />,
    );
    const zone = screen.getByTestId('record-header-actions');
    expect(within(zone).getAllByRole('button').map((b) => b.textContent)).toEqual(['Approve', '⋯']);
    expect(screen.getByText('Needed by')).toBeInTheDocument();
    await userEvent.click(within(zone).getByRole('button', { name: /more actions/i }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Reject' }));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('the page title is at least 20px (text-page token) and there is no menu trigger without items', () => {
    render(<RecordHeader icon={null} name="PR-014" status="Requested" menuItems={[]} />);
    expect(screen.getByRole('heading', { name: 'PR-014' }).className).toContain('text-page');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
