import { QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { AuthContext } from '@/src/auth/AuthContext';
import { makeTestQueryClient } from './testQueryClient';
import { signedOutAuth } from './signedOutTestAuth';

/** Render a route-level test with neutral auth and React Query contexts for mounted page hooks. */
export function renderWithQueryClient(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  const client = makeTestQueryClient();
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <AuthContext.Provider value={signedOutAuth()}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </AuthContext.Provider>
  );
  return render(ui, { ...options, wrapper: Wrapper });
}
