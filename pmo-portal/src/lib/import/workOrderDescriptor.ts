import type { TFunction } from 'i18next';
import { repositories } from '@/src/lib/repositories';
import { formatNumberExact, parseNeutralMoneyInputAtScale } from '@/src/lib/format';
import type { WorkOrderImportRow } from '@/src/lib/db/workOrders';
import type { ImportDescriptor, ImportField } from './types';
import { labelOf, makeField } from './importShared';

/** One work order of the sheet, as the descriptor hands it to the repository. */
export type WorkOrderImportInput = WorkOrderImportRow;

type Cells = Record<string, string>;
type ScopeLine = { itemCode: string; quantity: string; __row: string };

const SCOPE_KEY = 'scope';
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const TAX = ['exclusive', 'inclusive'] as const;

export interface WorkOrderImportDeps {
  projectId: string;
  /** The project's currency: a currency cell may repeat it, never differ (a trigger pins it). */
  currency: string;
  /** Live (not archived) areas, empty when the organisation keeps none: the Area column exists only when there are some. */
  areas: readonly { id: string; code: string; name: string }[];
  /** The project's contract lines (item code → id and quantity) the scope sheet names. */
  boqLines: readonly { id: string; itemCode: string; quantity: number }[];
  /** Client references already on the project, so a re-run is refused as "already there" rather than duplicated. */
  existingReferences: () => Promise<Iterable<string>>;
}

