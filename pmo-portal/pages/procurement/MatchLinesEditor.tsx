import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EntityFormModal, ListState, NumberField, type SubmitError } from '@/src/components/ui';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatNumberExact, parseMoneyInputAtScale } from '@/src/lib/format';
import { useMatchLinesEditorData, useSaveMatchLines } from '@/src/hooks/useMatchSettingsAndLines';
import type { BillMatch } from '@/src/lib/repositories/threeWayMatch';

/**
 * #2634 (FR-TWM-011/012): the receipt-lines and bill-lines editor. One row per ordered item of the purchase: the quantity
 * received (a receipt) or the quantity and rate billed (a bill). An empty quantity leaves the item off. The database
 * decides who may write, which bills and purchases are still editable and what a line may say (record_receipt_match_lines /
 * record_bill_match_lines); this form shows the current lines, validates what it can and sends exactly the RPC payload.
 */
export interface MatchLinesEditorProps {
  kind: 'receipt' | 'bill';
  /** The receipt's or the bill's id. */
  targetId: string;
  procurementId: string;
  /** The receipt's or bill's own number, for the title. */
  label: string;
  onClose: () => void;
}

type Row = { qty: string; rate: string };

export const MatchLinesEditor: React.FC<MatchLinesEditorProps> = ({ kind, targetId, procurementId, label, onClose }) => {
  const { t } = useTranslation(['common', 'procurement']);
  const bill = kind === 'bill';
  const { items, lines } = useMatchLinesEditorData(kind, targetId, procurementId);
  const save = useSaveMatchLines();
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [ready, setReady] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<SubmitError | null>(null);
  const [result, setResult] = useState<BillMatch | null | undefined>(undefined);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (ready || !items.data || !lines.data) return;
    const recorded = new Map(lines.data.map((l) => [l.itemId, l]));
    setRows(Object.fromEntries(items.data.map((i) => {
      const r = recorded.get(i.id);
      return [i.id, { qty: r ? formatNumberExact(Number(r.quantity)) : '', rate: formatNumberExact(Number(r?.rate ?? i.rate)) }];
    })));
    setReady(true);
  }, [items.data, lines.data, ready]);

  const set = (id: string, patch: Partial<Row>) => { setDirty(true); setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } })); };

  const refusals: Record<string, string> = {
    'three-way-match-posted': bill
      ? t('procurement:threeWayMatch.lines.refusal.billPaid', 'This bill is paid, so its lines can no longer change.')
      : t('procurement:threeWayMatch.lines.refusal.closed', 'This purchase is paid or cancelled, so its receipt lines can no longer change.'),
    'three-way-match-frozen': t('procurement:threeWayMatch.lines.refusal.frozen', 'An exception was approved for this bill, so its lines are frozen.'),
    'three-way-match-erp': t('procurement:threeWayMatch.lines.refusal.erp', 'This record is kept in the ERP, so its lines are not edited here.'),
    MH002: t('procurement:threeWayMatch.lines.refusal.subcontract', 'Subcontract work is received and billed through its own acceptances and bill lines.'),
    '22023': t('procurement:threeWayMatch.lines.refusal.invalid', 'A line is not valid. Check the quantities and rates.'),
    '42501': t('procurement:threeWayMatch.lines.refusal.role', 'Your role cannot change these lines.'),
    '23514': t('procurement:threeWayMatch.lines.refusal.cancelled', 'This bill is cancelled, so its lines cannot change.'),
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (result !== undefined) { onClose(); return; }
    const next: Record<string, string> = {};
    const out: Array<{ itemId: string; quantity: number; rate: number }> = [];
    for (const item of items.data ?? []) {
      const r = rows[item.id];
      if (!r || r.qty.trim() === '') continue;
      const q = parseMoneyInputAtScale(r.qty.trim(), 3);
      if (q === null || q <= 0) { next[`q-${item.id}`] = t('procurement:threeWayMatch.lines.quantityError', 'Enter a quantity above 0 with at most 3 decimal places.'); continue; }
      const rate = bill ? parseMoneyInputAtScale(r.rate.trim(), 2) : 0;
      if (rate === null || rate < 0) { next[`r-${item.id}`] = t('procurement:threeWayMatch.lines.rateError', 'Enter a rate of 0 or more with at most 2 decimal places.'); continue; }
      out.push({ itemId: item.id, quantity: q, rate });
    }
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length) return;
    if (out.length === 0) { setFormError(t('procurement:threeWayMatch.lines.noLines', 'Enter a quantity for at least one item.')); return; }
    setSaveError(null);
    save.mutate(
      bill ? { kind: 'bill', id: targetId, lines: out } : { kind: 'receipt', id: targetId, lines: out.map(({ itemId, quantity }) => ({ itemId, quantity })) },
      {
        onSuccess: (match) => { setResult(match); setDirty(false); },
        onError: (err) => {
          const c = classifyMutationError(err, refusals, { suppressCapture: true });
          setSaveError({ headline: refusals[(err as { code?: string })?.code ?? ''] ?? c.headline, detail: refusals[(err as { code?: string })?.code ?? ''] ? undefined : c.detail });
        },
      },
    );
  };

  const resultLine = result === undefined ? null
    : result === null ? t('procurement:threeWayMatch.lines.savedReceipt', 'Receipt lines saved. Held bills on this purchase are checked again.')
    : result.status === 'matched' ? t('procurement:threeWayMatch.lines.savedMatched', 'Lines saved. This bill now matches, so its hold is released.')
    : result.status === 'held' ? t('procurement:threeWayMatch.lines.savedHeld', 'Lines saved. This bill is still held: it does not yet match the order and receipts.')
    : t('procurement:threeWayMatch.lines.saved', 'Lines saved.');

  const loading = items.isPending || lines.isPending;
  const failed = items.isError || lines.isError;
  const title = bill
    ? t('procurement:threeWayMatch.lines.billTitle', 'Bill lines · {{label}}', { label })
    : t('procurement:threeWayMatch.lines.receiptTitle', 'Received quantities · {{label}}', { label });

  return (
    <EntityFormModal open width="lg" title={title}
      submitLabel={result !== undefined ? t('procurement:threeWayMatch.lines.done', 'Done') : t('procurement:threeWayMatch.lines.save', 'Save lines')}
      onSubmit={handleSubmit} onClose={onClose} loading={save.isPending} dirty={dirty && result === undefined}
      submitDisabled={loading || failed || (items.data?.length ?? 0) === 0} submitError={saveError}>
      {failed ? <ListState variant="error" title={t('procurement:threeWayMatch.lines.loadError', "Couldn't load the order lines")} onRetry={() => { void items.refetch(); void lines.refetch(); }} />
        : loading || !ready ? (items.data?.length === 0 ? <p className="text-sm text-muted-foreground">{t('procurement:threeWayMatch.lines.noItems', 'This purchase has no ordered items to match against.')}</p> : <ListState variant="loading" rows={3} />)
        : <div className="space-y-3" data-testid="match-lines-editor">
          <p className="text-sm text-muted-foreground">{bill
            ? t('procurement:threeWayMatch.lines.billHelp', 'Enter the quantity and rate this bill charges for each ordered item. Leave a quantity empty to leave the item off.')
            : t('procurement:threeWayMatch.lines.receiptHelp', 'Enter the quantity this receipt received for each ordered item. Leave a quantity empty to leave the item off.')}</p>
          {(items.data ?? []).map((item) => (
            <div key={item.id} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_8rem_8rem] sm:items-end" data-testid={`match-line-${item.id}`}>
              <div className="text-sm">
                <div className="font-medium">{item.name}</div>
                <div className="text-muted-foreground tabular-nums">{t('procurement:threeWayMatch.lines.ordered', 'Ordered {{quantity}} at {{rate}}', { quantity: formatNumberExact(Number(item.quantity)), rate: formatNumberExact(Number(item.rate)) })}</div>
              </div>
              <NumberField id={`match-qty-${item.id}`} label={t('procurement:threeWayMatch.lines.quantity', 'Quantity')} localeAware
                value={rows[item.id]?.qty ?? ''} onChange={(v) => set(item.id, { qty: v })} error={errors[`q-${item.id}`]} disabled={result !== undefined} />
              {bill && <NumberField id={`match-rate-${item.id}`} label={t('procurement:threeWayMatch.lines.rate', 'Rate')} localeAware
                value={rows[item.id]?.rate ?? ''} onChange={(v) => set(item.id, { rate: v })} error={errors[`r-${item.id}`]} disabled={result !== undefined} />}
            </div>
          ))}
          {formError && <p role="alert" className="text-sm text-destructive-text">{formError}</p>}
          {resultLine && <p role="status" data-testid="match-lines-result" className="text-sm font-medium">{resultLine}</p>}
        </div>}
    </EntityFormModal>
  );
};
