import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { makeTestQueryClient } from './testQueryClient';

/** The provider half of renderWithQueryClient, for suites that build their own wrapper stack (C11: the add-ons mount on their host screens). */
export function QueryClientTestProvider({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={makeTestQueryClient()}>{children}</QueryClientProvider>;
}
