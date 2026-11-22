import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { AuthContext } from '@/src/auth/AuthContext';
import { signedOutAuth } from './signedOutTestAuth';
import { makeTestQueryClient } from './testQueryClient';

/**
 * The provider half of renderWithQueryClient — neutral auth and React Query contexts — for suites that
 * build their own wrapper stack (C11: the add-ons mount on their host screens).
 */
export function QueryClientTestProvider({ children }: { children: ReactNode }) {
  return (
    <AuthContext.Provider value={signedOutAuth()}>
      <QueryClientProvider client={makeTestQueryClient()}>{children}</QueryClientProvider>
    </AuthContext.Provider>
  );
}
