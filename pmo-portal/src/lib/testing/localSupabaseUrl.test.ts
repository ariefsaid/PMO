import { describe, expect, it } from 'vitest';
import { requireLocalSupabaseUrl, requireMatchingLocalSupabaseUrls } from './localSupabaseUrl';

describe('Supabase E2E URL guards', () => {
  describe('requireLocalSupabaseUrl', () => {
    it('accepts the local Supabase loopback origins', () => {
      expect(requireLocalSupabaseUrl(undefined)).toBe('http://127.0.0.1:54321');
      expect(requireLocalSupabaseUrl('http://localhost:54321/')).toBe('http://localhost:54321');
      expect(requireLocalSupabaseUrl('http://[::1]:54321')).toBe('http://[::1]:54321');
    });

    it('rejects hosted or non-local admin targets', () => {
      for (const url of [
        'https://example.supabase.co',
        'http://supabase.internal:54321',
        'http://localhost:54322',
        'https://127.0.0.1:54321',
        'not-a-url',
      ]) {
        expect(() => requireLocalSupabaseUrl(url)).toThrow('destructive fixture setup requires a local Supabase URL');
      }
    });

    it('rejects local URLs with a path or credentials', () => {
      expect(() => requireLocalSupabaseUrl('http://127.0.0.1:54321/rest/v1')).toThrow('destructive fixture setup requires a local Supabase URL');
      expect(() => requireLocalSupabaseUrl('http://admin:secret@127.0.0.1:54321')).toThrow('destructive fixture setup requires a local Supabase URL');
    });
  });

  describe('requireMatchingLocalSupabaseUrls', () => {
    it('returns the approved origin when admin and browser targets match', () => {
      expect(
        requireMatchingLocalSupabaseUrls('http://127.0.0.1:54321/', 'http://127.0.0.1:54321'),
      ).toBe('http://127.0.0.1:54321');
    });

    it('rejects split local admin and browser targets', () => {
      expect(() =>
        requireMatchingLocalSupabaseUrls('http://127.0.0.1:54321', 'http://localhost:54321'),
      ).toThrow('destructive fixture setup requires the same local Supabase URL for admin and browser');
    });
  });
});
