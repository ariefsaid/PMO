import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentViewerProvider } from './DocumentViewerProvider';
import { useDocumentViewer } from './viewerContext';
import { PreviewFailure, type PreviewResult } from './types';
import { deferred, renderViewer, target } from './testkit';
import { Harness } from './Harness';

afterEach(() => vi.useRealTimers());

describe('document-preview AC-006 the viewer state machine', () => {
  it('opens the panel and shows its loading status before the load resolves (NFR-004)', async () => {
    const d = deferred<PreviewResult>();
    const a = target({ load: vi.fn(() => d.promise) });
    renderViewer(<Harness targets={[a]} />);
    expect(a.load).not.toHaveBeenCalled(); // a list row loads nothing at render time
    await userEvent.click(screen.getByRole('button', { name: 'Preview Plan.png' }));
    expect(await screen.findByRole('dialog', { name: 'Plan.png' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading preview…');
    expect(a.load).toHaveBeenCalledTimes(1);
    d.resolve({ mode: 'image', url: 'https://signed.test/a.png' });
    expect(await screen.findByRole('img', { name: 'Plan.png' })).toHaveAttribute('src', 'https://signed.test/a.png');
  });

  it('an expired preview offers Retry that requests fresh access with a fresh signal', async () => {
    const signals: AbortSignal[] = [];
    const load = vi.fn(async (signal: AbortSignal): Promise<PreviewResult> => {
      signals.push(signal);
      if (load.mock.calls.length === 1) throw new PreviewFailure('expired');
      return { mode: 'image', url: 'https://signed.test/fresh.png' };
    });
    renderViewer(<Harness targets={[target({ load })]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Preview Plan.png' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('img', { name: 'Plan.png' })).toHaveAttribute('src', 'https://signed.test/fresh.png');
    expect(load).toHaveBeenCalledTimes(2);
    expect(signals[1]).not.toBe(signals[0]);
    expect(signals[1]!.aborted).toBe(false);
  });

  it('a late result for the first file never appears for the second, and its signal is aborted', async () => {
    const first = deferred<PreviewResult>();
    let firstSignal!: AbortSignal;
    const a = target({ key: 'a', name: 'A.png', load: (signal) => { firstSignal = signal; return first.promise; } });
    const b = target({ key: 'b', name: 'B.png', result: { mode: 'image', url: 'https://signed.test/b.png' } });
    renderViewer(<Harness targets={[a, b]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Preview A.png' }));
    await userEvent.click(screen.getByRole('button', { name: 'Preview B.png' }));
    expect(await screen.findByRole('img', { name: 'B.png' })).toBeInTheDocument();
    expect(firstSignal.aborted).toBe(true);
    await act(async () => { first.resolve({ mode: 'image', url: 'https://signed.test/a.png' }); });
    expect(screen.getByRole('img', { name: 'B.png' })).toHaveAttribute('src', 'https://signed.test/b.png');
    expect(screen.queryByRole('img', { name: 'A.png' })).not.toBeInTheDocument();
  });

  it('a late failure of the first file cannot overwrite the second either', async () => {
    const first = deferred<PreviewResult>();
    const a = target({ key: 'a', name: 'A.png', load: () => first.promise });
    const b = target({ key: 'b', name: 'B.png' });
    renderViewer(<Harness targets={[a, b]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Preview A.png' }));
    await userEvent.click(screen.getByRole('button', { name: 'Preview B.png' }));
    await screen.findByRole('img', { name: 'B.png' });
    await act(async () => { first.reject(new PreviewFailure('access_denied')); });
    expect(screen.getByRole('img', { name: 'B.png' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('closing while pending aborts the load and a later resolve renders nothing', async () => {
    const d = deferred<PreviewResult>();
    let signal!: AbortSignal;
    renderViewer(<Harness targets={[target({ load: (s) => { signal = s; return d.promise; } })]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Preview Plan.png' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Close' }));
    expect(signal.aborted).toBe(true);
    await act(async () => { d.resolve({ mode: 'image', url: 'https://signed.test/a.png' }); });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('never retries on its own: a failed load is called once for a minute of waiting', async () => {
    const load = vi.fn().mockRejectedValue(new PreviewFailure('unavailable'));
    renderViewer(<Harness targets={[target({ load })]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Preview Plan.png' }));
    await screen.findByRole('alert');
    vi.useFakeTimers();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('a synchronously throwing load is a failed state, not a crash', async () => {
    renderViewer(<Harness targets={[target({ load: () => { throw new Error('boom'); } })]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Preview Plan.png' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("The preview couldn't be loaded. Try again.");
  });

  it('the preview URL lives in component state only: nothing enters the query cache or storage (NFR-002)', async () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter><DocumentViewerProvider><Harness targets={[target()]} /></DocumentViewerProvider></MemoryRouter>
      </QueryClientProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Preview Plan.png' }));
    await screen.findByRole('img', { name: 'Plan.png' });
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(JSON.stringify({ ...localStorage })).not.toContain('signed.test');
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('signed.test');
  });

  it('useDocumentViewer outside a provider fails loudly', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const Bare = () => { useDocumentViewer(); return null; };
    expect(() => render(<Bare />)).toThrow('useDocumentViewer must be used inside <DocumentViewerProvider>');
    spy.mockRestore();
  });

  it('an image that fails to render becomes a failed state with Retry', async () => {
    renderViewer(<Harness targets={[target()]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Preview Plan.png' }));
    fireEvent.error(await screen.findByRole('img', { name: 'Plan.png' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("The preview couldn't be loaded. Try again.");
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  });

  it('waitFor sanity: the dialog is absent before anything opens', async () => {
    renderViewer(<Harness targets={[target()]} />);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
