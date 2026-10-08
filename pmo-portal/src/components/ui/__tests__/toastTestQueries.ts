import { screen, waitFor } from '@testing-library/react';
import { expect } from 'vitest';

/** Resolve an announcement by its existing message oracle, without matching the aria-hidden visual copy. */
export function getToastAnnouncement(role: 'alert' | 'status', message: RegExp | string): HTMLElement {
  const matches = screen.getAllByRole(role).filter((region) => {
    if (region.getAttribute('aria-atomic') !== 'true') return false;
    const text = region.textContent ?? '';
    return typeof message === 'string' ? text.includes(message) : message.test(text);
  });
  expect(matches, `expected exactly one role="${role}" toast announcement matching ${String(message)}`).toHaveLength(1);
  return matches[0];
}

export async function findToastAnnouncement(role: 'alert' | 'status', message: RegExp | string): Promise<HTMLElement> {
  let match!: HTMLElement;
  await waitFor(() => { match = getToastAnnouncement(role, message); });
  return match;
}

export function queryToastAnnouncement(role: 'alert' | 'status', message: RegExp | string): HTMLElement | null {
  const matches = screen.getAllByRole(role).filter((region) => {
    if (region.getAttribute('aria-atomic') !== 'true') return false;
    const text = region.textContent ?? '';
    return typeof message === 'string' ? text.includes(message) : message.test(text);
  });
  expect(matches, `expected at most one role="${role}" toast announcement matching ${String(message)}`).toHaveLength(0);
  return null;
}
