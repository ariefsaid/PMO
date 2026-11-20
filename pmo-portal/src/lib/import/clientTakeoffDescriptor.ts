import type { TFunction } from 'i18next';
import { clientRequisitionRepository, type ClientRequisitionLineInput } from '@/src/lib/repositories/clientRequisitions';
import { parseNeutralMoneyInputAtScale } from '@/src/lib/format';
import type { ImportDescriptor } from './types';
import { labelOf, makeField } from './importShared';

type Cells = Record<string, string>;

/** One sheet row: one line (item, take-off, optional requested quantity) of a draft requisition (#2585, FR-CSR-003). */
export type ClientTakeoffLine = Pick<ClientRequisitionLineInput, 'stockItemId' | 'takeoffQuantity' | 'requestedQuantity'>;

export interface ClientTakeoffContext {
  workOrderId: string;
  /** Items whose tag is zero-cost (client-supplied), the only ones a requisition line may name. */
  items: readonly { id: string; code: string; name: string; wholeOnly: boolean }[];
}

const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase();

/** A figure a person typed in a sheet: above 0 and at most 3 decimals (NFR-CSR-002), as the exact string the RPC receives. */
const quantity = (raw: string): string | null => {
  const n = parseNeutralMoneyInputAtScale(raw, 3);
  return n === null || n <= 0 ? null : String(n);
};

/**
 * Take-off import for ONE work order (#2585, FR-CSR-003, ADR-0027): the rows of a sheet become the lines of one new draft
 * requisition. The rules are manual entry's: an item that is client-supplied, a quantity above 0 with 3 decimals at most,
 * whole units where the unit demands it. `create` goes through the requisition repository (`csr_create` for the first
 * row, `csr_update_draft` to add each next line), so the database re-checks every row; `org_id`, the project and any cost
 * are never sent. A row the database refuses is left out and the next row still lands.
 */
export function makeClientTakeoffImportDescriptor(ctx: ClientTakeoffContext, t?: TFunction): ImportDescriptor<ClientTakeoffLine> {
  const L = labelOf(t);
  const byCode = new Map(ctx.items.map((i) => [norm(i.code), i]));
  const F = (key: string, en: string, id: string, required: boolean, validate: (r: string) => string | null, extra = {}) =>
    makeField<ClientTakeoffLine>(key, L(`import:clientTakeoff.${key}`, en), required, validate, { aliases: [en, id], ...extra });
  const quantityError = L('import:clientTakeoff.error.quantity', 'Enter a quantity above 0 with at most 3 decimal places.');
  let draftId: string | null = null;
  const lines: ClientTakeoffLine[] = [];
  let chain: Promise<unknown> = Promise.resolve();

  return {
    entity: 'Client take-off',
    entityDisplay: L('import:entity.clientTakeoff', 'take-off lines'),
    entityDisplayOne: L('import:entity.clientTakeoffLine', 'take-off line'),
    rowTitle: (c) => [c.itemCode].map((v) => (v ?? '').trim()).filter(Boolean).join(' · '),
    template: { version: 1, example: { itemCode: ctx.items[0]?.code ?? 'CEM', takeoff: '100', requested: '' } },
    fields: [
      F('itemCode', 'Item code', 'Kode item', true, (r) => {
        if (r.trim() === '') return L('import:clientTakeoff.error.itemRequired', 'Item code is required.');
        return byCode.has(norm(r)) ? null : L('import:clientTakeoff.error.itemUnknown', 'Item code not found among the client-supplied items.');
      }, { inRowTitle: true, hint: L('import:clientTakeoff.itemHint', 'The code of a client-supplied item.') }),
      F('takeoff', 'Take-off quantity', 'Kuantitas take-off', true, (r) => (quantity(r) === null ? quantityError : null), { numeric: true }),
      F('requested', 'Requested quantity', 'Kuantitas diminta', false, (r) => (r.trim() === '' || quantity(r) !== null ? null : quantityError), {
        numeric: true, hint: L('import:clientTakeoff.requestedHint', 'Optional. Blank means the take-off quantity.'),
      }),
    ],
    validateRow: (c: Cells) => {
      const out: Record<string, string> = {};
      const item = byCode.get(norm(c.itemCode));
      if (item?.wholeOnly) {
        const frac = (raw: string) => { const q = quantity(raw); return q !== null && Number(q) !== Math.trunc(Number(q)); };
        if (frac(c.takeoff ?? '')) out.takeoff = L('import:clientTakeoff.error.whole', 'This item is counted in whole units.');
        if ((c.requested ?? '').trim() !== '' && frac(c.requested ?? '')) out.requested = L('import:clientTakeoff.error.whole', 'This item is counted in whole units.');
      }
      return out as never;
    },
    validateSheet: (rows) => {
      const first = new Map<string, number>();
      return rows.map((c, i) => {
        const key = norm(c.itemCode);
        if (key === '') return {};
        const at = first.get(key);
        if (at === undefined) { first.set(key, i); return {}; }
        return { itemCode: L('import:clientTakeoff.error.repeat', 'This item already appears in row {n}.').replace('{n}', String(at + 2)) } as never;
      });
    },
    toInput: (c: Cells): ClientTakeoffLine => {
      const requested = (c.requested ?? '').trim() === '' ? undefined : quantity(c.requested ?? '') ?? undefined;
      return { stockItemId: byCode.get(norm(c.itemCode))?.id ?? '', takeoffQuantity: quantity(c.takeoff ?? '') ?? '', requestedQuantity: requested };
    },
    create: (input) => {
      const run = async () => {
        lines.push(input);
        try {
          if (draftId === null) draftId = await clientRequisitionRepository.create({ workOrderId: ctx.workOrderId, clientReference: null }, [...lines]);
          else await clientRequisitionRepository.updateDraft(draftId, { clientReference: null }, [...lines]);
          return draftId;
        } catch (err) {
          lines.pop();
          throw err;
        }
      };
      const next = chain.then(run, run);
      chain = next.catch(() => undefined);
      return next;
    },
  };
}
