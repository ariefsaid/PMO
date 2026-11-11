import { beforeEach } from 'vitest';
import type { HomeLayout } from '@/src/hooks/useHomeLayout';

/** Pin the per-device home layout for every test in the calling file (a home test describes one arrangement). */
export function pinHomeLayout(layout: HomeLayout) {
  beforeEach(() => localStorage.setItem('home-layout', layout));
}

/** Open the page's "N figures hidden · Why" reasons and return them (the reasons and the fix link live in the popover). */
export async function openHiddenReasons() {
  const { screen, within } = await import('@testing-library/react');
  const { default: userEvent } = await import('@testing-library/user-event');
  await userEvent.click(within(screen.getByTestId('figures-hidden')).getByRole('button', { name: 'Why' }));
}
