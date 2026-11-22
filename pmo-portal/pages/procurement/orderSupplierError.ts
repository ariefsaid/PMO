import type { TFunction } from 'i18next';

/** The database refuses an order that names no supplier (ORDER_NEEDS_SUPPLIER, 23514). Say what to do, in the reader's language. */
export function isOrderNeedsSupplier(err: unknown): boolean {
  return err instanceof Error && /^ORDER_NEEDS_SUPPLIER/.test(err.message);
}

export function orderNeedsSupplierMessage(err: unknown, t: TFunction): { headline: string; detail: string } | null {
  if (!isOrderNeedsSupplier(err)) return null;
  return {
    headline: t('procurementRecord:order.needsSupplierTitle', 'Choose the supplier first'),
    detail: t('procurementRecord:order.needsSupplier', 'An order needs its supplier. Choose it, then record the order.'),
  };
}
