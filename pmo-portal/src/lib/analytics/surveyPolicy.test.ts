import { describe, it, expect } from 'vitest';
import {
  FIRST_WEEK_MS,
  QUIET_MS,
  isActiveUser,
  isPastFirstWeek,
  momentRefusal,
  recordActiveDay,
  type Moment,
} from './surveyPolicy';

const NOW = Date.parse('2026-11-10T10:00:00Z');
const calm: Moment = {
  now: NOW,
  lastInteractionAt: NOW - QUIET_MS - 1,
  openDialogs: 0,
  editableFocused: false,
  mutationsInFlight: 0,
  pathname: '/projects',
};

describe('AC-PHO-092 first week', () => {
  it('is false inside the first seven days and true after', () => {
    expect(isPastFirstWeek(new Date(NOW - FIRST_WEEK_MS + 1000).toISOString(), NOW)).toBe(false);
    expect(isPastFirstWeek(new Date(NOW - FIRST_WEEK_MS - 1000).toISOString(), NOW)).toBe(true);
  });
  it('fails closed when the account age is unknown or unparseable', () => {
    expect(isPastFirstWeek(undefined, NOW)).toBe(false);
    expect(isPastFirstWeek('', NOW)).toBe(false);
    expect(isPastFirstWeek('not a date', NOW)).toBe(false);
  });
});

describe('AC-PHO-092 safe moment: never interrupt a write or a form', () => {
  it('a calm moment on a list page is safe', () => {
    expect(momentRefusal(calm)).toBeNull();
  });
  it.each<[string, Partial<Moment>, string]>([
    ['an open dialog', { openDialogs: 1 }, 'dialog'],
    ['a focused field', { editableFocused: true }, 'field'],
    ['a write in flight', { mutationsInFlight: 1 }, 'write'],
    ['the user just touched something', { lastInteractionAt: NOW - QUIET_MS + 1 }, 'busy'],
    ['a create route', { pathname: '/procurement/new' }, 'form-route'],
    ['an edit route', { pathname: '/views/abc/edit' }, 'form-route'],
    ['an import route', { pathname: '/projects/import' }, 'form-route'],
  ])('refuses on %s', (_n, patch, reason) => {
    expect(momentRefusal({ ...calm, ...patch })).toBe(reason);
  });
  it('a detail page whose id merely contains "new" is not a form route', () => {
    expect(momentRefusal({ ...calm, pathname: '/projects/renewal-9' })).toBeNull();
  });
});

describe('AC-PHO-092 active user: three distinct days in the last fourteen', () => {
  it('records each day once, keeps fourteen days, and ignores junk storage', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    store.set('pmo.activeDays', 'garbage{');
    recordActiveDay(storage, '2026-11-01');
    recordActiveDay(storage, '2026-11-01');
    expect(JSON.parse(store.get('pmo.activeDays')!)).toEqual(['2026-11-01']);
    for (let d = 2; d <= 20; d++) recordActiveDay(storage, `2026-11-${String(d).padStart(2, '0')}`);
    expect(JSON.parse(store.get('pmo.activeDays')!)).toHaveLength(14);
  });
  it('needs three days inside the window', () => {
    expect(isActiveUser(['2026-11-01', '2026-11-05'], '2026-11-10')).toBe(false);
    expect(isActiveUser(['2026-11-01', '2026-11-05', '2026-11-09'], '2026-11-10')).toBe(true);
    expect(isActiveUser(['2026-10-01', '2026-10-02', '2026-10-03'], '2026-11-10')).toBe(false);
  });
});
