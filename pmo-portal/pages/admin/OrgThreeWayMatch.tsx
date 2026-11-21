import React, { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/src/auth/usePermission';
import { Button, FieldError, ListState, NumberField, Switch } from '@/src/components/ui';
import { cn } from '@/src/components/ui/cn';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { parseMoneyInputAtScale } from '@/src/lib/format';
import { useSaveThreeWayMatchSettings, useThreeWayMatchHeldCount, useThreeWayMatchSettings } from '@/src/hooks/useMatchSettingsAndLines';

const parseTolerance = (raw: string): number | null => {
  const n = parseMoneyInputAtScale(raw.trim(), 2);
  return n !== null && n >= 0 && n <= 100 ? n : null;
};

/**
 * #2634 (FR-TWM-010/015, D-TWM-10/15): the organisation's three-way match — on or off, and the quantity and amount
 * tolerance. Anyone who can open Administration sees the saved setting; only an Admin changes it. UX gate only:
 * `set_three_way_match_settings` is the authority (Admin only, audited). Off until an Admin saves it. Switching it off
 * releases every held bill, so the screen names how many are held now before the Admin saves.
 */
export default function OrgThreeWayMatch() {
  const { t } = useTranslation();
  const canManage = usePermission()('manage', 'threeWayMatchSettings');
  const labelId = useId();
  const query = useThreeWayMatchSettings();
  const save = useSaveThreeWayMatchSettings();
  const saved = query.data ?? null;
  const [enabled, setEnabled] = useState(false);
  const [quantity, setQuantity] = useState('0');
  const [amount, setAmount] = useState('0');
  const [tried, setTried] = useState(false);
  useEffect(() => {
    setEnabled(saved?.enabled === true);
    setQuantity(String(Number(saved?.quantityTolerancePct ?? 0)));
    setAmount(String(Number(saved?.amountTolerancePct ?? 0)));
  }, [saved?.enabled, saved?.quantityTolerancePct, saved?.amountTolerancePct]);

  const heldCount = useThreeWayMatchHeldCount(canManage && saved?.enabled === true);
  const switchingOff = saved?.enabled === true && !enabled;
  const held = heldCount.data ?? 0;
  const qtyValue = parseTolerance(quantity);
  const amtValue = parseTolerance(amount);
  const toleranceError = t('procurement:threeWayMatchSettings.toleranceError', 'Enter a percentage from 0 to 100 with at most 2 decimal places.');
  const dirty = enabled !== (saved?.enabled === true) || qtyValue !== Number(saved?.quantityTolerancePct ?? 0) || amtValue !== Number(saved?.amountTolerancePct ?? 0);
  const saveError = save.isError ? classifyMutationError(save.error, {
    '42501': t('procurement:threeWayMatchSettings.refusedRole', 'Only an Admin can change the three-way match.'),
  }) : null;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (qtyValue === null || amtValue === null) return;
    save.reset();
    save.mutate({ enabled, quantityTolerancePct: qtyValue, amountTolerancePct: amtValue }, { onSuccess: () => setTried(false) });
  };

  return (
    <section aria-labelledby="three-way-match-heading" data-testid="org-three-way-match">
      <h2 id="three-way-match-heading" tabIndex={-1} className="scroll-mt-4 text-group font-semibold">
        {t('procurement:threeWayMatchSettings.heading', 'Three-way match')}
      </h2>
      <div className="mt-3 max-w-md">
        {query.isError ? <ListState variant="error" title={t('procurement:threeWayMatchSettings.loadError', 'Couldn’t load the three-way match setting')} onRetry={() => void query.refetch()} />
          : query.isPending ? <ListState variant="loading" rows={3} />
          : (
            <form onSubmit={onSubmit} noValidate className="space-y-3">
              <label className={cn('flex min-h-11 items-start gap-3 py-1.5 text-control', canManage ? 'cursor-pointer' : 'cursor-default')}>
                <Switch checked={enabled} onChange={setEnabled} labelledBy={labelId} disabled={!canManage || save.isPending} className="mt-0.5" />
                <span className="min-w-0">
                  <span id={labelId} className="block font-medium">{t('procurement:threeWayMatchSettings.switch', 'Check vendor bills against the order and receipts before payment')}</span>
                  <span className="block text-muted-foreground">{t('procurement:threeWayMatchSettings.switchHelp', 'Bills recorded before you switch this on are not matched.')}</span>
                </span>
              </label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <NumberField id="twm-quantity-tolerance" label={t('procurement:threeWayMatchSettings.quantityTolerance', 'Quantity tolerance (%)')}
                  value={quantity} onChange={setQuantity} disabled={!canManage || save.isPending}
                  error={tried && qtyValue === null ? toleranceError : undefined}
                  helper={t('procurement:threeWayMatchSettings.quantityHelp', 'How far billed quantity may exceed received or ordered quantity.')} />
                <NumberField id="twm-amount-tolerance" label={t('procurement:threeWayMatchSettings.amountTolerance', 'Amount tolerance (%)')}
                  value={amount} onChange={setAmount} disabled={!canManage || save.isPending}
                  error={tried && amtValue === null ? toleranceError : undefined}
                  helper={t('procurement:threeWayMatchSettings.amountHelp', 'How far a rate or the bill total may exceed the order.')} />
              </div>
              {switchingOff && held > 0 && (
                <p role="status" data-testid="three-way-match-held-notice" className="text-control text-warning-foreground">
                  {t('procurement:threeWayMatchSettings.heldNotice', { count: held, defaultValue_one: '{{count}} bill is held now. Switching the match off releases its hold.', defaultValue_other: '{{count}} bills are held now. Switching the match off releases their holds.' })}
                </p>
              )}
              {canManage
                ? <Button type="submit" variant="primary" disabled={!dirty || save.isPending} loading={save.isPending}>{t('procurement:threeWayMatchSettings.save', 'Save')}</Button>
                : <p className="text-control text-muted-foreground">{t('procurement:gates.onlyAdmin', 'Only an Admin can change this.')}</p>}
              <p role="status" className="min-h-5 text-control text-muted-foreground">
                {save.isSuccess && !dirty ? t('procurement:threeWayMatchSettings.saved', 'Saved') : ''}
              </p>
              {saveError && <FieldError>{saveError.detail || saveError.headline}</FieldError>}
            </form>
          )}
      </div>
    </section>
  );
}
