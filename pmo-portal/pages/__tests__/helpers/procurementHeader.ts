// Shared journey steps for the restructured procurement record header (#1404).
// The header carries ONE primary lifecycle action plus a "More procurement actions" menu (Edit details,
// Return/Reject, Cancel procurement, Export, Full history). The phone-only fixed bar repeats the primary
// action and shares the menu state, so these helpers scope to `record-header-actions` to stay unambiguous.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

export const headerActions = () => within(screen.getByTestId('record-header-actions'));

/** Opens the header's "More procurement actions" menu and returns queries spanning the header and portaled menu. */
export async function openMoreActions() {
  const header = headerActions();
  await userEvent.click(header.getByRole('button', { name: /more procurement actions/i }));
  await screen.findByRole('menu', { name: /more procurement actions/i });
  return within(document.body);
}

/** Opens "Record another document" in the header and picks a document kind (e.g. 'Receipt', 'Supplier invoice'). */
export async function recordFromMenu(name: string) {
  const header = headerActions();
  await userEvent.click(header.getByRole('button', { name: 'Record another document' }));
  await userEvent.click(await screen.findByRole('menuitem', { name }));
}
