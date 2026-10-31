import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';

const h = vi.hoisted(() => ({
  enabled: true,
  live: true,
  mutating: 0,
  createdAt: '2026-09-01T00:00:00Z',
  ids: { firstFlow: 'sid-flow', nps: 'sid-nps' } as Record<string, string | null>,
  canShow: true,
  show: vi.fn(),
  flowCb: null as null | (() => void),
}));
vi.mock('@/src/hooks/useFeedbackSurveys', () => ({ useFeedbackSurveysEnabled: () => h.enabled }));
vi.mock('@/src/hooks/useSurveyId', () => ({ useSurveyId: (k: string) => h.ids[k] ?? null }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { created_at: h.createdAt } }) }));
vi.mock('@tanstack/react-query', async (orig) => ({ ...(await orig<typeof import('@tanstack/react-query')>()), useIsMutating: () => h.mutating }));
vi.mock('@/src/lib/analytics', () => ({
  surveysLive: () => h.live,
  canShowSurvey: () => h.canShow,
  showSurvey: (...a: unknown[]) => h.show(...a),
  buildSurveyContext: (p: string) => ({ module: 'projects', route: p }),
  onCoreFlowCompleted: (cb: () => void) => {
    h.flowCb = cb;
    return () => {};
  },
}));

import { SurveyHost } from './SurveyHost';

const NOW = new Date('2026-11-10T10:00:00Z');
const seedActive = () => localStorage.setItem('pmo.activeDays', JSON.stringify(['2026-11-02', '2026-11-05', '2026-11-08']));
const tree = (path: string) => (
  <MemoryRouter initialEntries={[path]}>
    <SurveyHost />
  </MemoryRouter>
);
const mount = (path = '/projects') => render(tree(path));
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  localStorage.clear();
  document.body.innerHTML = '';
  Object.assign(h, { enabled: true, live: true, mutating: 0, createdAt: '2026-09-01T00:00:00Z', canShow: true, flowCb: null });
  h.ids = { firstFlow: 'sid-flow', nps: 'sid-nps' };
  h.show = vi.fn();
  seedActive();
});
afterEach(() => vi.useRealTimers());

describe('AC-PHO-096 NPS for active users', () => {
  it('appears once, after a minute, for an active user past their first week at a calm moment', () => {
    mount();
    wait(30_000);
    expect(h.show).not.toHaveBeenCalled();
    wait(40_000);
    expect(h.show).toHaveBeenCalledTimes(1);
    expect(h.show).toHaveBeenCalledWith('sid-nps', { module: 'projects', route: '/projects' });
    wait(300_000);
    expect(h.show).toHaveBeenCalledTimes(1); // one survey per session, whatever else is eligible
  });

  it.each([
    ['in the user\'s first week', () => (h.createdAt = '2026-11-05T00:00:00Z')],
    ['account age unknown', () => (h.createdAt = '')],
    ['the org Admin switched surveys off', () => (h.enabled = false)],
    ['analytics is not live (opted out / DNT)', () => (h.live = false)],
    ['PostHog says not eligible (wait period / already seen)', () => (h.canShow = false)],
    ['the survey is not published', () => (h.ids.nps = null)],
    ['the user is not active', () => localStorage.setItem('pmo.activeDays', '[]')],
  ])('never when %s', (_n, arrange) => {
    arrange();
    mount();
    wait(600_000);
    expect(h.show).not.toHaveBeenCalled();
  });
});

describe('AC-PHO-096 never interrupts a write or a form', () => {
  const blocked: Array<[string, () => void, string?]> = [
    ['a dialog is open', () => document.body.insertAdjacentHTML('beforeend', '<div role="dialog"></div>')],
    ['a field has focus', () => {
      document.body.insertAdjacentHTML('beforeend', '<input id="f" />');
      (document.getElementById('f') as HTMLInputElement).focus();
    }],
    ['a save is in flight', () => (h.mutating = 1)],
  ];
  it.each(blocked)('waits while %s, then shows once it clears', (_n, arrange) => {
    arrange();
    const { rerender } = mount();
    wait(120_000);
    expect(h.show).not.toHaveBeenCalled();
    document.body.querySelectorAll('[role="dialog"],#f').forEach((n) => n.remove());
    h.mutating = 0;
    rerender(tree('/projects'));
    wait(6_000);
    expect(h.show).toHaveBeenCalledTimes(1);
  });

  it('never on a create or edit route', () => {
    mount('/procurement/new');
    wait(600_000);
    expect(h.show).not.toHaveBeenCalled();
  });

  it('waits for three quiet seconds after the last key or click', () => {
    mount();
    wait(59_000);
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' })));
    wait(2_000);
    expect(h.show).not.toHaveBeenCalled();
    wait(4_000);
    expect(h.show).toHaveBeenCalledTimes(1);
  });
});

describe('AC-PHO-096 first core flow', () => {
  it('asks the 1-5 question after a business event, ahead of NPS, at the next calm moment', () => {
    mount();
    wait(5_000);
    act(() => h.flowCb?.());
    wait(6_000);
    expect(h.show).toHaveBeenCalledTimes(1);
    expect(h.show).toHaveBeenCalledWith('sid-flow', { module: 'projects', route: '/projects' });
    wait(300_000);
    expect(h.show).toHaveBeenCalledTimes(1);
  });

  it('holds the question while the form that just saved is still open', () => {
    mount();
    document.body.insertAdjacentHTML('beforeend', '<div role="dialog"></div>');
    act(() => h.flowCb?.());
    wait(30_000);
    expect(h.show).not.toHaveBeenCalled();
    document.body.innerHTML = '';
    wait(6_000);
    expect(h.show).toHaveBeenCalledWith('sid-flow', expect.any(Object));
  });

  it('is not asked in the user\'s first week, even right after a business event', () => {
    h.createdAt = '2026-11-08T00:00:00Z';
    mount();
    act(() => h.flowCb?.());
    wait(60_000);
    expect(h.show).not.toHaveBeenCalled();
  });
});
