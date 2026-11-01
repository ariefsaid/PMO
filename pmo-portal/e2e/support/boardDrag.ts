import type { Locator, Page } from '@playwright/test';

/** Real pointer drag through dnd-kit's MouseSensor (6 px activation), then a stepped move onto the column. */
export async function dragCardTo(page: Page, card: Locator, column: Locator): Promise<void> {
  await card.scrollIntoViewIfNeeded();
  const from = await card.boundingBox();
  const to = await column.boundingBox();
  if (!from || !to) throw new Error('dragCardTo: card or column not visible');
  const viewportHeight = page.viewportSize()?.height ?? 800;
  const x = from.x + from.width / 2;
  const y = from.y + Math.min(16, from.height / 2);
  // Aim inside the column's own box and inside the viewport (a tall column can start above the fold).
  const targetY = Math.min(Math.max(to.y + 60, 24), viewportHeight - 24, to.y + to.height - 8);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 12, y, { steps: 3 });
  await page.mouse.move(to.x + to.width / 2, targetY, { steps: 15 });
  await page.mouse.up();
  // dnd-kit's drop animation runs ~250 ms; a drag started inside it is ignored, so let it settle.
  await page.waitForTimeout(500);
}
