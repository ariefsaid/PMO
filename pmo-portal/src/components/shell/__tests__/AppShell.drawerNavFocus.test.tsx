/**
 * AC-SHELL-001 — choosing a screen in the phone More drawer returns focus to More.
 * The route-change focus (to <main>) and the drawer-close focus return are two effects;
 * when the route commits AFTER the drawer closed (lazy route / transition), the route
 * effect ran last and stole focus from More. Owning layer: Vitest/RTL (the stealer is AppShell).
 */
import { describe, it, expect } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router';
import React from 'react';
import { AppShell } from '../AppShell';

const Harness: React.FC<{ lateMs: number }> = ({ lateMs }) => {
  const [open, setOpen] = React.useState(false);
  const navigate = useNavigate();
  const rail = (
    <a
      href="/projects"
      onClick={(e) => {
        e.preventDefault();
        setOpen(false); // drawer closes in the click's commit …
        setTimeout(() => navigate('/projects'), lateMs); // … the route commits later
      }}
    >
      Projects
    </a>
  );
  return (
    <>
      <button type="button" data-drawer-toggle onClick={() => setOpen(true)}>
        More
      </button>
      <AppShell rail={rail} header={null} railOpen={open} onCloseRail={() => setOpen(false)}>
        <div>content</div>
      </AppShell>
    </>
  );
};

describe('AC-SHELL-001 drawer navigation returns focus to More', () => {
  it.each([0, 40])('route committing %ims after the drawer closed leaves focus on More', async (lateMs) => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Harness lateMs={lateMs} />
      </MemoryRouter>,
    );
    const more = screen.getByRole('button', { name: 'More' });
    more.focus();
    fireEvent.click(more);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('link', { name: 'Projects' }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, lateMs + 30));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(more).toHaveFocus();
  });
});
