// @e2e-isolation: read-only — signs in and measures; the profile read is rewritten in the browser only.
import { test, expect, type Page } from '@playwright/test';
import { signIn, waitForFonts } from './helpers';
import { overrideProfile, localePatch } from './support/profile-override';

/**
 * AC-SHELL-003 — at phone width (390) every label on the bottom bar is shown whole, in English and
 * in Bahasa: no ellipsis, no clipped letters. The measured line per label (text width / tab width)
 * is attached to the report.
 */
async function pinLocale(page: Page, locale: 'en' | 'id'): Promise<void> {
  await overrideProfile(page, localePatch(locale));
}

const ROLES: Array<[string, string]> = [
  ['pm@acme.test', 'Project Manager'],
  ['finance@acme.test', 'Finance'],
  ['engineer@acme.test', 'Engineer'],
  ['admin@acme.test', 'Admin'],
];

for (const locale of ['en', 'id'] as const) {
  for (const [email, role] of ROLES) {
    test(`AC-SHELL-003 ${role} bar labels whole at 390 (${locale})`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await pinLocale(page, locale);
      await signIn(page, email);
      await page.goto('/');
      const bar = page.getByTestId('phone-nav');
      await expect(bar).toBeVisible();
      await waitForFonts(page);
      const rows = await bar.evaluate((nav) =>
        Array.from(nav.querySelectorAll<HTMLElement>('a, button')).map((tab) => {
          const spans = tab.querySelectorAll<HTMLElement>('span');
          const label = spans[spans.length - 1];
          const range = document.createRange();
          range.selectNodeContents(label);
          const text = range.getBoundingClientRect();
          const tabBox = tab.getBoundingClientRect();
          const style = getComputedStyle(label);
          return {
            label: (label.textContent ?? '').trim(),
            textW: Math.round(text.width * 10) / 10,
            tabW: Math.round(tabBox.width * 10) / 10,
            clipped: label.scrollWidth > label.clientWidth + 0.5,
            ellipsis: style.textOverflow === 'ellipsis' && label.scrollWidth > label.clientWidth + 0.5,
            insideTab: text.left >= tabBox.left - 0.5 && text.right <= tabBox.right + 0.5,
            lines: Math.round(text.height / parseFloat(style.lineHeight)),
            font: `${style.fontSize}/${style.fontWeight}`,
          };
        }));
      const lines = rows.map((r) => `${locale} ${role} "${r.label}": text ${r.textW}px / tab ${r.tabW}px @${r.font} lines=${r.lines}`);
      await testInfo.attach('label-measurements', { body: lines.join('\n') });
      console.log(lines.join('\n'));
      for (const r of rows) {
        expect(r.clipped, `${r.label} clipped`).toBe(false);
        expect(r.ellipsis, `${r.label} ellipsis`).toBe(false);
        expect(r.insideTab, `${r.label} inside its tab`).toBe(true);
        expect(r.lines, `${r.label} on one line`).toBe(1);
      }
    });
  }
}
