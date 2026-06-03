// Single source of truth for currency formatting (F-6). USD, no fraction digits —
// preserves the prototype's prior output. Multi-currency deferred (NFR-I18N-001, OD-1).
const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function formatCurrency(value: number): string {
  return currencyFormatter.format(value);
}
