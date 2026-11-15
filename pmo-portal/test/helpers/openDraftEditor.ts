import { fireEvent, screen } from '@testing-library/react';

const MENU = /^(Draft actions|Tindakan draf)$/;
const EDIT = /^(Edit draft|Ubah draf)$/;

/**
 * Opens the draft's line editor the way a user does since design-1115: the draft panel's "Draft
 * actions" menu, then "Edit draft". Returns false when the panel offers no such menu (no write access).
 */
export function openDraftEditor(): boolean {
  const trigger = screen.queryByRole('button', { name: MENU });
  if (!trigger) return false;
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('menuitem', { name: EDIT }));
  return true;
}

/** The same journey, awaiting the menu for suites that drive the page with userEvent. */
export async function openDraftEditorAsync(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: MENU }));
  fireEvent.click(await screen.findByRole('menuitem', { name: EDIT }));
}