const validDate = (raw: string) => {
  const v = raw.trim();
  if (!ISO.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

const scopeOf = (cells: Cells): ScopeLine[] => {
  try { return JSON.parse(cells[SCOPE_KEY] || '[]') as ScopeLine[]; } catch { return []; }
};

/**
 * Work-order import for ONE project (FR-WOI-001..005): a row per work order (Draft), an optional Area, and an optional second
 * sheet of scope lines (contract line by item code, with the quantity allocated). Preview is the oracle: every row is checked
 * here with zero writes, and the confirm is all-or-nothing (`allOrNothing`), saved in one database transaction.
 * `wo_number` is not an import column: it is minted at issue (0193).
 */
export function makeWorkOrderImportDescriptor(deps: WorkOrderImportDeps, t?: TFunction): ImportDescriptor<WorkOrderImportInput> {
  const L = labelOf(t);
  // An area is named by its code or its name (a code wins); a live code is unique per organisation.
  const areaIds = new Map<string, string>([...deps.areas.map((a) => [a.name.trim().toLowerCase(), a.id] as const), ...deps.areas.map((a) => [a.code.trim().toLowerCase(), a.id] as const)]);
  const areaId = (raw: string) => areaIds.get(raw.trim().toLowerCase()) ?? null;
  const items = new Map(deps.boqLines.map((l) => [l.itemCode.trim().toLowerCase(), l] as const));
  const money = (raw: string, scale: number) => parseNeutralMoneyInputAtScale(raw.trim(), scale);
  const figure = (raw: string) => { const n = money(raw, 2); return n === null ? null : formatNumberExact(n); };

  const F = (key: string, en: string, id: string, required: boolean, validate: (r: string) => string | null, extra: Partial<ImportField<WorkOrderImportInput>> = {}) =>
    makeField<WorkOrderImportInput>(key, L(`import:workOrders.${key}`, en), required, validate, { aliases: [en, id], ...extra });
  const optionalDate = (name: string) => (raw: string) => (raw.trim() === '' || validDate(raw) ? null : L('import:workOrders.error.date', '{{field}} must be a date written year-month-day, like 2026-12-31.').replace('{{field}}', name));

  const fields: ImportField<WorkOrderImportInput>[] = [
    F('title', 'Title', 'Judul', true, (raw) => {
      const v = raw.trim();
      if (!v) return L('import:workOrders.error.title', 'Title is required.');
      return v.length > 200 ? L('import:workOrders.error.titleLong', 'Title must be at most 200 characters.') : null;
    }, { inRowTitle: true, previewSize: 160 }),
    F('clientPoNumber', 'Client reference', 'Referensi klien', false, (raw) => (raw.trim().length > 100 ? L('import:workOrders.error.reference', 'Client reference must be at most 100 characters.') : null), {
      inRowTitle: true, previewSize: 104,
      hint: L('import:workOrders.referenceHint', "The client's own number for the order. Each reference is used once on this project; scope lines name it."),
    }),
    ...(deps.areas.length > 0 ? [F('area', 'Area', 'Area', false, (raw) => (raw.trim() === '' || areaId(raw) ? null : L('import:workOrders.error.area', 'Area "{{value}}" is not one of your areas.').replace('{{value}}', raw.trim())), { previewSize: 80, hint: L('import:workOrders.areaHint', 'The code or name of one of your areas. Leave blank for none.') })] : []),
    F('startDate', 'Start date', 'Tanggal mulai', false, optionalDate(L('import:workOrders.startDate', 'Start date')), { previewSize: 88 }),
    F('endDate', 'End date', 'Tanggal selesai', false, optionalDate(L('import:workOrders.endDate', 'End date')), { previewSize: 88 }),
    F('orderValue', 'Order value', 'Nilai order', true, (raw) => {
      const n = money(raw, 2);
      return n === null || n < 0 ? L('import:workOrders.error.value', 'Order value must be a number of 0 or more (up to 2 decimals).') : null;
    }, { numeric: true, format: figure, previewSize: 112, hint: L('import:workOrders.valueHint', 'In the project currency. Written with a dot for decimals.') }),
    F('taxTreatment', 'Tax treatment', 'Perlakuan pajak', true, (raw) => ((TAX as readonly string[]).includes(raw.trim().toLowerCase()) ? null : L('import:workOrders.error.tax', 'Tax treatment must be exclusive or inclusive.')), {
      previewSize: 80, hint: L('import:workOrders.taxHint', 'Does the order value already include tax? Write inclusive or exclusive.'),
    }),
    F('taxAmount', 'Tax amount', 'Jumlah pajak', false, (raw) => {
      if (raw.trim() === '') return null;
      const n = money(raw, 2);
      return n === null || n < 0 ? L('import:workOrders.error.taxAmount', 'Tax amount must be a number of 0 or more (up to 2 decimals).') : null;
    }, { numeric: true, hideInPreview: true, hint: L('import:workOrders.taxAmountHint', 'Optional. Blank means 0.') }),
    F('currency', 'Currency', 'Mata uang', false, (raw) => (raw.trim() === '' || raw.trim().toUpperCase() === deps.currency ? null : L('import:workOrders.error.currency', 'Currency must be {{code}}, the currency of this project.').replace('{{code}}', deps.currency)), {
      hideInPreview: true, hint: L('import:workOrders.currencyHint', 'Optional. Work orders take the project currency.'),
    }),
    // Filled by the wizard from the second sheet; never mapped, never a column.
    makeField<WorkOrderImportInput>(SCOPE_KEY, 'Scope lines', false, () => null, { internal: true, hideInPreview: true }),
  ];

  const scopeFields: ImportField<never>[] = [
    makeField<never>('workOrder', L('import:workOrders.scope.workOrder', 'Client reference'), true, () => null, { aliases: ['Client reference', 'Referensi klien', 'Work order'] }),
    makeField<never>('itemCode', L('import:workOrders.scope.itemCode', 'Item code'), true, () => null, { aliases: ['Item code', 'Kode item'] }),
    makeField<never>('quantity', L('import:workOrders.scope.quantity', 'Quantity'), true, () => null, { aliases: ['Quantity', 'Kuantitas'] }),
  ];

  return {
    entity: 'Work orders',
    entityDisplay: L('import:entity.workOrders', 'work orders'),
    entityDisplayOne: L('import:entity.workOrder', 'work order'),
    rowTitle: (c) => [c.clientPoNumber, c.title].map((v) => (v ?? '').trim()).filter(Boolean).join(' · '),
    wide: true,
    template: {
      version: 1,
      example: { title: L('import:workOrders.exampleTitle', 'Pump pad civil works'), clientPoNumber: 'PO-001', startDate: '2026-12-01', endDate: '2026-12-31', orderValue: '1000000', taxTreatment: 'exclusive', taxAmount: '0', currency: deps.currency, ...(deps.areas[0] ? { area: deps.areas[0].code } : {}) },
      lists: { taxTreatment: [...TAX], ...(deps.areas.length > 0 && deps.areas.length <= 100 ? { area: deps.areas.map((a) => a.code) } : {}) },
    },
    extraSheet: {
      sheet: L('import:workOrders.scope.sheet', 'Scope lines'),
      fields: scopeFields,
      example: { workOrder: 'PO-001', itemCode: deps.boqLines[0]?.itemCode ?? 'B-1', quantity: '10' },
      parentKey: 'clientPoNumber',
      childKey: 'workOrder',
      target: SCOPE_KEY,
      orphan: (row, value) => L('import:workOrders.error.scopeOrphan', 'Scope sheet row {{row}}: no work order has client reference "{{value}}".').replace('{{row}}', String(row)).replace('{{value}}', value),
      missingColumn: (label) => L('import:workOrders.error.scopeColumn', 'The scope sheet needs a "{{label}}" column.').replace('{{label}}', label),
    },
    fields,
    // The scope lines are checked with their work order: an error names the sheet row (row 1 is the header) so the person can fix it.
    validateRow: (c) => {
      const out: Partial<Record<keyof WorkOrderImportInput & string, string>> = {};
      const start = c.startDate?.trim() ?? '';
      const end = c.endDate?.trim() ?? '';
      if (validDate(start) && validDate(end) && end < start) out.endDate = L('import:workOrders.error.dateOrder', 'End date must not be before the start date.');
      const seen = new Set<string>();
      for (const line of scopeOf(c)) {
        const sheetRow = line.__row;
        const item = items.get(line.itemCode.trim().toLowerCase());
        const q = money(line.quantity ?? '', 3);
        const message = !item
          ? L('import:workOrders.error.scopeItem', 'Scope sheet row {{row}}: "{{code}}" is not a contract line of this project.').replace('{{row}}', sheetRow).replace('{{code}}', line.itemCode.trim())
          : q === null || q <= 0
            ? L('import:workOrders.error.scopeQuantity', 'Scope sheet row {{row}}: quantity must be a number above 0 (up to 3 decimals).').replace('{{row}}', sheetRow)
            : item && q > item.quantity
              ? L('import:workOrders.error.scopeOver', 'Scope sheet row {{row}}: quantity {{qty}} is more than the contract line holds ({{max}}).').replace('{{row}}', sheetRow).replace('{{qty}}', formatNumberExact(q)).replace('{{max}}', formatNumberExact(item.quantity))
              : seen.has(item.id)
                ? L('import:workOrders.error.scopeTwice', 'Scope sheet row {{row}}: "{{code}}" appears twice for this work order.').replace('{{row}}', sheetRow).replace('{{code}}', line.itemCode.trim())
                : null;
        if (item) seen.add(item.id);
        if (message) { out.title = out.title ?? message; break; }
      }
      return out;
    },
    // The same client reference twice in one sheet would make the scope lines ambiguous.
    validateSheet: (rows) => {
      const first = new Map<string, number>();
      return rows.map((c, i) => {
        const ref = (c.clientPoNumber ?? '').trim().toLowerCase();
        if (!ref) return {};
        if (first.has(ref)) return { clientPoNumber: L('import:workOrders.error.referenceTwice', 'Client reference "{{value}}" appears twice (rows {{first}} and {{second}}).').replace('{{value}}', c.clientPoNumber.trim()).replace('{{first}}', String((first.get(ref) ?? 0) + 2)).replace('{{second}}', String(i + 2)) };
        first.set(ref, i);
        return {};
      });
    },
    existingKeys: {
      load: async () => [...(await deps.existingReferences())].map((k) => k.trim().toLowerCase()).filter(Boolean),
      keyOf: (c) => (c.clientPoNumber ?? '').trim().toLowerCase(),
      alreadyThere: L('import:workOrders.alreadyThere', 'This client reference is already on this project.'),
      unavailable: L('import:workOrders.existingUnavailable', 'Could not check for client references already on this project.'),
      nothingNew: L('import:workOrders.nothingNew', 'Nothing to import: every work order is already on this project.'),
    },
    allOrNothing: {
      blocked: L('import:workOrders.blocked', 'Nothing is imported while any row has a problem. Fix the rows marked invalid or already there, then upload the file again.'),
      createAll: (inputs) => repositories.workOrder.importBatch(deps.projectId, inputs),
    },
    toInput: (c) => ({
      title: c.title.trim(),
      clientPoNumber: c.clientPoNumber?.trim() || null,
      orderValue: money(c.orderValue, 2) ?? 0,
      taxTreatment: c.taxTreatment.trim().toLowerCase() as WorkOrderImportInput['taxTreatment'],
      taxAmount: c.taxAmount?.trim() ? (money(c.taxAmount, 2) ?? 0) : 0,
      currency: c.currency?.trim() ? c.currency.trim().toUpperCase() : null,
      startDate: c.startDate?.trim() || null,
      endDate: c.endDate?.trim() || null,
      areaId: c.area?.trim() ? areaId(c.area) : null,
      lines: scopeOf(c).flatMap((l) => { const item = items.get(l.itemCode.trim().toLowerCase()); const q = money(l.quantity ?? '', 3); return item && q ? [{ boqItemId: item.id, quantity: q }] : []; }),
    }),
    // Never used: the wizard sends the whole batch to `allOrNothing.createAll`.
    create: (input) => repositories.workOrder.importBatch(deps.projectId, [input]),
  };
}
