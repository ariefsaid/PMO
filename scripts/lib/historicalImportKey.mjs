/** Historical writer identity keys and facts derived from its direct-insert payload. */

/** Case key = case_ref (the stable grouping key). */
export function computeCaseImportKey(caseRef) {
  return caseRef;
}

/**
 * Encode a reference or the historical writer's typed creation facts in the v2 namespace.
 *
 * @param row - { type, externalRef, date, amount, vendor }
 */
export function computeRecordImportKey(row, facts) {
  return `pcy2:${JSON.stringify(row.externalRef?.trim() ? ['r', row.externalRef.trim()] : ['f', facts])}`;
}

export function computeLegacyRecordImportKey(row) {
  if (row.externalRef?.trim()) return row.externalRef.trim();
  const parts = [row.type, row.date ?? '', row.amount ?? '', row.vendor ?? ''];
  return `fp:${parts.join('|')}`;
}

export function projectCreationFacts(type, payload) {
  const amount = value => value == null ? null : Number(value).toFixed(2);
  const ref = payload.reference_number ?? null;
  switch (type) {
    case 'PR': case 'RFQ': case 'PO': return [ref, payload.status, payload.date ?? null, amount(payload.amount)];
    case 'Quotation': return [payload.reference ?? null, payload.vendor_id?.toLowerCase() ?? null, amount(payload.total_amount), payload.received_date ?? null];
    case 'GR': return [ref, payload.status, payload.receipt_date ?? null];
    case 'VI': return [ref, payload.status, payload.invoice_date ?? null, amount(payload.amount), payload.tax_treatment, amount(payload.tax_amount)];
    case 'Payment': return [ref, payload.invoice_id?.toLowerCase() ?? null, payload.status, payload.date ?? null, amount(payload.amount)];
    default: throw new Error(`Unsupported identity projection: ${type}`);
  }
}
