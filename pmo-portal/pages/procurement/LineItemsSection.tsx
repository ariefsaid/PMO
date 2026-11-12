import React, { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Card, CardHead, CardPad, Button, Icon, ConfirmDialog, FieldError, Combobox, DataTable,
  useMoneyInputMask,
  type Column,
} from '@/src/components/ui';
import {
  formatCurrency, formatCurrencyCents, formatMoneyInputValue, moneyInputErrorKind, numberSymbols, parseMoneyInputAtScale,
} from '@/src/lib/format';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import { itemsNetTotal } from '@/src/lib/itemsNet';
import type { ProcurementItemRow } from '@/src/lib/db/procurementCrud';
import type { ComboboxOption } from '@/src/components/ui/Combobox';
import { classifyMutationError } from '@/src/lib/classifyMutationError';

export interface ItemDraft { name: string; description?: string; quantity: string; rate: string }
const EMPTY_DRAFT: ItemDraft = { name: '', quantity: '', rate: '' };
function num(v: string): number { return parseMoneyInputAtScale(v, 2) ?? 0; }
function describeFormatError(label: string, locale = getNumberLocale()): string {
  const { decimal, group } = numberSymbols(locale);
  const example = formatMoneyInputValue(1234.56, locale);
  return `${label} must use "${group}" to group thousands and "${decimal}" for decimals — for example ${example}.`;
}
function validateLineNum(raw: string, label: string): string | undefined {
  if (!raw.trim()) return `${label} is required.`;
  const n = parseMoneyInputAtScale(raw, 2);
  if (n !== null && n > 0) return undefined;
  if (moneyInputErrorKind(raw, 2) === 'format') return describeFormatError(label);
  return `${label} must be greater than 0 with no more than 2 decimal places.`;
}
function parseRate(raw: string): number | null {
  const n = parseMoneyInputAtScale(raw, 2);
  return n !== null && n > 0 ? n : null;
}
interface LineItemErrors { name?: string; quantity?: string; rate?: string }
/** N01: result of the parent-save path asking this section to commit its pending add-row.
 *  On 'committed' the parent appends `input` through its own line-adding path. */
export type PendingRowCommit =
  | { status: 'empty' }
  | { status: 'invalid' }
  | { status: 'committed'; input: { name: string; quantity: number; rate: number; description?: string } };
export interface LineItemsSectionHandle {
  /** Validate the pending add-row synchronously and hand a complete valid row to the parent
   *  (clearing the row here). 'invalid' refuses the parent's save with the row retained and
   *  inline field errors explaining why. Deliberately synchronous: the parent's save path
   *  must reach its mutation in the same tick the user pressed Save. */
  commitPendingRow(): PendingRowCommit;
}
export interface LineItemsSectionProps {
  items: ProcurementItemRow[];
  editable: boolean;
  valuesEditable?: boolean;
  onAdd: (input: { name: string; quantity: number; rate: number; description?: string }) => Promise<unknown>;
  onUpdate: (id: string, patch: { name: string; quantity?: number; rate?: number; description?: string }) => Promise<unknown>;
  erpItems?: { loadOptions: () => Promise<ComboboxOption[]> };
  onDelete: (id: string) => Promise<unknown>;
  onError: (err: unknown) => void;
  /** N01: reports whether the pending add-row holds typed work (or a refused add's error),
   *  so the parent's unsaved-changes guard holds navigation until the user decides. */
  onPendingDraftChange?: (hasPendingWork: boolean) => void;
  busy?: boolean;
  currency: string;
}
const CellInput: React.FC<React.ComponentPropsWithRef<'input'> & { numeric?: boolean }> = ({ numeric, className = '', ...rest }) => (
  <input {...rest} type="text" inputMode={numeric ? 'decimal' : undefined}
    className={'h-8 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring ' + (numeric ? 'tabular text-right ' : '') + className} />
);

