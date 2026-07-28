// @e2e-isolation: self-isolated — read-only keyboard journey; opens the Contacts create modal,
// fills it via the keyboard and discards it without saving. No seed mutation, no cross-spec data.
import { test, expect, type Page } from '@playwright/test';
import { signIn } from './helpers';

/**
 * AC-A11Y-FORM-002 — a keyboard-only user can reach Save from the first field of a form
 * whose first TWO fields are required (WCAG 2.1.2, No Keyboard Trap).
 *
 * Graduated from the 2026-07-28 rendered Discover pass. Contacts is the case that was
 * UNESCAPABLE before the fix: `useEntityForm` surfaces a required-field error on BLUR, and
 * EntityFormModal moved focus to the first invalid field whenever a summary appeared — so
 * Tab out of "Full name" bounced straight back, and the next field ("Company") did the same.
 * A keyboard-only user could never reach Cancel or Create contact.
 *
 * Goal oracle: using ONLY the keyboard, the user escapes both empty required fields, fills
 * them, and arrives on an ENABLED "Create contact" — never bounced back to a field they left.
 */

test.setTimeout(120_000);

/** The id of the currently focused element ('' when focus is on <body> or an id-less control). */
const activeId = (page: Page) => page.evaluate(() => document.activeElement?.id ?? '');

/** Tag + trimmed text of the focused element, for a legible trace on failure. */
const activeLabel = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return '(none)';
    return `${el.tagName}${el.id ? '#' + el.id : ''}:${(el.textContent ?? '').trim().slice(0, 24)}`;
  });

const onSubmitButton = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return el?.tagName === 'BUTTON' && el.textContent?.trim() === 'Create contact';
  });

test(
  'AC-A11Y-FORM-002: a keyboard-only user tabs from the first required field to Save on Contacts — goal oracle: both empty required fields are escapable and focus arrives on an enabled Create contact',
  async ({ page }) => {
    await signIn(page, 'admin@acme.test');
    await page.goto('/contacts');
    await expect(page.getByTestId('liststate-loading')).not.toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: /New contact/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // The modal moves focus to the first form field on open.
    await expect.poll(() => activeId(page)).toBe('contact-form-full_name');

    // ── 1. The two consecutive EMPTY required fields are escapable ───────────
    // Tab out of the empty required name field: focus must move on, not bounce back.
    await page.keyboard.press('Tab');
    await expect.poll(() => activeId(page)).toBe('contact-form-company_id');
    // …and out of the second one too (this pair is what made the form unescapable).
    await page.keyboard.press('Tab');
    await expect.poll(() => activeId(page)).toBe('contact-form-title');

    // ── 2. Back to the top by keyboard, and fill the form by keyboard ───────
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Shift+Tab');
    await expect.poll(() => activeId(page)).toBe('contact-form-full_name');

    await page.keyboard.type('E2E Keyboard Contact');
    await page.keyboard.press('Tab');
    await expect.poll(() => activeId(page)).toBe('contact-form-company_id');
    // Pick a company. `selectOption` (not ArrowDown) because a native <select> on macOS/
    // headless Chromium opens a native popup ArrowDown cannot drive — and this journey's
    // oracle is the FOCUS ORDER, not the platform's select widget: focus stays on the select.
    await page.getByLabel(/^Company/).selectOption({ index: 1 });
    await expect(page.getByLabel(/^Company/)).not.toHaveValue('');
    await expect.poll(() => activeId(page)).toBe('contact-form-company_id');

    // ── 3. Tab forward to the submit, which is now ENABLED ──────────────────
    const trace: string[] = [];
    let reachedSubmit = false;
    for (let i = 0; i < 20 && !reachedSubmit; i += 1) {
      await page.keyboard.press('Tab');
      reachedSubmit = await onSubmitButton(page);
      trace.push(await activeLabel(page));
    }
    expect(reachedSubmit, `focus never reached "Create contact"; it visited: ${trace.join(' → ')}`)
      .toBe(true);
    await expect(page.getByRole('button', { name: 'Create contact' })).toBeEnabled();

    // Focus never bounced BACK into the required pair on the way out (the trap's signature).
    expect(trace.filter((t) => t.includes('contact-form-full_name'))).toEqual([]);
    expect(trace.filter((t) => t.includes('contact-form-company_id'))).toEqual([]);

    // Leave the app as we found it — nothing was saved.
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /^Discard$/ }).click();
    await expect(dialog).not.toBeVisible();
  },
);
