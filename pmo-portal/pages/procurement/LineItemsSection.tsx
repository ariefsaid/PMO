import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Card, CardHead, CardPad, Button, Icon, ConfirmDialog, FieldError, Combobox, DataTable,
  useMoneyInputMask,
  type Column,
} from '@/src/components/ui';
import {
  currencySymbol, formatCurrency, formatCurrencyCents, formatMoneyInputValue, moneyInputErrorKind, numberSymbols, parseMoneyInputAtScale,
} from '@/src/lib/format';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import { itemsNetTotal } from '@/src/lib/itemsNet';
import type { ProcurementItemRow } from '@/src/lib/db/procurementCrud';
import type { ComboboxOption } from '@/src/components/ui/Combobox';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { Input } from '@/src/components/shadcn/input';

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
interface LineItemErrors { quantity?: string; rate?: string }
export interface LineItemsSectionProps {
  items: ProcurementItemRow[];
  editable: boolean;
  /** Create-form presentation keeps its editable row inside the table. */
  createFormLayout?: boolean;
  /** Reports whether the create-form add row contains any typed input to the parent leave guard. */
  onAddRowInputChange?: (hasInput: boolean) => void;
  /** Lets the parent focus the entry row when a form submit is blocked. */
  addRowDescriptionRef?: React.Ref<HTMLInputElement>;
  /** A form-level message shown beside the create-form entry row. */
  blockedAddRowMessage?: string | null;
  valuesEditable?: boolean;
  onAdd: (input: { name: string; quantity: number; rate: number; description?: string }) => Promise<unknown>;
  onUpdate: (id: string, patch: { name: string; quantity?: number; rate?: number; description?: string }) => Promise<unknown>;
  erpItems?: { loadOptions: () => Promise<ComboboxOption[]> };
  onDelete: (id: string) => Promise<unknown>;
  onError: (err: unknown) => void;
  busy?: boolean;
  currency: string;
  currencyKnown?: boolean;
}
const CellInput: React.FC<React.ComponentPropsWithRef<'input'> & { numeric?: boolean; createForm?: boolean }> = ({ numeric, createForm, className = '', ...rest }) => (
  <Input {...rest} type="text" inputMode={numeric ? 'decimal' : undefined}
    className={(createForm ? 'h-[var(--control-height)] max-sm:min-h-11 max-sm:text-base ' : 'h-8 ') + 'w-full rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring ' + (numeric ? 'tabular text-right ' : '') + className} />
);

const CREATE_ADD_ROW_ID = '__create_line_item__' as const;
type LineTableRow =
  | { id: string; kind: 'item'; item: ProcurementItemRow }
  | { id: typeof CREATE_ADD_ROW_ID; kind: 'add' };

