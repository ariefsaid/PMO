import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/src/auth/usePermission';
import { Button, FieldError, ListState, SelectField, useToast } from '@/src/components/ui';
import { useBuiltInRolesEnabled } from '@/src/hooks/useBuiltInRoles';
import { useBuiltInRoleName } from '@/src/hooks/useOrgRoleNames';
import { useJobRoleOptions } from '@/src/hooks/useJobRoleOptions';
import { useOrderJobRoles, useOrderJobRolesMutation } from '@/src/hooks/useOrderJobRoles';
import { useRefusalLine } from '@/src/lib/refusals';

/** Who orders is never a field (light) account, so the picker offers managers and officers only. */
const ORDER_TIERS = ['manager', 'officer'] as const;

/**
 * Administration › Accounting: the built-in roles whose holders may also raise and send purchase orders (roles-that-decide
 * FR-RTD-009/011). Today's levels always can; with no role named nothing changes. The database holds every rule
 * (po_set_order_job_roles, the settings trigger, actor_may_order_purchases); this screen only offers the choice.
 */
export default function OrderJobRolesSection() {
  const { t } = useTranslation('procurement');
  const { toast } = useToast();
  const refusal = useRefusalLine();
  const canManage = usePermission()('manage', 'orgAccounting');
  const builtInOn = useBuiltInRolesEnabled().data === true;
  const query = useOrderJobRoles();
  const save = useOrderJobRolesMutation();
  const roleName = useBuiltInRoleName();
  const allOptions = useJobRoleOptions(t('orderRoles.choose', 'Choose a built-in role'), ORDER_TIERS);

  const [keys, setKeys] = useState<string[] | null>(null);
  const [pick, setPick] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setKeys(null); }, [query.data]);
  const current = useMemo(() => keys ?? query.data ?? [], [keys, query.data]);
  const dirty = keys !== null;
  const options = useMemo(() => allOptions.filter((o) => !current.includes(o.value)), [allOptions, current]);
  // A control that cannot be used says why: not an Admin, or built-in roles are off.
  const addBlocked = !canManage
    ? t('orderRoles.onlyAdmin', 'Only an Admin can change this.')
    : !builtInOn
      ? t('orderRoles.turnOn', 'Turn on built-in roles in Administration > People > Built-in roles to name roles that can order.')
      : null;

  const onSave = async () => {
    setError(null);
    try {
      await save.mutateAsync(current);
      toast(t('orderRoles.saved', 'Who can order purchases saved'), undefined, 'success');
    } catch (err) { setError(refusal(err)); }
  };

  return (
    <section aria-labelledby="order-roles-heading" data-testid="order-job-roles">
      <h2 id="order-roles-heading" className="text-group font-semibold">{t('orderRoles.heading', 'Who can order purchases')}</h2>
      <p className="mt-1 text-control text-muted-foreground">
        {t('orderRoles.subline', 'Admin, Executive, Project Manager and Finance can always order. Name built-in roles whose holders may also raise and send purchase orders, for approved purchases only.')}
      </p>
      <div className="mt-4 max-w-xl space-y-3">
        {query.isError ? (
          <ListState variant="error" title={t('orderRoles.loadError', 'Couldn’t load who can order purchases')} onRetry={() => void query.refetch()} />
        ) : query.isPending ? (
          <ListState variant="loading" rows={2} />
        ) : (
          <>
            {current.length === 0 ? (
              <p className="text-control text-muted-foreground">{t('orderRoles.none', 'No built-in role is named, so only the access levels above can order.')}</p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {current.map((key) => (
                  <li key={key} className="flex min-h-11 items-center justify-between gap-3 px-3 py-2 text-control">
                    <span className="font-medium">{roleName(key)}</span>
                    {canManage && (
                      <Button variant="ghost" size="sm" disabled={save.isPending}
                        aria-label={t('orderRoles.removeNamed', 'Remove {{role}}', { role: roleName(key) })}
                        onClick={() => setKeys(current.filter((k) => k !== key))}>
                        {t('orderRoles.remove', 'Remove')}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-control text-muted-foreground">
              {t('orderRoles.heldOnlyNote', 'Only people who hold a named built-in role can order. An access level alone is not enough, even when the role is built on it.')}
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <SelectField label={t('orderRoles.add', 'Add a built-in role')} value={pick} onChange={setPick} options={options}
                disabled={addBlocked !== null || save.isPending} helper={addBlocked ?? undefined} wrapperClassName="min-w-0 flex-1" fullWidth />
              {addBlocked === null && (
                <Button variant="outline" disabled={!pick || save.isPending} onClick={() => { setKeys([...current, pick]); setPick(''); }}>
                  {t('orderRoles.addButton', 'Add')}
                </Button>
              )}
            </div>
            {canManage && (
              <div className="flex items-center gap-3 pt-1">
                <Button variant="primary" onClick={() => void onSave()} loading={save.isPending} disabled={!dirty || save.isPending}>
                  {t('orderRoles.save', 'Save')}
                </Button>
              </div>
            )}
            {error && <FieldError>{error}</FieldError>}
          </>
        )}
      </div>
    </section>
  );
}
