import { screen, waitFor } from '@testing-library/react';
import { expect } from 'vitest';

/** Find a page-level live announcement while excluding ToastProvider's persistent empty regions. */
export function getPageAnnouncement(role: 'alert' | 'status', message: RegExp): HTMLElement {
  const matches = screen.getAllByRole(role).filter(
    (region) => region.getAttribute('aria-atomic') !== 'true' && message.test(region.textContent ?? ''),
  );
  expect(matches, `expected exactly one page role="${role}" announcement matching ${String(message)}`).toHaveLength(1);
  return matches[0];
}

export async function findPageAnnouncement(role: 'alert' | 'status', message: RegExp): Promise<HTMLElement> {
  let match!: HTMLElement;
  await waitFor(() => { match = getPageAnnouncement(role, message); });
  return match;
}

export function queryPageAnnouncement(role: 'alert' | 'status', message: RegExp): HTMLElement | null {
  const matches = screen.getAllByRole(role).filter(
    (region) => region.getAttribute('aria-atomic') !== 'true' && message.test(region.textContent ?? ''),
  );
  expect(matches, `expected no page role="${role}" announcement matching ${String(message)}`).toHaveLength(0);
  return null;
}
