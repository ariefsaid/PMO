import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readPreSessionLocale, setPreSessionLocale } from './preSessionLocale';

const browser = (languages: string[]) => vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(languages);

describe('pre-session locale (JOB-NAV-LOGIN-LANG)', () => {
  beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

  it('follows a Bahasa Indonesia browser', () => { browser(['id-ID', 'en']); expect(readPreSessionLocale()).toBe('id'); });
  it('follows an English browser', () => { browser(['en-US']); expect(readPreSessionLocale()).toBe('en'); });
  it('any other browser language reads as English', () => { browser(['fr-FR']); expect(readPreSessionLocale()).toBe('en'); });
  it('remembers an explicit choice over the browser language', () => {
    browser(['id-ID']);
    setPreSessionLocale('en');
    expect(readPreSessionLocale()).toBe('en');
  });
  it('ignores a stored value it does not recognise', () => {
    browser(['id-ID']);
    localStorage.setItem('login.language', 'xx');
    expect(readPreSessionLocale()).toBe('id');
  });
});
