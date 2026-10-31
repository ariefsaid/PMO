// @e2e-isolation: read-only — layout measurements on a seeded route; no writes.
import { test, expect } from '@playwright/test';
import { signIn, waitForFonts } from '../helpers';
import { assertMinutesHandle, assertMinutesWithinViewport } from '../support/layout-oracles';
import { registerLayoutSweep } from '../support/layout-sweep';

registerLayoutSweep({ path: '/meetings/ee000000-0000-0000-0000-000000000001', label: 'meeting-detail', icons: false, integrations: false });

const SEEDED_MEETING = 'ee000000-0000-0000-0000-000000000001';

const headingCases = [
  { width: 390, scheme: 'light', title: '@layout AC-MTG-022: minutes content stays within the viewport at 390px in light theme / AC-MRT-001' },
  { width: 390, scheme: 'dark', title: '@layout AC-MTG-022: minutes content stays within the viewport at 390px in dark theme / AC-MRT-001' },
  { width: 360, scheme: 'light', title: '@layout AC-MTG-022: minutes content stays within the viewport at 360px in light theme / AC-MRT-001' },
  { width: 360, scheme: 'dark', title: '@layout AC-MTG-022: minutes content stays within the viewport at 360px in dark theme / AC-MRT-001' },
] as const;

for (const scenario of headingCases) {
  test(scenario.title, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error: Error) => pageErrors.push(error.message));
    await page.setViewportSize({ width: scenario.width, height: 800 });
    await page.addInitScript((theme) => localStorage.setItem('theme', theme), scenario.scheme);
    await signIn(page, 'pm@acme.test'); // the seeded author — sees the editable editor
    await page.goto(`/meetings/${SEEDED_MEETING}`);
    const editor = page.getByTestId('minutes-blocknote').locator('.bn-editor');
    await expect(editor).toBeVisible();
    await waitForFonts(page); // layout is measured below (#713)
    const blockContent = editor.locator('.bn-block-content');
    const originalBlocks = await blockContent.evaluateAll((elements) =>
      elements.map((element) => ({
        type: element.getAttribute('data-content-type') ?? '',
        text: element.textContent ?? '',
      })),
    );
    const insertedHeadings = ['Page title', 'Section heading', 'Subheading'];
    const longToken = `https://example.test/${'x'.repeat(140)}`;
    expect(originalBlocks.length, 'seeded minutes block count').toBeGreaterThan(0);
    expect(
      originalBlocks.some(
        ({ type, text }) => type === 'heading' && insertedHeadings.includes(text),
      ),
      'seeded minutes do not already contain the inserted headings',
    ).toBe(false);
    expect(
      originalBlocks.some(({ text }) => text.includes(longToken)),
      'seeded minutes do not already contain the long token',
    ).toBe(false);
    const save = page.getByTestId('minutes-save');
    await expect(save).toBeDisabled();

    const expectCompleteMinutes = async () => {
      await expect(editor).toContainText('Page title');
      await expect(editor).toContainText('Section heading');
      await expect(editor).toContainText('Subheading');
      await expect(editor).toContainText(longToken);

      const currentBlocks = await blockContent.evaluateAll((elements) =>
        elements.map((element) => ({
          type: element.getAttribute('data-content-type') ?? '',
          text: element.textContent ?? '',
        })),
      );
      const headingsToRemove = new Map(insertedHeadings.map((heading) => [heading, 1]));
      const retainedText = currentBlocks
        .filter(({ type, text }) => {
          if (type !== 'heading' || !headingsToRemove.has(text)) return true;
          const remaining = headingsToRemove.get(text)! - 1;
          if (remaining === 0) headingsToRemove.delete(text);
          else headingsToRemove.set(text, remaining);
          return false;
        })
        .map(({ text }) => text.replace(longToken, ''))
        .join('');
      const originalBlockOffsets: number[] = [];
      let originalCharacterCount = 0;
      for (const block of originalBlocks) {
        originalBlockOffsets.push(originalCharacterCount);
        originalCharacterCount += block.text.length;
      }
      const everyOriginalBlockIsRetained = originalBlocks.every((block, index) => {
        const offset = originalBlockOffsets[index];
        return retainedText.slice(offset, offset + block.text.length) === block.text;
      });
      const tokenOccurrences = currentBlocks.reduce(
        (count, { text }) => count + text.split(longToken).length - 1,
        0,
      );
      expect(
        {
          everyOriginalBlockIsRetained,
          originalCharacterCount,
          retainedCharacterCount: retainedText.length,
          insertedHeadingsRemaining: headingsToRemove.size,
          tokenOccurrences,
        },
        'AC-MRT-001 retains every original minutes block and the complete inserted content',
      ).toEqual({
        everyOriginalBlockIsRetained: true,
        originalCharacterCount,
        retainedCharacterCount: originalCharacterCount,
        insertedHeadingsRemaining: 0,
        tokenOccurrences: 1,
      });
      await expect(save).toBeEnabled();
    };

    // BlockNote's markdown input rules: "# " / "## " / "### " at the start of an empty block.
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('# Page title');
    await page.keyboard.press('Enter');
    await page.keyboard.type('## Section heading');
    await page.keyboard.press('Enter');
    await page.keyboard.type('### Subheading');
    await page.keyboard.press('Enter');
    // A 160-char unbroken string — the class that bled at 375px in the spike.
    await page.keyboard.type(longToken);
    await expectCompleteMinutes();

    await assertMinutesWithinViewport(page, scenario.scheme);
    expect(pageErrors, 'AC-MRT-001 unhandled page errors').toEqual([]);
    if (scenario.width === 390 && scenario.scheme === 'light') await assertMinutesHandle(page, scenario.width);
  });
}

/**
 * The add-block "+" / drag handle (BlockNote's side menu, 52px wide) is placed to the LEFT of a block, outside
 * the editor's own box: it used to cross the sidebar edge on desktop and sit at x<0 on a phone. The editor now
 * reserves its own inline-start room for it (>=640px) and does not offer the hover-only menu below that.
 * Measured on the rendered boxes — the a11y tree cannot see a clipped handle.
 */
test('@layout AC-MTG-022: the add-block handle stays inside the minutes content area at 1280px', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, 'pm@acme.test');
  await page.goto(`/meetings/${SEEDED_MEETING}`);
  await assertMinutesHandle(page, 1280);
});
