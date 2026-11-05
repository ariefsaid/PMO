import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useRemoteStringDraft } from './useRemoteStringDraft';

type Props = { remote: string | null | undefined; isSuccess: boolean };

function renderDraft(initialProps: Props = { remote: null, isSuccess: true }) {
  return renderHook(({ remote, isSuccess }: Props) => useRemoteStringDraft({ remote, isSuccess }), {
    initialProps,
  });
}

describe('useRemoteStringDraft', () => {
  it('hydrates the draft from the first successful read of the saved value', () => {
    const view = renderDraft({ remote: 'Saved - DEMO', isSuccess: true });
    expect(view.result.current.draft).toBe('Saved - DEMO');
    expect(view.result.current.dirty).toBe(false);
    expect(view.result.current.remoteChanged).toBe(false);

    const cleared = renderDraft({ remote: null, isSuccess: true });
    expect(cleared.result.current.draft).toBe('');
    expect(cleared.result.current.dirty).toBe(false);
  });

  it('leaves the draft empty while the saved-value read is still pending', () => {
    const view = renderDraft({ remote: undefined, isSuccess: false });
    expect(view.result.current.draft).toBe('');
    expect(view.result.current.dirty).toBe(false);
  });

  it('silently adopts a remote change while the draft is clean', () => {
    const view = renderDraft({ remote: 'Saved - DEMO', isSuccess: true });
    view.rerender({ remote: 'Moved On - DEMO', isSuccess: true });
    expect(view.result.current.draft).toBe('Moved On - DEMO');
    expect(view.result.current.dirty).toBe(false);
    expect(view.result.current.remoteChanged).toBe(false);
  });

  it('keeps a dirty draft and flags the remote change', () => {
    const view = renderDraft({ remote: 'Saved - DEMO', isSuccess: true });
    act(() => view.result.current.setDraft('My Edit - DEMO'));
    expect(view.result.current.dirty).toBe(true);

    view.rerender({ remote: 'Moved On - DEMO', isSuccess: true });
    expect(view.result.current.draft).toBe('My Edit - DEMO');
    expect(view.result.current.dirty).toBe(true);
    expect(view.result.current.remoteChanged).toBe(true);
  });

  it('acceptSaved moves the baseline to the just-saved value and clears the flag', () => {
    const view = renderDraft({ remote: 'Saved - DEMO', isSuccess: true });
    act(() => view.result.current.setDraft('My Edit - DEMO'));
    view.rerender({ remote: 'Moved On - DEMO', isSuccess: true });
    expect(view.result.current.remoteChanged).toBe(true);

    act(() => view.result.current.acceptSaved('My Edit - DEMO'));
    expect(view.result.current.dirty).toBe(false);
    expect(view.result.current.remoteChanged).toBe(false);
  });

  it('acceptSaved of a cleared value keeps an empty draft clean', () => {
    const view = renderDraft({ remote: 'Saved - DEMO', isSuccess: true });
    act(() => view.result.current.setDraft(''));
    act(() => view.result.current.acceptSaved(null));
    // The page re-renders once the post-save invalidation lands.
    view.rerender({ remote: null, isSuccess: true });
    expect(view.result.current.draft).toBe('');
    expect(view.result.current.dirty).toBe(false);
    expect(view.result.current.remoteChanged).toBe(false);
  });

  it('reload discards the draft and adopts the current saved value', () => {
    const view = renderDraft({ remote: 'Saved - DEMO', isSuccess: true });
    act(() => view.result.current.setDraft('My Edit - DEMO'));
    view.rerender({ remote: 'Moved On - DEMO', isSuccess: true });
    expect(view.result.current.remoteChanged).toBe(true);

    act(() => view.result.current.reload());
    expect(view.result.current.draft).toBe('Moved On - DEMO');
    expect(view.result.current.dirty).toBe(false);
    expect(view.result.current.remoteChanged).toBe(false);
  });
});
