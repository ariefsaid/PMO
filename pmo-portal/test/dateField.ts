import { screen, waitFor } from '@testing-library/react';
import { expect } from 'vitest';
import type { UserEvent } from '@testing-library/user-event';

/** The calendar button that sits beside a DateField's input. */
export const calendarButton = (field: HTMLElement) =>
  field.parentElement!.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!;

const dayButtons = () => [...document.querySelectorAll<HTMLButtonElement>('button[data-day]')];

/**
 * Open a DateField's calendar, page forward to the first month that shows a day a person cannot pick,
 * and return the last day they can. Closes the calendar again. `null` when nothing is pickable.
 */
export async function latestPickableDay(user: UserEvent, field: HTMLElement): Promise<string | null> {
  await user.click(calendarButton(field));
  await waitFor(() => expect(document.querySelector('[data-slot="popover-content"]')).not.toBeNull());
  for (let i = 0; i < 48 && !dayButtons().some((b) => b.disabled); i += 1) {
    await user.click(screen.getByRole('button', { name: /next month/i }));
  }
  const pickable = dayButtons().filter((b) => !b.disabled);
  await user.keyboard('{Escape}');
  return pickable.length ? pickable[pickable.length - 1].dataset.day ?? null : null;
}
