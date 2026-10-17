/** Narrow, read-only subset of an ERP Sales Invoice used as bill evidence in PMO. */
export interface SalesInvoiceEvidence {
  lines: Array<{
    item_code: string | null;
    description: string | null;
    qty: number | null;
    rate: number | null;
    amount: number | null;
  }> | null;
  contact: { name: string | null; email: string | null; phone: string | null } | null;
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const numeric = (value: unknown): number | null => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^-?\d+(\.\d+)?$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Allowlist fields only; an absent child table is unknown, while [] is a known empty table. */
export function projectSalesInvoiceEvidence(doc: unknown): SalesInvoiceEvidence {
  if (!doc || typeof doc !== 'object') return { lines: null, contact: null };
  const record = doc as Record<string, unknown>;
  const rawLines = record.items;
  const lines = Array.isArray(rawLines)
    ? rawLines.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const line = item as Record<string, unknown>;
      return [{
        item_code: text(line.item_code),
        description: text(line.description),
        qty: numeric(line.qty),
        rate: numeric(line.rate),
        amount: numeric(line.amount),
      }];
    })
    : null;
  const contact = {
    name: text(record.contact_display),
    email: text(record.contact_email),
    phone: text(record.contact_mobile),
  };
  return {
    lines,
    contact: contact.name || contact.email || contact.phone ? contact : null,
  };
}
