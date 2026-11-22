import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, TextField, useToast } from '@/src/components/ui';
import { useCreatePlan, useSavePlanLine } from '@/src/hooks/useImprest';
import type { PlanSeedLine } from '@/src/lib/imprest/planSeed';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatMonthYearShort, parseMoneyInputAtScale } from '@/src/lib/format';

/**
 * The plan editor, started from the open purchase requests (cash-advance-estimate, FR-CAE-007): one editable amount per purpose.
 * Saving goes through the existing plan path (create a Draft plan, save its lines): no new write, no approval change.
 */
export const PlanSeedEditor: React.FC<{ floatId: string; month: string; seed: PlanSeedLine[]; onDone: (planId: string | null) => void }> = ({ floatId, month, seed, onDone }) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const create = useCreatePlan();
  const saveLine = useSavePlanLine();
  const [amounts, setAmounts] = useState<Record<string, string>>(() => Object.fromEntries(seed.map((l) => [l.category, String(l.amount)])));
  const [removed, setRemoved] = useState<string[]>([]);
  const lines = seed.filter((l) => !removed.includes(l.category));
  const parsed = lines.map((l) => ({ category: l.category, amount: parseMoneyInputAtScale(amounts[l.category] ?? '', 2) }));
  const valid = parsed.length > 0 && parsed.every((p) => p.amount !== null && p.amount > 0);
  const busy = create.isPending || saveLine.isPending;

  const save = async () => {
    let planId: string;
    try { planId = await create.mutateAsync({ floatId, month }); }
    catch (err) { const { headline, detail } = classifyMutationError(err); toast(headline, detail, 'warning'); return; }
    let failed = 0;
    for (const p of parsed) {
      try { await saveLine.mutateAsync({ planId, category: p.category, amount: p.amount as number }); }
      catch { failed += 1; }
    }
    if (failed === 0) toast(t('imprest:open.created', 'Draft plan created from the open requests'), undefined, 'success');
    else toast(t('imprest:open.partial', 'Draft plan created, but {{count}} line(s) were not saved. Add them in the plan.', { count: failed }), undefined, 'warning');
    onDone(planId);
  };

  return (
    <div className="space-y-3 border-b border-border px-[var(--panel-inset)] pb-4" data-testid="plan-seed-editor">
      <h3 className="pt-[var(--panel-inset)] text-sm font-semibold text-foreground">
        {t('imprest:open.editorTitle', 'New plan for {{month}}, from the open requests', { month: formatMonthYearShort(month) })}
      </h3>
      <p className="text-control text-muted-foreground">{t('imprest:open.editorHelp', 'Change or remove any amount. Nothing is saved until you create the draft; you submit it for approval as usual.')}</p>
      <ul className="space-y-2">
        {lines.map((l) => (
          <li key={l.category} className="flex flex-wrap items-end gap-2">
            <TextField label={budgetCategoryLabel(l.category, t)} inputMode="decimal" value={amounts[l.category] ?? ''}
              onChange={(v) => setAmounts((a) => ({ ...a, [l.category]: v }))} />
            <Button variant="ghost" size="sm" aria-label={t('imprest:plan.removeLine', 'Remove {{category}}', { category: budgetCategoryLabel(l.category, t) })}
              onClick={() => setRemoved((r) => [...r, l.category])}>{t('imprest:plan.remove', 'Remove')}</Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" disabled={!valid || busy} onClick={() => void save()}>{t('imprest:open.createDraft', 'Create draft plan')}</Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => onDone(null)}>{t('imprest:open.discard', 'Discard')}</Button>
        {!valid && <span className="text-control text-muted-foreground">{t('imprest:open.invalid', 'Every amount must be more than zero.')}</span>}
      </div>
    </div>
  );
};
