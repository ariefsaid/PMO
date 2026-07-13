import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

const analytics = vi.hoisted(() => ({ trackSearchUsed: vi.fn() }));
vi.mock('@/src/lib/analytics', () => ({ trackSearchUsed: analytics.trackSearchUsed }));

import { SearchMini } from '../DataTable';

// A tiny controlled wrapper so re-renders (value changes) behave like a real page's
// `useState` + `onChange={(e) => setSearch(e.target.value)}` — SearchMini itself is
// a pure controlled input (crud-components §2.3 pattern), so it needs a live `value`
// prop that actually changes for the debounce effect to observe anything.
const Controlled: React.FC<{
  initial?: string;
  searchSurface?: string;
  module?: string;
  resultCount?: number;
}> = ({ initial = '', searchSurface, module, resultCount }) => {
  const [value, setValue] = React.useState(initial);
  return (
    <SearchMini
      aria-label="Search companies"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      searchSurface={searchSurface}
      module={module}
      resultCount={resultCount}
    />
  );
};

describe('SearchMini: search_used analytics (2026-07-13 wiring plan, debounced — never per keystroke)', () => {
  beforeEach(() => {
    analytics.trackSearchUsed.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces a burst of keystrokes into ONE fire, only once idle for 500ms', async () => {
    const { fireEvent } = await import('@testing-library/react');
    render(<Controlled searchSurface="companies-list" module="companies" resultCount={3} />);
    const input = screen.getByLabelText('Search companies') as HTMLInputElement;

    // 3 keystrokes, each within the 500ms idle window of the previous one — every
    // change restarts the debounce, so nothing should fire mid-burst.
    fireEvent.change(input, { target: { value: 'a' } });
    vi.advanceTimersByTime(200);
    fireEvent.change(input, { target: { value: 'ac' } });
    vi.advanceTimersByTime(200);
    fireEvent.change(input, { target: { value: 'acm' } });
    expect(analytics.trackSearchUsed).not.toHaveBeenCalled();

    // Now idle for the full 500ms — exactly one fire, for the FINAL value's context.
    vi.advanceTimersByTime(500);
    expect(analytics.trackSearchUsed).toHaveBeenCalledTimes(1);
    expect(analytics.trackSearchUsed).toHaveBeenCalledWith('companies-list', 3, 'companies');
  });

  it('never sends the raw query text — only surface, result_count, and module', async () => {
    const { fireEvent } = await import('@testing-library/react');
    render(<Controlled searchSurface="companies-list" module="companies" resultCount={2} />);
    const input = screen.getByLabelText('Search companies') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'acme corp' } });
    vi.advanceTimersByTime(500);

    expect(analytics.trackSearchUsed).toHaveBeenCalledTimes(1);
    expect(analytics.trackSearchUsed).toHaveBeenCalledWith('companies-list', 2, 'companies');
    const call = analytics.trackSearchUsed.mock.calls[0];
    expect(JSON.stringify(call)).not.toMatch(/acme/i);
  });

  it('does not fire on an empty/cleared search', async () => {
    const { fireEvent } = await import('@testing-library/react');
    render(<Controlled searchSurface="companies-list" module="companies" resultCount={0} />);
    const input = screen.getByLabelText('Search companies') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '   ' } });
    vi.advanceTimersByTime(600);
    expect(analytics.trackSearchUsed).not.toHaveBeenCalled();
  });

  it('does not fire when searchSurface/module are omitted (opt-in tracking)', async () => {
    const { fireEvent } = await import('@testing-library/react');
    render(<Controlled resultCount={2} />);
    const input = screen.getByLabelText('Search companies') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'acme' } });
    vi.advanceTimersByTime(600);
    expect(analytics.trackSearchUsed).not.toHaveBeenCalled();
  });

  it('Enter fires immediately (no 500ms wait) and does not double-fire once the debounce would have elapsed', async () => {
    const { fireEvent } = await import('@testing-library/react');
    render(<Controlled searchSurface="companies-list" module="companies" resultCount={1} />);
    const input = screen.getByLabelText('Search companies') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'acme' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(analytics.trackSearchUsed).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(600);
    // Still just the one Enter-triggered fire — the pending debounce was cancelled.
    expect(analytics.trackSearchUsed).toHaveBeenCalledTimes(1);
  });
});
