// Test helpers for the document viewer suites (not imported by production code).
import { type ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { DocumentViewerProvider } from './DocumentViewerProvider';
import type { DocumentViewTarget, PreviewResult } from './types';

export interface Deferred<T> { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void }
export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

export const target = (over: Partial<DocumentViewTarget> & { result?: PreviewResult } = {}): DocumentViewTarget => {
  const { result = { mode: 'image', url: 'https://signed.test/a.png' }, ...rest } = over;
  return { key: 'k1', name: 'Plan.png', sourceLabel: 'PMO', load: async () => result, ...rest };
};

export function renderViewer(ui: ReactNode, path = '/') {
  return render(<MemoryRouter initialEntries={[path]}><DocumentViewerProvider>{ui}</DocumentViewerProvider></MemoryRouter>);
}

/** The preview iframe by its title. The viewer's heading carries the same text as a tooltip, so a bare title query is ambiguous. */
export async function findFrame(name: string): Promise<HTMLIFrameElement> {
  return waitFor(() => {
    const frame = screen.getAllByTitle(name).find((el): el is HTMLIFrameElement => el.tagName === 'IFRAME');
    if (!frame) throw new Error(`no preview frame titled ${name}`);
    return frame;
  });
}
