import { screen, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

/**
 * Drives the Projects filter builder (#1983) the way a person does: Add filter, pick the field, pick the
 * condition, pick the value(s), Apply when the value editor asks for it. `value` omitted = the condition
 * step only (a range field that then needs its own inputs).
 */
export async function addBuilderFilter(
  user: UserEvent, field: string | RegExp, opts: { operator?: string | RegExp; value?: string | RegExp | (string | RegExp)[] } = {},
) {
  await user.click(screen.getByRole('button', { name: /^add filter$/i }));
  await user.click(await screen.findByRole('option', { name: field }));
  await user.click(await screen.findByRole('option', { name: opts.operator ?? 'is' }));
  for (const v of [opts.value ?? []].flat()) {
    await user.click(await screen.findByRole('option', { name: v }));
  }
  const apply = screen.queryByRole('button', { name: /^apply$/i });
  if (apply) await user.click(apply);
}

/** The active chip for a field (the builder's toolbar group). */
export const builderChips = () => within(screen.getByRole('toolbar', { name: /active filters/i }));

export async function removeBuilderFilter(user: UserEvent, field: string) {
  const toolbar = screen.getByRole('toolbar', { name: /active filters/i });
  await user.click(within(toolbar).getByRole('button', { name: `${field} filter options` }));
  await user.click(await screen.findByRole('menuitem', { name: /^remove filter$/i }));
}
