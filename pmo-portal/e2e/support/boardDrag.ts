import { expect, type Locator, type Page } from '@playwright/test';

/** Real pointer drag through dnd-kit's MouseSensor (6 px activation), then a stepped move onto the column. */
export async function dragCardTo(
  page: Page,
  card: Locator,
  column: Locator,
  /** Runs while the card is held over the column, before the pointer is re-aimed and released (mid-drag assertions). */
  whileDragging?: () => Promise<void>,
): Promise<void> {
  await card.scrollIntoViewIfNeeded();
  const from = await card.boundingBox();
  const to = await column.boundingBox();
  if (!from || !to) throw new Error('dragCardTo: card or column not visible');
  const viewportHeight = page.viewportSize()?.height ?? 800;
  const x = from.x + from.width / 2;
  const y = from.y + Math.min(16, from.height / 2);
  // Aim at the card's own height, clamped inside the column's box and the viewport. The card is on
  // screen, so this point is too. The old aim (column top + 60, clamped to y = 24) put the pointer at the
  // top edge when a tall column started above the fold, outside the column, and the drop resolved to
  // the neighbouring column.
  const targetPoint = (box: { x: number; y: number; width: number; height: number }) => ({
    x: box.x + box.width / 2,
    y: Math.min(Math.max(y, box.y + 8, 80), box.y + box.height - 8, viewportHeight - 24),
  });
  /** Move the pointer onto the column as it is laid out RIGHT NOW. */
  const aimAt = async () => {
    const box = await column.boundingBox();
    if (!box) throw new Error('dragCardTo: column is no longer visible');
    const point = targetPoint(box);
    await page.mouse.move(point.x, point.y);
  };
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 12, y, { steps: 3 });
  await page.mouse.move(targetPoint(to).x, targetPoint(to).y, { steps: 15 });
  await whileDragging?.();
  // The board is a horizontally scrollable strip and dnd-kit's auto-scroll keeps running while the card
  // is held. A long mid-drag assertion can therefore leave the pointer aimed at this column sitting
  // over a NEIGHBOURING one by release time (v0.35 release run: held at Pre-Qual's centre through the
  // mid-drag axe pass, released over Tender — the confirm never opened). Re-measure NOW and re-aim, so
  // the release lands on the column this call named instead of wherever the page drifted to.
  await aimAt();
  // ...and prove it. The column publishes dnd-kit's live answer in `data-drop-state`: 'target' means
  // the pointer is over this column, 'allowed' means the move is legal but the pointer is elsewhere,
  // 'blocked' is an illegal move (whose cue deliberately does not distinguish hover).
  const cue = column.locator('[data-drop-state]').first();
  if (await cue.count() > 0) {
    await expect.poll(() => cue.getAttribute('data-drop-state'), {
      message: 'dragCardTo: the pointer must be over the target column when the drag is released',
      timeout: 3_000,
    }).not.toBe('allowed');
  }
  await page.mouse.up();
  // dnd-kit's drop animation runs ~250 ms; a drag started inside it is ignored, so let it settle.
  await page.waitForTimeout(500);
}
