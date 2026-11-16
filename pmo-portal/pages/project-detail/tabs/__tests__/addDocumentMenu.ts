/**
 * The register's one "Add document" control: with several ways to add it opens a menu, with one it
 * acts directly. Tests reach each way the way a person does: open the control, pick the way.
 */
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

type User = Pick<ReturnType<typeof userEvent.setup>, 'click' | 'keyboard'> | typeof userEvent;

/** The toolbar's Add document control, or null when this person may not add. */
export function addDocumentControl(): HTMLElement | null {
  const toolbar = screen.queryByTestId('documents-register-toolbar');
  return toolbar ? within(toolbar).queryByRole('button', { name: 'Add document' }) : null;
}

/** Open the control and pick one way to add (an exact menu label, e.g. "Link from Microsoft 365"). */
export async function chooseAddOption(user: User, option: string): Promise<void> {
  const control = addDocumentControl();
  if (!control) throw new Error('No Add document control is offered');
  await user.click(control);
  if (control.getAttribute('aria-haspopup')) {
    await user.click(await screen.findByRole('menuitem', { name: option }));
  }
}

/** The ways to add this person is offered (menu labels); closes the menu again. */
export async function addOptionLabels(user: User): Promise<string[]> {
  const control = addDocumentControl();
  if (!control) return [];
  if (!control.getAttribute('aria-haspopup')) return ['Upload a document'];
  await user.click(control);
  const menu = await screen.findByRole('menu');
  const labels = within(menu).getAllByRole('menuitem').map((item) => item.textContent?.trim() ?? '');
  await user.keyboard('{Escape}');
  return labels;
}
