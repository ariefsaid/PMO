import { act, createEvent, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUnsavedChangesGuard } from './useUnsavedChangesGuard';

/**
 * FR-MTG-040 / DD-MTG-11 — the unsaved-changes guard hook. Real anchors, a real MemoryRouter and
 * real DOM events: the oracle is where the router ends up and whether the browser default was
 * left alone, never the hook's internals.
 */

const LocationProbe: React.FC = () => {
  const location = useLocation();
  return (
    <div>
      <span data-testid="pathname">{location.pathname}</span>
      <span data-testid="state">{JSON.stringify(location.state ?? null)}</span>
    </div>
  );
};

interface HarnessProps {
  dirty: boolean;
  onBlocked: (leave: () => void) => void;
}

const Harness: React.FC<HarnessProps> = ({ dirty, onBlocked }) => {
  const guard = useUnsavedChangesGuard({ dirty, onBlocked });
  const navigate = useNavigate();
  return (
    <div>
      <a href="/plain">Plain</a>
      <a
        href="/handled"
        onClick={(event) => {
          event.preventDefault();
          navigate('/handled', { state: { from: 'crumb' } });
        }}
      >
        Handled
      </a>
      <a href="/new-tab" target="_blank" rel="noreferrer">
        New tab
      </a>
      <a href="/report.csv" download>
        Download
      </a>
      <a href="https://elsewhere.example.com/page">External</a>
      <button type="button" onClick={() => guard(() => navigate('/back', { state: { from: 'backbar' } }))}>
        Back
      </button>
      <LocationProbe />
    </div>
  );
};

const renderHarness = (props: HarnessProps) =>
  render(
    <MemoryRouter initialEntries={['/start']}>
      <Harness {...props} />
    </MemoryRouter>,
  );

// jsdom cannot perform document navigation. A window bubble-phase listener runs after every app
// listener, so it records whether the guard (or a link handler) prevented the default, then stops
// jsdom's "not implemented: navigation" so a native-default case stays observable.
let lastClickDefaultPrevented: boolean | null = null;
const recordDefault = (event: MouseEvent) => {
  lastClickDefaultPrevented = event.defaultPrevented;
  event.preventDefault();
};

beforeEach(() => {
  lastClickDefaultPrevented = null;
  window.addEventListener('click', recordDefault);
});
afterEach(() => {
  window.removeEventListener('click', recordDefault);
});

const dispatchBeforeUnload = () => {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event;
};

describe('useUnsavedChangesGuard', () => {
  it('while dirty, a plain same-origin link is held; Leave navigates to its href', async () => {
    const onBlocked = vi.fn();
    renderHarness({ dirty: true, onBlocked });

    const link = screen.getByRole('link', { name: 'Plain' });
    const click = createEvent.click(link, { button: 0 });
    fireEvent(link, click);

    expect(onBlocked).toHaveBeenCalledTimes(1);
    expect(click.defaultPrevented).toBe(true);
    expect(screen.getByTestId('pathname')).toHaveTextContent('/start');

    // Detach the jsdom navigation stopper: on replay the guard itself must keep a handler-less
    // link from a full document load and route it client-side.
    window.removeEventListener('click', recordDefault);
    const leave = onBlocked.mock.calls[0][0] as () => void;
    act(() => leave());
    expect(screen.getByTestId('pathname')).toHaveTextContent('/plain');
  });

  it("while dirty, Leave runs the link's own click handler (router state intact), not a bare path", async () => {
    const onBlocked = vi.fn();
    renderHarness({ dirty: true, onBlocked });

    await userEvent.click(screen.getByRole('link', { name: 'Handled' }));
    expect(onBlocked).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('pathname')).toHaveTextContent('/start');

    act(() => (onBlocked.mock.calls[0][0] as () => void)());
    expect(screen.getByTestId('pathname')).toHaveTextContent('/handled');
    expect(screen.getByTestId('state')).toHaveTextContent('{"from":"crumb"}');
    // The replayed click is not itself re-blocked.
    expect(onBlocked).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['ctrl', { ctrlKey: true }],
    ['cmd', { metaKey: true }],
    ['shift', { shiftKey: true }],
  ])('while dirty, a %s-click opens natively: no dialog, default not prevented', (_label, modifier) => {
    const onBlocked = vi.fn();
    renderHarness({ dirty: true, onBlocked });

    const link = screen.getByRole('link', { name: 'Plain' });
    const click = createEvent.click(link, { button: 0, ...modifier });
    fireEvent(link, click);

    expect(onBlocked).not.toHaveBeenCalled();
    expect(lastClickDefaultPrevented).toBe(false);
  });

  it.each([
    ['target=_blank', 'New tab'],
    ['download', 'Download'],
    ['cross-origin', 'External'],
  ])('while dirty, a %s link is ignored', async (_label, name) => {
    const onBlocked = vi.fn();
    renderHarness({ dirty: true, onBlocked });

    await userEvent.click(screen.getByRole('link', { name }));

    expect(onBlocked).not.toHaveBeenCalled();
    expect(lastClickDefaultPrevented).toBe(false);
  });

  it('while dirty, beforeunload is cancelled with the legacy returnValue recipe', () => {
    renderHarness({ dirty: true, onBlocked: vi.fn() });
    const event = new Event('beforeunload', { cancelable: true });
    const assigned: unknown[] = [];
    Object.defineProperty(event, 'returnValue', {
      configurable: true,
      set: (value: unknown) => assigned.push(value),
      get: () => assigned.at(-1),
    });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(assigned).toEqual([true]);
  });

  it('while pristine, nothing is intercepted: links navigate and beforeunload is not cancelled', async () => {
    const onBlocked = vi.fn();
    renderHarness({ dirty: false, onBlocked });

    await userEvent.click(screen.getByRole('link', { name: 'Handled' }));

    expect(onBlocked).not.toHaveBeenCalled();
    expect(screen.getByTestId('pathname')).toHaveTextContent('/handled');
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
  });

  it('removes its listeners on unmount', async () => {
    const onBlocked = vi.fn();
    const { unmount } = renderHarness({ dirty: true, onBlocked });
    unmount();

    const orphan = document.createElement('a');
    orphan.href = '/plain';
    orphan.textContent = 'Orphan';
    document.body.appendChild(orphan);
    try {
      await userEvent.click(orphan);
      expect(onBlocked).not.toHaveBeenCalled();
      expect(lastClickDefaultPrevented).toBe(false);
      expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
    } finally {
      orphan.remove();
    }
  });

  it('guard(): while dirty an in-page exit is held until Leave; while pristine it runs at once', async () => {
    const onBlocked = vi.fn();
    const { rerender } = renderHarness({ dirty: true, onBlocked });

    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBlocked).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('pathname')).toHaveTextContent('/start');
    act(() => (onBlocked.mock.calls[0][0] as () => void)());
    expect(screen.getByTestId('pathname')).toHaveTextContent('/back');
    expect(screen.getByTestId('state')).toHaveTextContent('{"from":"backbar"}');

    rerender(
      <MemoryRouter initialEntries={['/start']}>
        <Harness dirty={false} onBlocked={onBlocked} />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBlocked).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('pathname')).toHaveTextContent('/back');
  });
});