export const LineItemsSection: React.FC<LineItemsSectionProps & React.RefAttributes<LineItemsSectionHandle>> = ({ items, editable, valuesEditable = true, onAdd, onUpdate, onDelete, onError, busy, currency, erpItems, onPendingDraftChange, ref }) => {
  const { t } = useTranslation('procurement');
  const [draft, setDraft] = useState<ItemDraft>(EMPTY_DRAFT);
  // N01: event-time mirror of the pending add-row. State updates scheduled by an earlier event
  // (e.g. the Add button clearing the row) can still be un-rendered when the parent's Save
  // fires, so the commit path reads this ref; every draft write goes through applyDraft.
  const draftRef = useRef<ItemDraft>(EMPTY_DRAFT);
  const applyDraft = (updater: (d: ItemDraft) => ItemDraft) => { draftRef.current = updater(draftRef.current); setDraft(draftRef.current); };
  const [addErrors, setAddErrors] = useState<LineItemErrors>({});
  const [addMutationError, setAddMutationError] = useState<{ headline: string; detail: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<ItemDraft>(EMPTY_DRAFT);
  const [editErrors, setEditErrors] = useState<LineItemErrors>({});
  const [editMutationError, setEditMutationError] = useState<{ headline: string; detail: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProcurementItemRow | null>(null);
  const [deleteMutationError, setDeleteMutationError] = useState<{ headline: string; detail: string } | null>(null);
  const addRateMask = useMoneyInputMask(draft.rate, (rate) => { applyDraft((d) => ({ ...d, rate })); setAddErrors((prev) => ({ ...prev, rate: undefined })); });
  const editRateMask = useMoneyInputMask(editDraft.rate, (rate) => { setEditDraft((d) => ({ ...d, rate })); setEditErrors((prev) => ({ ...prev, rate: undefined })); });
  const total = itemsNetTotal(items);

  const submitAdd = async () => {
    if (!draftRef.current.name.trim()) return;
    setAddMutationError(null);
    const quantityError = validateLineNum(draftRef.current.quantity, 'Quantity');
    const rateError = validateLineNum(draftRef.current.rate, 'Unit price');
    const rate = parseRate(draftRef.current.rate);
    if (quantityError || rateError || rate === null) { setAddErrors({ quantity: quantityError, rate: rateError }); return; }
    setAddErrors({});
    const submitted = draftRef.current;
    // The mirror clears NOW (event truth): a Save pressed before the parent's line state has
    // re-rendered must not re-commit this row. The visible clear still waits for onAdd, and a
    // refused add restores the typed draft untouched.
    draftRef.current = EMPTY_DRAFT;
    try {
      await onAdd({ name: submitted.name.trim(), quantity: num(submitted.quantity), rate, ...(erpItems ? { description: submitted.description?.trim() ?? '' } : {}) });
      setDraft(EMPTY_DRAFT);
    } catch (err) {
      draftRef.current = submitted;
      setAddMutationError(classifyMutationError(err, undefined, { suppressCapture: true }));
      onError(err);
    }
  };
  const startEdit = (it: ProcurementItemRow) => {
    setEditingId(it.id);
    setEditDraft({ name: it.name, description: it.description ?? '', quantity: formatMoneyInputValue(Number(it.quantity)), rate: formatMoneyInputValue(Number(it.rate)) });
    setEditErrors({});
    setEditMutationError(null);
  };
  const submitEdit = async (id: string) => {
    if (!editDraft.name.trim()) return;
    setEditMutationError(null);
    const quantityError = valuesEditable ? validateLineNum(editDraft.quantity, 'Quantity') : undefined;
    const rateError = valuesEditable ? validateLineNum(editDraft.rate, 'Unit price') : undefined;
    const rate = valuesEditable ? parseRate(editDraft.rate) : null;
    if (quantityError || rateError || (valuesEditable && rate === null)) { setEditErrors({ quantity: quantityError, rate: rateError }); return; }
    setEditErrors({});
    try {
      await onUpdate(id, { name: editDraft.name.trim(), ...(valuesEditable && rate !== null ? { quantity: num(editDraft.quantity), rate } : {}), ...(erpItems ? { description: editDraft.description?.trim() ?? '' } : {}) });
      setEditingId(null);
    } catch (err) {
      setEditMutationError(classifyMutationError(err, undefined, { suppressCapture: true }));
      onError(err);
    }
  };
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteMutationError(null);
    try { await onDelete(target.id); setDeleteTarget(null); }
    catch (err) {
      setDeleteMutationError(classifyMutationError(err, undefined, { suppressCapture: true }));
      onError(err);
    }
  };

  // N01: the add-row is a pending line draft. On the parent's save it is committed when
  // complete and valid (the values are handed back for the parent to append), and refused
  // (row retained, inline field explanation) otherwise.
  const commitPendingRow = (): PendingRowCommit => {
    const d = draftRef.current;
    if (d.name.trim() === '' && d.quantity.trim() === '' && d.rate.trim() === '' && (d.description ?? '').trim() === '') return { status: 'empty' };
    setAddMutationError(null);
    const nameError = d.name.trim() ? undefined : 'Item is required.';
    const quantityError = validateLineNum(d.quantity, 'Quantity');
    const rateError = validateLineNum(d.rate, 'Unit price');
    const rate = parseRate(d.rate);
    if (nameError || quantityError || rateError || rate === null) {
      setAddErrors({ name: nameError, quantity: quantityError, rate: rateError });
      return { status: 'invalid' };
    }
    setAddErrors({});
    applyDraft(() => EMPTY_DRAFT);
    return { status: 'committed', input: { name: d.name.trim(), quantity: num(d.quantity), rate, ...(erpItems ? { description: d.description?.trim() ?? '' } : {}) } };
  };
  useImperativeHandle(ref, () => ({ commitPendingRow }));

  const pendingReportRef = useRef(onPendingDraftChange);
  pendingReportRef.current = onPendingDraftChange;
  const hasPendingWork = draft.name.trim() !== '' || draft.quantity.trim() !== '' || draft.rate.trim() !== '' || (draft.description ?? '').trim() !== '' || addMutationError !== null;
  useEffect(() => { pendingReportRef.current?.(hasPendingWork); }, [hasPendingWork]);
  useEffect(() => () => pendingReportRef.current?.(false), []);

  const columns: Column<ProcurementItemRow>[] = [
    {
      key: 'description', header: erpItems ? t('lineItems.itemDescription', 'Item / description') : t('lineItems.description', 'Description'), kind: 'primary', size: 320, minSize: 200,
      cell: (it) => {
        if (editable && editingId === it.id) return erpItems ? <div className="space-y-2">
          <Combobox label={t('lineItems.erpItem', 'ERP item')} value={editDraft.name || null} selectedOption={editDraft.name ? { value: editDraft.name, label: editDraft.name } : null} onChange={(name) => setEditDraft((d) => ({ ...d, name }))} loadOptions={erpItems.loadOptions} noun="ERP item" searchPlaceholder={t('lineItems.searchItem', 'Search item code or name…')} />
          <CellInput aria-label={`Edit description for ${it.name}`} value={editDraft.description ?? ''} onChange={(e) => setEditDraft((d) => ({ ...d, description: e.target.value }))} />
        </div> : <CellInput aria-label={`Edit description for ${it.name}`} value={editDraft.name} onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))} />;
        return <span className="font-medium">{it.name}{erpItems && it.description && <span className="mt-1 block font-normal text-muted-foreground">{it.description}</span>}</span>;
      },
    },
    { key: 'quantity', header: t('lineItems.quantity', 'Qty'), kind: 'number', align: 'num', size: 88, cell: (it) => editable && editingId === it.id ? <div className="space-y-1"><CellInput disabled={!valuesEditable} numeric aria-label={`Edit quantity for ${it.name}`} value={editDraft.quantity} onChange={(e) => { setEditDraft((d) => ({ ...d, quantity: e.target.value })); setEditErrors((p) => ({ ...p, quantity: undefined })); }} /><FieldError>{editErrors.quantity}</FieldError></div> : Number(it.quantity) },
    { key: 'rate', header: t('lineItems.unitPrice', 'Unit price'), kind: 'money', align: 'num', size: 150, cell: (it) => editable && editingId === it.id ? <div className="space-y-1"><CellInput disabled={!valuesEditable} numeric aria-label={`Edit unit price for ${it.name}`} ref={editRateMask.ref} value={editDraft.rate} onChange={editRateMask.onChange} /><FieldError>{editErrors.rate}</FieldError></div> : formatCurrency(Number(it.rate), currency) },
    { key: 'amount', header: t('lineItems.lineTotal', 'Line total'), kind: 'money', align: 'num', size: 150, cell: (it) => {
      const amount = editable && editingId === it.id
        ? itemsNetTotal([{ quantity: parseMoneyInputAtScale(editDraft.quantity, 2), rate: parseMoneyInputAtScale(editDraft.rate, 2) }])
        : itemsNetTotal([{ quantity: it.quantity, rate: it.rate }]);
      return <span className="font-medium">{amount === null ? '—' : formatCurrency(amount, currency)}</span>;
    } },
  ];
  if (editable) columns.push({ key: 'actions', header: <span className="sr-only">{t('lineItems.rowActions', 'Row actions')}</span>, kind: 'actions', size: 150, cell: (it) => editingId === it.id ? <div className="flex flex-col gap-1"><div className="flex gap-1"><Button size="sm" variant="primary" loading={busy} onClick={() => void submitEdit(it.id)}>{t('lineItems.save', 'Save')}</Button><Button size="sm" variant="ghost" onClick={() => { setEditingId(null); setEditMutationError(null); }}>{t('lineItems.cancel', 'Cancel')}</Button></div>{editMutationError && <p role="alert" className="text-sm text-destructive-text">{editMutationError.headline}. {editMutationError.detail}</p>}</div> : <div className="flex gap-1"><Button size="sm" variant="ghost" aria-label={`Edit ${it.name}`} onClick={() => startEdit(it)}>{t('lineItems.edit', 'Edit')}</Button><Button size="sm" variant="ghost" iconOnly aria-label={`Remove ${it.name}`} onClick={() => { setDeleteMutationError(null); setDeleteTarget(it); }}><Icon name="x" /></Button></div> });
  const columnsTotal = { amount: total === null ? '—' : formatCurrency(total, currency) };
  return <Card className="mb-4" data-testid="line-items-section">
    <CardHead>{t('lineItems.heading', 'Line items')}<span className="ml-2 text-sm font-normal text-muted-foreground">{t('lineItems.formula', 'qty × unit price → line total')}</span></CardHead>
    <DataTable embedded rows={items} columns={columns} rowKey={(it) => it.id} tableId="procurement-line-items" accessibleName="Line items"
      state={items.length === 0 ? 'empty' : undefined} emptyTitle={editable ? t('lineItems.emptyEditable', 'No line items yet. Add one below.') : t('lineItems.empty', 'No line items yet.')}
      totals={[{ key: 'estimated', label: t('lineItems.estimatedTotal', 'Estimated total'), values: columnsTotal }]} />
    {editable && <CardPad>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(180px,1fr)_100px_150px_auto] sm:items-start" data-testid="line-item-add-row">
        <div>{erpItems ? <div className="space-y-2"><Combobox label={t('lineItems.erpItem', 'ERP item')} value={draft.name || null} selectedOption={draft.name ? { value: draft.name, label: draft.name } : null} onChange={(name) => { applyDraft((d) => ({ ...d, name })); setAddErrors((p) => ({ ...p, name: undefined })); }} loadOptions={erpItems.loadOptions} noun="ERP item" placeholder={t('lineItems.selectItem', 'Select or search item…')} searchPlaceholder={t('lineItems.searchItem', 'Search item code or name…')} required error={addErrors.name} /><CellInput aria-label={t('lineItems.newItemDescription', 'New item description')} placeholder={t('lineItems.describeItem', 'Describe the work or goods…')} value={draft.description ?? ''} onChange={(e) => applyDraft((d) => ({ ...d, description: e.target.value }))} /></div> : <div className="space-y-1"><CellInput aria-label={t('lineItems.newItemDescription', 'New item description')} placeholder={t('lineItems.addItemPlaceholder', 'Add an item…')} value={draft.name} onChange={(e) => { applyDraft((d) => ({ ...d, name: e.target.value })); setAddErrors((p) => ({ ...p, name: undefined })); }} /><FieldError>{addErrors.name}</FieldError></div>}</div>
        <div><CellInput numeric aria-label={t('lineItems.newItemQuantity', 'New item quantity')} placeholder="0" value={draft.quantity} onChange={(e) => { applyDraft((d) => ({ ...d, quantity: e.target.value })); setAddErrors((p) => ({ ...p, quantity: undefined })); }} /><FieldError>{addErrors.quantity}</FieldError></div>
        <div><CellInput numeric aria-label={t('lineItems.newItemUnitPrice', 'New item unit price')} placeholder={`0${numberSymbols().decimal}00`} ref={addRateMask.ref} value={draft.rate} onChange={addRateMask.onChange} /><FieldError>{addErrors.rate}</FieldError></div>
        <div className="flex items-center gap-3"><span aria-label={t('lineItems.newLineTotal', 'New line total')} className="tabular text-muted-foreground">{(() => { const qty = parseMoneyInputAtScale(draft.quantity, 2); const rate = parseMoneyInputAtScale(draft.rate, 2); const amount = itemsNetTotal([{ quantity: qty, rate }]); return amount !== null ? formatCurrencyCents(amount, currency) : '—'; })()}</span><Button size="sm" variant="outline" aria-label={t('lineItems.addLineItem', 'Add line item')} disabled={!draft.name.trim()} loading={busy} onClick={() => void submitAdd()}><Icon name="plus" />{t('lineItems.add', 'Add')}</Button></div>
      </div>
      {addMutationError && <p role="alert" className="mt-2 text-sm text-destructive-text">{addMutationError.headline}. {addMutationError.detail}</p>}
    </CardPad>}
    <ConfirmDialog open={!!deleteTarget} tone="destructive" title={deleteTarget ? `Remove ${deleteTarget.name}?` : 'Remove line item?'} description={<div className="space-y-2"><p>{t('lineItems.removeDescription', 'This removes the line item from procurement. You can add it again while the procurement is a draft.')}</p>{deleteMutationError && <p role="alert" className="rounded-md border border-destructive/25 bg-destructive/[0.04] px-3 py-2 text-sm text-destructive-text">{deleteMutationError.headline}. {deleteMutationError.detail}</p>}</div>} confirmLabel={t('lineItems.removeItem', 'Remove item')} loading={busy} onConfirm={confirmDelete} onCancel={() => { setDeleteTarget(null); setDeleteMutationError(null); }} />
  </Card>;
};
LineItemsSection.displayName = 'LineItemsSection';