export const LineItemsSection: React.FC<LineItemsSectionProps> = ({ items, editable, createFormLayout = false, onAddRowInputChange, addRowDescriptionRef, blockedAddRowMessage, valuesEditable = true, onAdd, onUpdate, onDelete, onError, busy, currency, currencyKnown = true, erpItems }) => {
  const { t } = useTranslation('procurement');
  const [draft, setDraft] = useState<ItemDraft>(EMPTY_DRAFT);
  const [addErrors, setAddErrors] = useState<LineItemErrors>({});
  const [addMutationError, setAddMutationError] = useState<{ headline: string; detail: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<ItemDraft>(EMPTY_DRAFT);
  const [editErrors, setEditErrors] = useState<LineItemErrors>({});
  const [editMutationError, setEditMutationError] = useState<{ headline: string; detail: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProcurementItemRow | null>(null);
  const [deleteMutationError, setDeleteMutationError] = useState<{ headline: string; detail: string } | null>(null);
  const hasAddRowInput = (value: ItemDraft) => value.name.length > 0 || value.quantity.length > 0 || value.rate.length > 0;
  const updateAddDraft = (patch: Partial<ItemDraft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (createFormLayout) onAddRowInputChange?.(hasAddRowInput(next));
  };
  const addRateMask = useMoneyInputMask(draft.rate, (rate) => {
    updateAddDraft({ rate });
    setAddErrors((prev) => ({ ...prev, rate: undefined }));
  });
  const editRateMask = useMoneyInputMask(editDraft.rate, (rate) => { setEditDraft((d) => ({ ...d, rate })); setEditErrors((prev) => ({ ...prev, rate: undefined })); });
  const total = itemsNetTotal(items);
  const unknownAmount = t('lineItems.unknownCurrencyAmount', 'Unknown');
  const addRowInTable = createFormLayout && editable;
  useEffect(() => () => {
    if (createFormLayout) onAddRowInputChange?.(false);
  }, [createFormLayout, onAddRowInputChange]);
  const tableRows: LineTableRow[] = [
    ...items.map((item) => ({ id: item.id, kind: 'item' as const, item })),
  ];
  if (addRowInTable) tableRows.push({ id: CREATE_ADD_ROW_ID, kind: 'add' });

  const submitAdd = async () => {
    if (!draft.name.trim()) return;
    setAddMutationError(null);
    const quantityError = validateLineNum(draft.quantity, 'Quantity');
    const rateError = validateLineNum(draft.rate, 'Unit price');
    const rate = parseRate(draft.rate);
    if (quantityError || rateError || rate === null) { setAddErrors({ quantity: quantityError, rate: rateError }); return; }
    setAddErrors({});
    try {
      const addResult = onAdd({ name: draft.name.trim(), quantity: num(draft.quantity), rate, ...(erpItems ? { description: draft.description?.trim() ?? '' } : {}) });
      // The create form adds locally: once onAdd starts, that typed line belongs to saved form
      // state. Clear the parent's pending-input flag now; the row itself clears after the promise.
      if (createFormLayout) onAddRowInputChange?.(false);
      await addResult;
      setDraft(EMPTY_DRAFT);
      if (createFormLayout) onAddRowInputChange?.(false);
    } catch (err) {
      if (createFormLayout) onAddRowInputChange?.(hasAddRowInput(draft));
      setAddMutationError(classifyMutationError(err, undefined, { suppressCapture: true }));
      onError(err);
    }
  };
  const addLineAmount = itemsNetTotal([{
    quantity: parseMoneyInputAtScale(draft.quantity, 2),
    rate: parseMoneyInputAtScale(draft.rate, 2),
  }]);
  const addLineAmountLabel = addLineAmount === null
    ? '—'
    : currencyKnown
      ? createFormLayout ? formatCurrency(addLineAmount, currency) : formatCurrencyCents(addLineAmount, currency)
      : unknownAmount;
  const handleAddKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void submitAdd();
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

  const columns: Column<LineTableRow>[] = [
    {
      key: 'description', header: erpItems ? t('lineItems.itemDescription', 'Item / description') : t('lineItems.description', 'Description'), kind: 'primary', size: 320, minSize: 200,
      cell: (row) => {
        if (row.kind === 'add') return <div className="space-y-1">
          <span className="block text-control font-medium text-foreground">{t('lineItems.addRowLabel', 'New line')}</span>
          <CellInput
            createForm
            ref={addRowDescriptionRef}
            aria-label={t('lineItems.newItemDescription', 'New item description')}
            placeholder={t('lineItems.addItemPlaceholder', 'Add an item…')}
            value={draft.name}
            onChange={(e) => updateAddDraft({ name: e.target.value })}
            onKeyDown={handleAddKeyDown}
          />
        </div>;
        const it = row.item;
        if (editable && editingId === it.id) return erpItems ? <div className="space-y-2">
          <Combobox label={t('lineItems.erpItem', 'ERP item')} value={editDraft.name || null} selectedOption={editDraft.name ? { value: editDraft.name, label: editDraft.name } : null} onChange={(name) => setEditDraft((d) => ({ ...d, name }))} loadOptions={erpItems.loadOptions} noun="ERP item" searchPlaceholder={t('lineItems.searchItem', 'Search item code or name…')} compact />
          <CellInput aria-label={`Edit description for ${it.name}`} value={editDraft.description ?? ''} onChange={(e) => setEditDraft((d) => ({ ...d, description: e.target.value }))} />
        </div> : <CellInput aria-label={`Edit description for ${it.name}`} value={editDraft.name} onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))} />;
        return <span className="font-medium">{it.name}{erpItems && it.description && <span className="mt-1 block font-normal text-muted-foreground">{it.description}</span>}</span>;
      },
    },
    { key: 'quantity', header: t('lineItems.quantity', 'Qty'), kind: 'number', align: 'num', size: 88, cell: (row) => {
      if (row.kind === 'add') return <div className="space-y-1"><CellInput createForm numeric aria-label={t('lineItems.newItemQuantity', 'New item quantity')} placeholder={t('lineItems.quantity', 'Qty')} value={draft.quantity} onChange={(e) => { updateAddDraft({ quantity: e.target.value }); setAddErrors((p) => ({ ...p, quantity: undefined })); }} onKeyDown={handleAddKeyDown} /><FieldError>{addErrors.quantity}</FieldError></div>;
      const it = row.item;
      return editable && editingId === it.id ? <div className="space-y-1"><CellInput disabled={!valuesEditable} numeric aria-label={`Edit quantity for ${it.name}`} value={editDraft.quantity} onChange={(e) => { setEditDraft((d) => ({ ...d, quantity: e.target.value })); setEditErrors((p) => ({ ...p, quantity: undefined })); }} /><FieldError>{editErrors.quantity}</FieldError></div> : Number(it.quantity);
    } },
    { key: 'rate', header: t('lineItems.unitPrice', 'Unit price'), kind: 'money', align: 'num', size: 150, cell: (row) => {
      if (row.kind === 'add') return <div className="space-y-1">
        <div className="relative">
          {currencyKnown && <span aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-control text-muted-foreground">{currencySymbol(currency)}</span>}
          <CellInput createForm numeric aria-label={t('lineItems.newItemUnitPrice', 'New item unit price')} placeholder={t('lineItems.unitPrice', 'Unit price')} ref={addRateMask.ref} value={draft.rate} onChange={addRateMask.onChange} onKeyDown={handleAddKeyDown} className={currencyKnown ? 'pl-12' : undefined} />
        </div>
        <FieldError>{addErrors.rate}</FieldError>
      </div>;
      const it = row.item;
      return editable && editingId === it.id ? <div className="space-y-1"><CellInput disabled={!valuesEditable} numeric aria-label={`Edit unit price for ${it.name}`} ref={editRateMask.ref} value={editDraft.rate} onChange={editRateMask.onChange} /><FieldError>{editErrors.rate}</FieldError></div> : currencyKnown ? formatCurrency(Number(it.rate), currency) : unknownAmount;
    } },
    { key: 'amount', header: t('lineItems.lineTotal', 'Line total'), kind: 'money', align: 'num', size: 150, cell: (row) => {
      if (row.kind === 'add') return <span aria-label={t('lineItems.newLineTotal', 'New line total')} className="tabular text-muted-foreground">{addLineAmountLabel}</span>;
      const it = row.item;
      const amount = editable && editingId === it.id
        ? itemsNetTotal([{ quantity: parseMoneyInputAtScale(editDraft.quantity, 2), rate: parseMoneyInputAtScale(editDraft.rate, 2) }])
        : itemsNetTotal([{ quantity: it.quantity, rate: it.rate }]);
      return <span className="font-medium">{amount === null ? '—' : !currencyKnown ? unknownAmount : formatCurrency(amount, currency)}</span>;
    } },
  ];
  if (editable) columns.push({ key: 'actions', header: createFormLayout ? <span className="sr-only">{t('lineItems.rowActions', 'Row actions')}</span> : t('lineItems.rowActions', 'Row actions'), kind: 'actions', size: 150, cell: (row) => {
    if (row.kind === 'add') return <div className="flex flex-col gap-1"><Button size="sm" variant="outline" aria-label={t('lineItems.addLineItem', 'Add line item')} disabled={!draft.name.trim()} loading={busy} onClick={() => void submitAdd()}><Icon name="plus" />{t('lineItems.add', 'Add')}</Button>{addMutationError && <p role="alert" className="text-sm text-destructive-text">{addMutationError.headline}. {addMutationError.detail}</p>}</div>;
    const it = row.item;
    return editingId === it.id ? <div className="flex flex-col gap-1"><div className="flex gap-1"><Button size="sm" variant="primary" loading={busy} onClick={() => void submitEdit(it.id)}>{t('lineItems.save', 'Save')}</Button><Button size="sm" variant="ghost" onClick={() => { setEditingId(null); setEditMutationError(null); }}>{t('lineItems.cancel', 'Cancel')}</Button></div>{editMutationError && <p role="alert" className="text-sm text-destructive-text">{editMutationError.headline}. {editMutationError.detail}</p>}</div> : <div className="flex gap-1"><Button size="sm" variant="ghost" aria-label={`Edit ${it.name}`} onClick={() => startEdit(it)}>{t('lineItems.edit', 'Edit')}</Button><Button size="sm" variant="ghost" iconOnly aria-label={`Remove ${it.name}`} onClick={() => { setDeleteMutationError(null); setDeleteTarget(it); }}><Icon name="x" /></Button></div>;
  } });
  const columnsTotal = { amount: !currencyKnown ? unknownAmount : total === null ? '—' : formatCurrency(total, currency) };
  return <Card className="mb-4" data-testid="line-items-section">
    <CardHead>{t('lineItems.heading', 'Line items')}{!createFormLayout && <span className="ml-2 text-sm font-normal text-muted-foreground">{t('lineItems.formula', 'qty × unit price → line total')}</span>}</CardHead>
    <DataTable embedded rows={tableRows} columns={columns} rowKey={(row) => row.id} tableId="procurement-line-items" accessibleName="Line items"
      state={items.length === 0 && !addRowInTable ? 'empty' : undefined} emptyTitle={editable ? t('lineItems.emptyEditable', 'No line items yet. Add one below.') : t('lineItems.empty', 'No line items yet.')}
      totals={[{ key: 'estimated', label: t('lineItems.estimatedTotal', 'Estimated total'), values: columnsTotal }]} />
    {addRowInTable && blockedAddRowMessage && <p role="alert" className="px-4 pb-3 text-control text-destructive-text">{blockedAddRowMessage}</p>}
    {editable && !addRowInTable && <CardPad>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(180px,1fr)_100px_150px_auto] sm:items-start" data-testid="line-item-add-row">
        <div>{erpItems ? <div className="space-y-2"><Combobox label={t('lineItems.erpItem', 'ERP item')} value={draft.name || null} selectedOption={draft.name ? { value: draft.name, label: draft.name } : null} onChange={(name) => setDraft((d) => ({ ...d, name }))} loadOptions={erpItems.loadOptions} noun="ERP item" placeholder={t('lineItems.selectItem', 'Select or search item…')} searchPlaceholder={t('lineItems.searchItem', 'Search item code or name…')} required compact /><CellInput aria-label={t('lineItems.newItemDescription', 'New item description')} placeholder={t('lineItems.describeItem', 'Describe the work or goods…')} value={draft.description ?? ''} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} /></div> : <CellInput aria-label={t('lineItems.newItemDescription', 'New item description')} placeholder={t('lineItems.addItemPlaceholder', 'Add an item…')} value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />}</div>
        <div><CellInput numeric aria-label={t('lineItems.newItemQuantity', 'New item quantity')} placeholder="0" value={draft.quantity} onChange={(e) => { setDraft((d) => ({ ...d, quantity: e.target.value })); setAddErrors((p) => ({ ...p, quantity: undefined })); }} /><FieldError>{addErrors.quantity}</FieldError></div>
        <div><CellInput numeric aria-label={t('lineItems.newItemUnitPrice', 'New item unit price')} placeholder={`0${numberSymbols().decimal}00`} ref={addRateMask.ref} value={draft.rate} onChange={addRateMask.onChange} /><FieldError>{addErrors.rate}</FieldError></div>
        <div className="flex items-center gap-3"><span aria-label={t('lineItems.newLineTotal', 'New line total')} className="tabular text-muted-foreground">{(() => { const qty = parseMoneyInputAtScale(draft.quantity, 2); const rate = parseMoneyInputAtScale(draft.rate, 2); const amount = itemsNetTotal([{ quantity: qty, rate }]); return amount === null ? '—' : currencyKnown ? formatCurrencyCents(amount, currency) : unknownAmount; })()}</span><Button size="sm" variant="outline" aria-label={t('lineItems.addLineItem', 'Add line item')} disabled={!draft.name.trim()} loading={busy} onClick={() => void submitAdd()}><Icon name="plus" />{t('lineItems.add', 'Add')}</Button></div>
      </div>
      {addMutationError && <p role="alert" className="mt-2 text-sm text-destructive-text">{addMutationError.headline}. {addMutationError.detail}</p>}
    </CardPad>}
    <ConfirmDialog open={!!deleteTarget} tone="destructive" title={deleteTarget ? `Remove ${deleteTarget.name}?` : 'Remove line item?'} description={<div className="space-y-2"><p>{t('lineItems.removeDescription', 'This removes the line item from procurement. You can add it again while the procurement is a draft.')}</p>{deleteMutationError && <p role="alert" className="rounded-md border border-destructive/25 bg-destructive/[0.04] px-3 py-2 text-sm text-destructive-text">{deleteMutationError.headline}. {deleteMutationError.detail}</p>}</div>} confirmLabel={t('lineItems.removeItem', 'Remove item')} loading={busy} onConfirm={confirmDelete} onCancel={() => { setDeleteTarget(null); setDeleteMutationError(null); }} />
  </Card>;
};
LineItemsSection.displayName = 'LineItemsSection';
