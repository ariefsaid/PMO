import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type React from 'react';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { i18n as I18nInstance } from 'i18next';

const coldI18n = vi.hoisted(() => ({
  instance: null as unknown,
  initialized: false,
  pending: null as Promise<void> | null,
  resolvePending: null as (() => void) | null,
}));

// Model react-i18next's cold-start suspension directly. The real instance and init options below
// stay cold until the provider effect commits, so this test isolates route boundary behavior from
// react-i18next's pre-init context snapshot details in jsdom.
vi.mock('react-i18next', async (importOriginal) => {
  const React = await import('react');
  const actual = await importOriginal<typeof import('react-i18next')>();
  const useTranslation = (namespaces?: string | readonly string[]) => {
    const requested = Array.isArray(namespaces) ? namespaces : namespaces ? [namespaces] : [];
    if (!coldI18n.initialized && requested.some((namespace) => namespace === 'auth' || namespace === 'legal')) {
      if (!coldI18n.pending) throw new Error('cold i18n promise was not installed');
      throw coldI18n.pending;
    }
    return {
      t: (key: string, defaultValue?: unknown) => typeof defaultValue === 'string' ? defaultValue : key,
      i18n: { language: 'en' },
      ready: coldI18n.initialized,
    };
  };
  const Trans: React.FC<{ defaults?: React.ReactNode; children?: React.ReactNode }> = ({ defaults, children }) =>
    React.createElement(React.Fragment, null, defaults ?? children ?? null);
  return { ...actual, useTranslation, Trans };
});

// Keep the app's provider lifecycle, but give it a genuinely cold i18n instance. The route's
// useTranslation call suspends during the first render; the provider can initialize only after a
// Suspense boundary lets that first tree commit.
vi.mock('@/src/lib/i18n/I18nProvider', async () => {
  const React = await import('react');
  const { i18nInitOptions } = await import('@/src/lib/i18n');

  const TestI18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const instance = coldI18n.instance as I18nInstance | null;

    React.useEffect(() => {
      if (!instance) throw new Error('cold i18n instance was not installed');
      void instance.init({
        ...i18nInitOptions('en', instance),
        resources: { en: { common: {}, auth: {}, legal: {} } },
        initImmediate: false,
      }).then(() => {
        coldI18n.initialized = true;
        coldI18n.resolvePending?.();
      });
    }, [instance]);

    if (!instance) throw new Error('cold i18n instance was not installed');
    return React.createElement(React.Fragment, null, children);
  };

  return { I18nProvider: TestI18nProvider };
});

vi.mock('@/src/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signInWithPassword: vi.fn(),
      signInWithOtp: vi.fn(),
      signInWithOAuth: vi.fn(),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    from: vi.fn(() => ({ select: () => ({ eq: () => ({ single: vi.fn().mockResolvedValue({ data: null, error: null }) }) }) })),
  },
}));

import App from './App';

beforeEach(() => {
  coldI18n.initialized = false;
  coldI18n.pending = new Promise<void>((resolve) => {
    coldI18n.resolvePending = resolve;
  });
  coldI18n.instance = i18next.createInstance().use(initReactI18next);
});

afterEach(() => {
  cleanup();
  window.history.pushState({}, '', '/');
});

describe('cold public routes', () => {
  it('renders the sign-in form at /login while i18n is not initialized', async () => {
    const instance = coldI18n.instance as I18nInstance;
    expect(instance.isInitialized).toBeFalsy();
    window.history.pushState({}, '', '/login');

    render(<App />);

    expect(await screen.findByRole('textbox', { name: /^email$/i })).toBeVisible();
    expect(screen.getByLabelText(/password/i)).toBeVisible();
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeVisible();
    expect(instance.isInitialized).toBe(true);
  });

  it('renders the terms page at /terms while i18n is not initialized', async () => {
    const instance = coldI18n.instance as I18nInstance;
    expect(instance.isInitialized).toBeFalsy();
    window.history.pushState({}, '', '/terms');

    render(<App />);

    expect(await screen.findByRole('heading', { level: 1, name: /terms of service/i })).toBeVisible();
    expect(instance.isInitialized).toBe(true);
  });
});
