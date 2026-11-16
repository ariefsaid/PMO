import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/** Choose an option from one of the app's pickers (a filter bar's Combobox) the way a person does: open it, click the option. */
export async function pickOption(picker: string | RegExp, option: string | RegExp): Promise<void> {
  await userEvent.click(screen.getByRole('combobox', { name: picker }));
  await userEvent.click(await screen.findByRole('option', { name: option }));
}
