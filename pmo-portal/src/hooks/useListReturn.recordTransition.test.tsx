import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { useListReturn } from './useListReturn';
import { resetRecordTransition } from '@/src/lib/recordTransition';

/** #2148: opening a record and returning to the list ask the router for a view transition only when it may run. */
function List({ on = true }: { on?: boolean }) {
  const { openRecord } = useListReturn({ list: 'projects', recordTransition: on });
  return (
    <div>
      <button data-record-title="p1" onClick={() => openRecord('/projects/p1')}>Open p1</button>
      <button data-record-title="p2" onClick={() => openRecord('/projects/p2')}>Open p2</button>
    </div>
  );
}
function Detail() {
  const { returnToList } = useListReturn({ list: 'projects', recordTransition: true });
  return <button onClick={() => returnToList()}>Back to projects</button>;
}

const setup = (listOn = true) => {
  const router = createMemoryRouter(
    [
      { path: '/projects', element: <List on={listOn} /> },
      { path: '/projects/:id', element: <Detail /> },
    ],
    { initialEntries: ['/projects'] },
  );
  const navigate = vi.spyOn(router, 'navigate');
  render(<RouterProvider router={router} />);
  return { router, navigate };
};

/** The elements carrying a transition name at the moment the browser would capture the old page. */
let namedAtCapture: string[] = [];
const fakeStart = (update: () => void) => {
  namedAtCapture = [...document.querySelectorAll<HTMLElement>('[data-record-title]')]
    .filter((el) => el.style.getPropertyValue('view-transition-name') !== '')
    .map((el) => `${el.getAttribute('data-record-title')}=${el.style.getPropertyValue('view-transition-name')}`);
  update();
  return { finished: Promise.resolve(), ready: Promise.resolve(), updateCallbackDone: Promise.resolve(), skipTransition() {} };
};

const motion = (supported: boolean, reduce: boolean) => {
  if (supported) (document as unknown as Record<string, unknown>).startViewTransition = fakeStart;
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduce && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }));
};

beforeEach(() => { resetRecordTransition(); namedAtCapture = []; });
afterEach(() => {
  vi.unstubAllGlobals();
  delete (document as unknown as Record<string, unknown>).startViewTransition;
});

describe('useListReturn recordTransition (#2148)', () => {
  it('AC-1 opening a record asks for a view transition and names only the clicked row', async () => {
    motion(true, false);
    const { navigate } = setup();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open p1' })); });
    expect(navigate).toHaveBeenCalledWith('/projects/p1', expect.objectContaining({ viewTransition: true }));
    expect(namedAtCapture).toEqual(['p1=record-p1']);
    expect(screen.getByRole('button', { name: 'Back to projects' })).toBeInTheDocument();
  });

  it('AC-2 an explicit return to the list asks for a view transition, leaving a record', async () => {
    motion(true, false);
    const { navigate, router } = setup();
    await act(async () => { await router.navigate('/projects/p1'); });
    navigate.mockClear();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Back to projects' })); });
    expect(navigate).toHaveBeenCalledWith('/projects', expect.objectContaining({ viewTransition: true }));
    expect(document.documentElement.getAttribute('data-record-transition')).toBe('out');
  });

  it('AC-3 under reduced motion the page swaps with no view transition and still navigates', async () => {
    motion(true, true);
    const { navigate } = setup();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open p1' })); });
    expect(navigate.mock.calls[0][1]).not.toHaveProperty('viewTransition');
    expect(screen.getByRole('button', { name: 'Back to projects' })).toBeInTheDocument();
  });

  it('AC-4 without View Transitions navigation is exactly as before and raises no error', async () => {
    motion(false, false);
    const { navigate } = setup();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open p1' })); });
    expect(navigate.mock.calls[0][1]).not.toHaveProperty('viewTransition');
    expect(screen.getByRole('button', { name: 'Back to projects' })).toBeInTheDocument();
  });

  it('a list that has not opted in never asks for one', async () => {
    motion(true, false);
    const { navigate } = setup(false);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open p2' })); });
    expect(navigate.mock.calls[0][1]).not.toHaveProperty('viewTransition');
  });
});
