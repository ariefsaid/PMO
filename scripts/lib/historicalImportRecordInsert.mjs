/**
 * historicalImportRecordInsert.mjs — schema-correct per-record insert-payload builder for
 * scripts/import-historical.mjs (Deliverable 3, FR-HIST-003; fix-round B1).
 *
 * The 7 procurement record tables have DIFFERENT columns — a generic
 * {status,date,amount,reference_number} insert crashes on quotations (total_amount/received_date/
 * vendor_id NOT NULL, no status/date/amount), receipts (receipt_date, no date/amount) and invoices
 * (invoice_date). This maps each CycleRow to its real columns. Pure/synchronous/DB-free (the caller
 * supplies the resolved vendor map + provenance); import-historical.mjs does the actual insert.
 *
 * Schema source of truth (verified against migrations before writing):
 *   purchase_requests / rfqs / purchase_orders (0035): reference_number, status, date, amount
 *   procurement_quotations (0001):                     vendor_id NOT NULL, total_amount, received_date, reference
 *   procurement_receipts (0006 + 0040):                status (enum) NOT NULL, receipt_date, gr_number, reference_number
 *   procurement_invoices (0006 + 0040):                status (enum) NOT NULL, invoice_date, vi_number, reference_number, amount
 *   payments (0035):                                   invoice_id, reference_number, status, date, amount
 */

export const RECORD_TABLE_BY_TYPE = {
  PR: 'purchase_requests',
  RFQ: 'rfqs',
  Quotation: 'procurement_quotations',
  PO: 'purchase_orders',
  GR: 'procurement_receipts',
  VI: 'procurement_invoices',
  Payment: 'payments',
};

/** Empty/whitespace string → null; a real numeric string → Number; otherwise null. */
function toNumberOrNull(raw) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}

/** Empty/whitespace string → null; otherwise the trimmed value. */
function toDateOrNull(raw) {
  const s = raw === undefined || raw === null ? '' : String(raw).trim();
  return s || null;
}

function toRefOrNull(raw) {
  const s = raw === undefined || raw === null ? '' : String(raw).trim();
  return s || null;
}

/** Normalize a vendor name for map lookup (trim + lowercase). */
function vendorKey(name) {
  return (name ?? '').trim().toLowerCase();
}

/**
 * Builds the { table, payload } for a single record row.
 *
 * @param row - { type, externalRef, status, date, amount, vendor }
 * @param procurementId - the parent case id
 * @param vendorMap - { [normalizedVendorName]: vendorCompanyId } for quotation vendor_id
 * @param prov - { importBatchId, importedAt, importKey, invoiceId? }
 * @returns { table, payload } or throws on an unknown type
 */
export function buildRecordInsert(row, procurementId, vendorMap, prov) {
  const table = RECORD_TABLE_BY_TYPE[row.type];
  if (!table) throw new Error(`Unknown record type: "${row.type}"`);

  const provenance = {
    import_key: prov.importKey,
    import_batch_id: prov.importBatchId,
    imported_at: prov.importedAt,
  };
  const ref = toRefOrNull(row.externalRef);

  switch (row.type) {
    case 'PR':
    case 'RFQ':
    case 'PO':
      return {
        table,
        payload: {
          procurement_id: procurementId,
          reference_number: ref,
          status: toRefOrNull(row.status) ?? 'Draft',
          date: toDateOrNull(row.date),
          amount: toNumberOrNull(row.amount),
          ...provenance,
        },
      };

    case 'Quotation':
      return {
        table,
        payload: {
          procurement_id: procurementId,
          vendor_id: vendorMap[vendorKey(row.vendor)] ?? null,
          total_amount: toNumberOrNull(row.amount) ?? 0,
          received_date: toDateOrNull(row.date),
          reference: ref,
          ...provenance,
        },
      };

    case 'GR':
      return {
        table,
        payload: {
          procurement_id: procurementId,
          // procurement_receipt_status ∈ {Partial, Complete} — default to Complete for a
          // terminal historical receipt.
          status: toRefOrNull(row.status) ?? 'Complete',
          receipt_date: toDateOrNull(row.date),
          reference_number: ref,
          ...provenance,
        },
      };

    case 'VI':
      return {
        table,
        payload: {
          procurement_id: procurementId,
          status: toRefOrNull(row.status) ?? 'Received',
          invoice_date: toDateOrNull(row.date),
          reference_number: ref,
          amount: toNumberOrNull(row.amount),
          ...provenance,
        },
      };

    case 'Payment':
      return {
        table,
        payload: {
          procurement_id: procurementId,
          invoice_id: prov.invoiceId ?? null,
          reference_number: ref,
          status: toRefOrNull(row.status) ?? 'Scheduled',
          date: toDateOrNull(row.date),
          amount: toNumberOrNull(row.amount),
          ...provenance,
        },
      };

    default:
      throw new Error(`Unknown record type: "${row.type}"`);
  }
}
