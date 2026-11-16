import { screen, waitFor } from '@testing-library/react';
import { expect } from 'vitest';
import type { UserEvent } from '@testing-library/user-event';

/** The calendar button that sits beside a DateField's input. */
export const calendarButton = (field: HTMLElement) =>
  field.parentElement!.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!;

const dayButtons = () => [...document.querySelectorAll<HTMLButtonElement>('button[data-day]')];
// A bound is visible once a day the person cannot pick sits beyond the last (or before the first) day they can.
const disabledAfterLastPickable = () => {
  const days = dayButtons();
  const last = days.map((b) => b.disabled).lastIndexOf(false);
  return last >= 0 && days.slice(last + 1).some((b) => b.disabled);
};
const disabledBeforeFirstPickable = () => {
  const days = dayButtons();
  const first = days.findIndex((b) => !b.disabled);
  return first > 0;
};

/**
 * Open a DateField's calendar, page forward until the days after the last one they can pick are disabled,
 * and return the last day they can. Closes the calendar again. `null` when nothing is pickable.
 */
export async function latestPickableDay(user: UserEvent, field: HTMLElement): Promise<string | null> {
  await user.click(calendarButton(field));
  await waitFor(() => expect(document.querySelector('[data-slot="popover-content"]')).not.toBeNull());
  for (let i = 0; i < 48 && !disabledAfterLastPickable(); i += 1) {
    await user.click(screen.getByRole('button', { name: /next month/i }));
  }
  const pickable = dayButtons().filter((b) => !b.disabled);
  await user.keyboard('{Escape}');
  return pickable.length ? pickable[pickable.length - 1].dataset.day ?? null : null;
}

/** The mirror of `latestPickableDay`: page back until the days before the first one they can pick are disabled, return that first day. */
export async function earliestPickableDay(user: UserEvent, field: HTMLElement): Promise<string | null> {
  await user.click(calendarButton(field));
  await waitFor(() => expect(document.querySelector('[data-slot="popover-content"]')).not.toBeNull());
  for (let i = 0; i < 48 && !disabledBeforeFirstPickable(); i += 1) {
    await user.click(screen.getByRole('button', { name: /previous month/i }));
  }
  const pickable = dayButtons().filter((b) => !b.disabled);
  await user.keyboard('{Escape}');
  return pickable.length ? pickable[0].dataset.day ?? null : null;
}
