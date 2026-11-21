/** AC-LA-012 (#2710) — the seat report splits full and light. */
import React from 'react';
import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/src/lib/repositories/myHome', () => ({ myHomeRepository: { seatReport: vi.fn().mockResolvedValue({ full: 4, light: 2, total: 6 }) } }));
import { SeatReport } from './SeatReport';

it('AC-LA-012 shows full, light and total seats', async () => {
  render(<QueryClientProvider client={new QueryClient()}><SeatReport /></QueryClientProvider>);
  const box = await screen.findByTestId('seat-report');
  expect(box).toHaveTextContent('Full accounts4');
  expect(box).toHaveTextContent('Light accounts (Foreman, Field user)2');
  expect(box).toHaveTextContent('Active seats6');
});
