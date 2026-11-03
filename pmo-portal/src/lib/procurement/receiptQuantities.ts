/** #1505 P8 (FR-OPP-031): the receipt lines a user entered, checked against what was ordered. */
export interface ReceiptItem { name: string; quantity: number }
export interface ReceiptLine { itemRef: string; quantity: number }

/** The lines to send, or the first line whose figure is not a positive number within what was ordered. */
export function parseReceiptQuantities(items: readonly ReceiptItem[], entered: Readonly<Record<string, string>>): { lines: ReceiptLine[] } | { invalid: string } {
  const lines: ReceiptLine[] = [];
  for (const item of items) {
    const raw = (entered[item.name] ?? '').trim();
    if (raw === '') continue;
    const quantity = Number(raw);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > item.quantity) return { invalid: item.name };
    lines.push({ itemRef: item.name, quantity });
  }
  return { lines };
}
