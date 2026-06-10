/**
 * AC-W6-IXD-MENU — DataTable RowMenu must escape the overflow clip + close the
 * a11y gaps.
 *
 * The open `role="menu"` was `position:absolute` inside the table branch's
 * `overflow-x-auto` (and the wrapper's `overflow-hidden`) clipping contexts, so
 * the popover was cut at the table edge (≈66px at 1440, off-screen at 375).
 * jsdom has no layout, so the CLIP-VISIBILITY itself is a render-gate concern —
 * here we assert the DOM-STRUCTURE contract that makes the fix possible: the
 * menu is PORTALED to document.body, i.e. it is NOT a descendant of the
 * clipping `dt-table-branch` wrapper.
 *
 * Plus the added a11y contract: focus-to-first on open, return-focus-to-trigger
 * on close, Arrow/Home/End roving (wrap), Enter/Space activate,
 * aria-orientation="vertical", and the load-bearing stopPropagation guard
 * (clicking a menu item must never fire the row's onActivate — guards PR-B).
 *
 * Owning layer: Unit/RTL (the render-clip itself is verified by design-reviewer).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataTable, type Column } from '../DataTable';

interface Row {
  id: string;
  name: string;
  value: number;
}
const rows: Row[] = [
  { id: 'PRJ-1', name: 'Alpha', value: 1200 },
  { id: 'PRJ-2', name: 'Beta', value: 980 },
];
const columns: Column<Row>[] = [
  { key: 'name', header: 'Name', cell: (r) => r.name },
  { key: 'value', header: 'Value', align: 'num', cell: (r) => r.value },
];

const openFirstMenu = async () => {
  const trigger = screen.getAllByRole('button', { name: /row actions/i })[0];
  await userEvent.click(trigger);
  return { trigger, menu: screen.getByRole('menu') };
};

describe('DataTable RowMenu — clip escape + a11y (AC-W6-IXD-MENU)', () => {
  it('AC-W6-IXD-MENU: the open menu renders OUTSIDE the clipping ancestor (portaled to document.body)', async () => {
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        rowMenu={() => [
          { label: 'Edit', onClick: vi.fn() },
          { label: 'Delete', danger: true, onClick: vi.fn() },
        ]}
      />,
    );
    const { menu } = await openFirstMenu();
    // The clipping wrapper is the table branch (overflow-x-auto, inside the
    // outer overflow-hidden card). The portaled menu must NOT live inside it.
    const clipAncestor = screen.getByTestId('dt-table-branch');
    expect(clipAncestor.contains(menu)).toBe(false);
    // It is portaled to document.body (a top-level layer with no overflow clip).
    expect(menu.closest('[data-testid="dt-table-branch"]')).toBeNull();
    expect(document.body.contains(menu)).toBe(true);
  });

  it('AC-W6-IXD-MENU: the menu container carries aria-orientation="vertical"', async () => {
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        rowMenu={() => [{ label: 'Edit', onClick: vi.fn() }]}
      />,
    );
    const { menu } = await openFirstMenu();
    expect(menu).toHaveAttribute('aria-orientation', 'vertical');
  });

  it('AC-W6-IXD-MENU: focus moves to the first menuitem on open', async () => {
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        rowMenu={() => [
          { label: 'Edit', onClick: vi.fn() },
          { label: 'Delete', danger: true, onClick: vi.fn() },
        ]}
      />,
    );
    const { menu } = await openFirstMenu();
    const items = within(menu).getAllByRole('menuitem');
    expect(items[0]).toHaveFocus();
  });

  it('AC-W6-IXD-MENU: focus returns to the trigger when Esc closes the menu', async () => {
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        rowMenu={() => [{ label: 'Edit', onClick: vi.fn() }]}
      />,
    );
    const { trigger } = await openFirstMenu();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('AC-W6-IXD-MENU: focus returns to the trigger after activating an item', async () => {
    const onClick = vi.fn();
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        rowMenu={() => [{ label: 'Edit', onClick }]}
      />,
    );
    const { trigger, menu } = await openFirstMenu();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Edit' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('AC-W6-IXD-MENU: ArrowDown/ArrowUp rove focus and wrap at the ends', async () => {
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        rowMenu={() => [
          { label: 'Edit', onClick: vi.fn() },
          { label: 'Archive', onClick: vi.fn() },
          { label: 'Delete', danger: true, onClick: vi.fn() },
        ]}
      />,
    );
    const { menu } = await openFirstMenu();
    const items = within(menu).getAllByRole('menuitem');
    expect(items[0]).toHaveFocus(); // open → first
    await userEvent.keyboard('{ArrowDown}');
    expect(items[1]).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(items[2]).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}'); // wrap to first
    expect(items[0]).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}'); // wrap to last
    expect(items[2]).toHaveFocus();
  });

  it('AC-W6-IXD-MENU: Home/End jump to first/last menuitem', async () => {
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        rowMenu={() => [
          { label: 'Edit', onClick: vi.fn() },
          { label: 'Archive', onClick: vi.fn() },
          { label: 'Delete', danger: true, onClick: vi.fn() },
        ]}
      />,
    );
    const { menu } = await openFirstMenu();
    const items = within(menu).getAllByRole('menuitem');
    await userEvent.keyboard('{End}');
    expect(items[2]).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(items[0]).toHaveFocus();
  });

  it('AC-W6-IXD-MENU: Enter and Space activate the focused menuitem', async () => {
    const edit = vi.fn();
    const archive = vi.fn();
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        rowMenu={() => [
          { label: 'Edit', onClick: edit },
          { label: 'Archive', onClick: archive },
        ]}
      />,
    );
    await openFirstMenu();
    await userEvent.keyboard('{Enter}'); // first item focused → Edit
    expect(edit).toHaveBeenCalledTimes(1);
    // reopen and use Space on the second item
    await openFirstMenu();
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard(' ');
    expect(archive).toHaveBeenCalledTimes(1);
  });

  it('AC-W6-IXD-MENU: activating a menu item does NOT fire the row onActivate (stopPropagation preserved)', async () => {
    const onActivate = vi.fn();
    const itemClick = vi.fn();
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        onActivate={onActivate}
        rowLabel={(r) => `Open ${r.name}`}
        rowMenu={() => [{ label: 'Delete', danger: true, onClick: itemClick }]}
      />,
    );
    const { menu } = await openFirstMenu();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Delete' }));
    expect(itemClick).toHaveBeenCalledTimes(1);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('AC-W6-IXD-MENU: opening the trigger does NOT fire the row onActivate', async () => {
    const onActivate = vi.fn();
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        onActivate={onActivate}
        rowLabel={(r) => `Open ${r.name}`}
        rowMenu={() => [{ label: 'Delete', danger: true, onClick: vi.fn() }]}
      />,
    );
    await openFirstMenu();
    expect(onActivate).not.toHaveBeenCalled();
  });
});
