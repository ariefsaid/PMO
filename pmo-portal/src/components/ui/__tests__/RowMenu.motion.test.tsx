/**
 * #2122 (motion slice M1) — a menu opened from the keyboard appears instantly instead of playing
 * the 120ms `menuPopIn` pop.
 *
 * Two halves make the rule: Base UI marks a keyboard-activated open with `data-instant` on the
 * popup (a keyboard / assistive-technology click arrives with `detail === 0`), and `index.css`
 * switches the `menu-pop-anim` animation off for `[data-instant]`. This suite binds the first half
 * (the attribute is really emitted by the shipped RowMenu) so a library upgrade that drops it turns
 * red here rather than silently re-animating keyboard opens. The CSS half is asserted in
 * `motion1970.test.tsx`.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RowMenu } from '../RowMenu';

const items = [{ label: 'Edit', onClick: () => undefined }];

/** Open the row-action menu with a synthetic click carrying the given `detail`. */
function openMenu(detail: number) {
  render(<RowMenu items={items} />);
  fireEvent.click(screen.getByRole('button', { name: /row actions/i }), { detail });
  return screen.getByRole('menu');
}

describe('#2122 RowMenu — keyboard opens appear instantly', () => {
  it('marks the popup data-instant when the trigger is activated from the keyboard (click detail 0)', () => {
    expect(openMenu(0)).toHaveAttribute('data-instant');
  });

  it('keeps the pop when a pointer opens the menu (click detail 1)', () => {
    expect(openMenu(1)).not.toHaveAttribute('data-instant');
  });
});
