import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { LanguageSwitch } from './authFormPrimitives';
import { readPreSessionLocale } from '../lib/locale/preSessionLocale';

const session = vi.hoisted(() => ({ user: null as null | { locale: string | null } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: session.user }) }));
import { useResolvedLocale } from '@/src/hooks/useResolvedLocale';

beforeEach(() => { localStorage.clear(); session.user = null; vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['id-ID']); });

describe('JOB-NAV-LOGIN-LANG: the sign-in page speaks the reader\'s language', () => {
  it('starts in the browser language, shows the switch with the current one pressed, and remembers a tap', async () => {
    render(<LanguageSwitch />);
    expect(screen.getByRole('button', { name: 'Bahasa Indonesia' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'English' }));
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true');
    expect(readPreSessionLocale()).toBe('en');
  });

  it('with no session the resolved locale is the pre-session choice; a signed-in profile wins over it', () => {
    const { result, rerender } = renderHook(() => useResolvedLocale(), { wrapper: ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider> });
    expect(result.current.locale).toBe('id');
    session.user = { locale: 'en' };
    rerender();
    expect(result.current.locale).toBe('en');
  });
});
