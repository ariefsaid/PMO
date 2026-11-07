import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';

const chunk = vi.hoisted(() => ({ fail: true }));
// A getter that throws makes the slot's import().then(...) reject with OUR message (a throwing
// factory would be rewrapped by vitest), like a stale-manifest chunk 404 does in the browser.
vi.mock('./AssistantPanel', () => ({
  get AssistantPanel() {
    if (chunk.fail) throw new Error('Failed to fetch dynamically imported module: /assets/AssistantPanel-x.js');
    return () => <div>panel ok</div>;
  },
}));

import { AssistantPanelSlot } from './AssistantPanelSlot';
import { shouldReloadForChunkError } from '@/src/lib/chunkReload';

afterEach(cleanup);

describe('AssistantPanelSlot (perf/vendor-chunk review I1)', () => {
  it('a rejected panel chunk shows a small in-panel error; siblings stay usable', async () => {
    const stale: string[] = [];
    const onRej = (e: Event) => stale.push(String((e as PromiseRejectionEvent).reason?.message));
    window.addEventListener('unhandledrejection', onRej);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <div>
        <button>shell control</button>
        <AssistantPanelSlot open={false} />
      </div>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(/assistant/i);
    expect(screen.getByRole('button', { name: 'shell control' })).toBeInTheDocument();
    // the stale-chunk guard sees the same failure it sees for route chunks
    await waitFor(() => expect(stale.length).toBeGreaterThan(0));
    expect(shouldReloadForChunkError(stale[0], false)).toBe(true);
    window.removeEventListener('unhandledrejection', onRej);

    // Retry re-imports and recovers
    chunk.fail = false;
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByText('panel ok')).toBeInTheDocument();
    spy.mockRestore();
  });
});
