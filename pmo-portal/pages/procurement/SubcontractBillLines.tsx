import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ListState } from '@/src/components/ui/ListState';
import { usePoPosition } from '@/src/hooks/useSubcontract';
import { formatCurrency, formatNumberExact, parseMoneyInputAtScale } from '@/src/lib/format';
import { prefillBillLines } from '@/src/lib/subcontracts/subcontractRules';
import type { SubcontractBillLineInput } from '@/src/lib/db/subcontracts';

/**
 * The BoQ lines of a subcontract vendor bill (#1513 S7.4). One row per PO line, pre-filled with what is still
 * payable and editable DOWN only; the rate is the PO rate and the pre-tax amount is computed from the lines and
 * reported up (the amount field is read-only for a lined purchase). The server enforces the cap (SC001); this is
 * display and convenience.
 */
export interface SubcontractBillLinesProps {
  poId: string;
  currency: string;
  /** Lines with a quantity above 0, and the pre-tax amount they add up to. */
  onChange: (lines: SubcontractBillLineInput[], amount: number) => void;
  /** A refusal from the server (see `classifySubcontractBillError`), shown in words. */
  error?: string | null;
}

const milli = (n: number) => Math.round(n * 1000);

export const SubcontractBillLines: React.FC<SubcontractBillLinesProps> = ({ poId, currency, onChange, error = null }) => {
  const { t } = useTranslation('procurement');
  const position = usePoPosition(poId);
  const rows = position.data ?? [];
  const [qty, setQty] = useState<Record<string, string> | null>(null);
  const [clamped, setClamped] = useState<string | null>(null);

  const prefill = prefillBillLines(rows.map((r) => ({
    boqItemId: r.boq_item_id, itemCode: r.item_code, unit: r.unit, rate: r.rate, poQty: r.po_qty,
    verified: r.verified, billed: r.billed, payable: r.payable, verifiedNotOnPo: r.verified_not_on_po,
  })));
  const maxOf = new Map(prefill.map((p) => [p.boqItemId, p.max]));

  const current = qty ?? Object.fromEntries(prefill.map((p) => [p.boqItemId, String(p.quantity)]));
  const lines: SubcontractBillLineInput[] = rows.flatMap((r) => {
    const q = parseMoneyInputAtScale((current[r.boq_item_id] ?? '').trim(), 3) ?? 0;
    return q > 0 ? [{ boqItemId: r.boq_item_id, quantity: q, rate: r.rate }] : [];
  });
  const amount = Math.round(lines.reduce((s, l) => s + l.quantity * l.rate, 0) * 100) / 100;
  const signature = JSON.stringify(lines);
  useEffect(() => {
    if (rows.length > 0) onChange(lines, amount);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `signature` stands for `lines`/`amount`; the callback identity is not a trigger
  }, [signature]);

  const edit = (id: string, code: string, raw: string) => {
    const typed = parseMoneyInputAtScale(raw.trim(), 3);
    const max = maxOf.get(id) ?? 0;
    if (typed !== null && milli(typed) > milli(max)) {
      setClamped(t('subcontract.bill.clamped', '{{code}} limited to {{max}}, the most still payable', { code, max: formatNumberExact(max) }));
      setQty({ ...current, [id]: String(max) });
      return;
    }
    setClamped(null);
    setQty({ ...current, [id]: raw });
  };

  if (position.isPending) return <ListState variant="loading" rows={2} loadingLabel={t('subcontract.bill.loading', 'Loading the BoQ lines…')} />;
  if (position.isError) {
    return <p role="alert" className="text-sm text-destructive-text">{t('subcontract.lines.loadError', 'Could not load the subcontract position.')}</p>;
  }

  if (rows.length === 0) return null;

  return (
    <div data-testid="subcontract-bill-lines" className="flex w-full flex-col gap-1.5">
      <p className="text-sm font-semibold text-muted-foreground">
        {t('subcontract.bill.title', 'Bill these BoQ lines (up to what is still payable)')}
      </p>
      <ul className="flex flex-col gap-1.5">
        {rows.map((r) => {
          const max = maxOf.get(r.boq_item_id) ?? 0;
          const words = max > 0 ? null : t('subcontract.cap.nothingPayable', '{{code}}: nothing payable — {{verified}} verified, {{po}} on the PO, {{billed}} already billed', {
            code: r.item_code, verified: formatNumberExact(r.verified), po: formatNumberExact(r.po_qty), billed: formatNumberExact(r.billed ?? 0),
          });
          return (
            <li key={r.boq_item_id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm">
              <label className="flex items-center gap-2">
                <span className="w-56 truncate"><span className="font-mono">{r.item_code}</span> <span className="text-muted-foreground">{r.description}</span></span>
                <input
                  type="text" inputMode="decimal" aria-label={`${r.item_code} ${r.description}`}
                  value={current[r.boq_item_id] ?? ''} disabled={max <= 0}
                  onChange={(e) => edit(r.boq_item_id, r.item_code, e.target.value)}
                  className="h-8 w-24 rounded-md border border-input bg-background px-2 text-right tabular-nums text-sm outline-none disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                />
                <span className="text-muted-foreground">{r.unit}</span>
              </label>
              <span className="text-sm text-muted-foreground tabular">
                {t('subcontract.bill.payable', 'payable {{max}} at {{rate}}', { max: formatNumberExact(max), rate: formatCurrency(r.rate, currency) })}
              </span>
              {words && <span className="text-sm text-muted-foreground">{words}</span>}
            </li>
          );
        })}
      </ul>
      <p role="status" className="min-h-4 text-sm font-medium text-warning-foreground">{clamped}</p>
      {error && <p role="alert" className="text-sm text-destructive-text">{error}</p>}
    </div>
  );
};
