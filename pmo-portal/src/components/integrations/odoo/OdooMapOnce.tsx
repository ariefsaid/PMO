/**
 * The map-once screen (AC-ODC-096, FR-ODC-061/090): PMO proposes the account defaults, the unit map and the default warehouse
 * from the mirrored Odoo records; the admin checks them, picks only where PMO could not decide, and accepts everything in
 * one step. A row nobody has decided blocks only itself. The server re-checks every id (`set_odoo_org_config`).
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, ListState, SelectField, StatusPill } from '@/src/components/ui';
import { DEFAULT_TYPES } from '@/src/lib/adapterSeam/odoo/configProposal';
import { useOdooConfigProposal, useOdooConnection, useOdooSetup } from '@/src/hooks/useOdoo';
import { odooErrorMessage } from './odooErrors';

const ACCOUNT_KEYS = Object.keys(DEFAULT_TYPES);
const ACCOUNT_LABELS: Record<string, [string, string]> = {
  payable: ['payable', 'Payable account'], receivable: ['receivable', 'Receivable account'], bank: ['bank', 'Bank account'], cash: ['cash', 'Cash account'],
  expense: ['expense', 'Expense account'], stock_valuation: ['stockValuation', 'Stock valuation account'], stock_consumption: ['stockConsumption', 'Stock consumption account'],
};
const WAREHOUSE = 'default_warehouse_id';

export function OdooMapOnce() {
  const { t } = useTranslation();
  const read = useOdooConnection().data;
  const ready = read?.status === 'active' && read.activated;
  const proposal = useOdooConfigProposal(Boolean(ready));
  const save = useOdooSetup('save-defaults');
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const p = proposal.data;

  // What each row holds now: the person's pick, else a saved choice that is still active, else PMO's single proposal.
  const values = useMemo(() => {
    if (!p) return {} as Record<string, string>;
    const stale = new Set(p.attention);
    const proposed = new Map(p.proposals.map((x) => [x.key, 'value' in x ? x.value : '']));
    const saved: Record<string, string> = {
      ...Object.fromEntries(Object.entries(p.current.account_defaults).map(([k, v]) => [`account_defaults.${k}`, v])),
      ...Object.fromEntries(Object.entries(p.current.unit_map).map(([k, v]) => [`unit_map.${k}`, v])),
      ...(p.current.default_warehouse_id ? { [WAREHOUSE]: p.current.default_warehouse_id } : {}),
    };
    const keys = [...ACCOUNT_KEYS.map((k) => `account_defaults.${k}`), ...p.units.map((u) => `unit_map.${u.unit}`), WAREHOUSE];
    return Object.fromEntries(keys.map((key) => [key, picked[key] ?? (key in saved && !stale.has(key) ? saved[key] : proposed.get(key) ?? '')]));
  }, [p, picked]);

  if (!ready) return null;
  if (proposal.isPending) return <ListState variant="loading" rows={3} />;
  if (proposal.isError || !p) {
    return <ListState variant="error" title={t('administration:odoo.mapOnce.loadFailed', 'The suggested settings could not be loaded')} onRetry={() => void proposal.refetch()} retryLabel={t('administration:odoo.mapOnce.retry', 'Retry')} />;
  }

  const stale = new Set(p.attention);
  const candidatesOf = (key: string) => { const x = p.proposals.find((y) => y.key === key); return x && 'candidates' in x ? x.candidates : null; };
  const accountOptions = (k: string) => {
    const offered = candidatesOf(`account_defaults.${k}`);
    return p.accounts
      // by type: a group or off-balance account matches no default
      .filter((a) => DEFAULT_TYPES[k].includes(a.type ?? '') && (offered === null || offered.length === 0 || offered.includes(a.id) || a.id === values[`account_defaults.${k}`]))
      .map((a) => ({ value: a.id, label: [a.code, a.name].filter(Boolean).join(' ') }));
  };
  const asOptions = (list: Array<{ id: string; name: string; code?: string | null }>) => list.map((x) => ({ value: x.id, label: [x.code, x.name].filter(Boolean).join(' ') }));
  const pick = (key: string) => (v: string) => { setSaved(false); setPicked((s) => ({ ...s, [key]: v })); };
  const choose = t('administration:odoo.mapOnce.choose', 'Choose…');

  const row = (key: string, label: string, options: Array<{ value: string; label: string }>, hint?: string) => {
    const value = options.some((o) => o.value === values[key]) ? values[key] : '';
    return (
      <div key={key} className="min-w-0">
        <SelectField label={label} value={value} onChange={pick(key)} options={options} placeholder={choose} fullWidth />
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {stale.has(key) && <StatusPill variant="warn">{t('administration:odoo.mapOnce.attention', 'Needs attention')}</StatusPill>}
          {stale.has(key) && <span>{t('administration:odoo.mapOnce.attentionHint', 'No longer active in Odoo. Choose another.')}</span>}
          {!stale.has(key) && !value && <span>{hint ?? t('administration:odoo.mapOnce.chooseOne', 'Choose one')}</span>}
        </p>
      </div>
    );
  };

  // What would be saved: only rows that hold a value, grouped as the server stores them.
  const entries = (prefix: string) => Object.fromEntries(Object.entries(values).filter(([k, v]) => k.startsWith(prefix) && v).map(([k, v]) => [k.slice(prefix.length), v]));
  const accountDefaults = entries('account_defaults.');
  const unitMap = entries('unit_map.');
  const warehouse = values[WAREHOUSE];
  const changed = (now: Record<string, string>, before: Record<string, string>) => Object.entries(now).some(([k, v]) => before[k] !== v);
  const dirty = changed(accountDefaults, p.current.account_defaults) || changed(unitMap, p.current.unit_map) || (Boolean(warehouse) && warehouse !== p.current.default_warehouse_id);
  const input = {
    ...(Object.keys(accountDefaults).length ? { account_defaults: accountDefaults } : {}),
    ...(Object.keys(unitMap).length ? { unit_map: unitMap } : {}),
    ...(warehouse ? { default_warehouse_id: warehouse } : {}),
  };
  const accept = async () => {
    setError(null); setSaved(false);
    try { await save.mutateAsync(input); setSaved(true); } catch (err) { setError(odooErrorMessage(t, err)); }
  };

  const fieldset = 'min-w-0 space-y-2 border-0 p-0';
  const legend = 'mb-1 text-sm font-semibold text-foreground';
  const grid = 'grid grid-cols-1 gap-3 sm:grid-cols-2';
  return (
    <Card className="mt-3 p-4" data-testid="odoo-map-once">
      <h4 className="text-sm font-semibold text-foreground">{t('administration:odoo.mapOnce.title', 'Map once')}</h4>
      <p className="mt-0.5 text-sm text-muted-foreground">{t('administration:odoo.mapOnce.intro', 'PMO matched what it could from Odoo. Check the choices, pick where it could not decide, then accept everything at once.')}</p>

      <div className="mt-3 space-y-4">
        <fieldset className={fieldset}>
          <legend className={legend}>{t('administration:odoo.mapOnce.accounts', 'Accounts')}</legend>
          <div className={grid}>
            {ACCOUNT_KEYS.map((k) => row(`account_defaults.${k}`, t(`administration:odoo.mapOnce.account.${ACCOUNT_LABELS[k][0]}`, ACCOUNT_LABELS[k][1]), accountOptions(k)))}
          </div>
        </fieldset>

        <fieldset className={fieldset}>
          <legend className={legend}>{t('administration:odoo.mapOnce.units', 'Units')}</legend>
          {p.units.length === 0
            ? <p className="text-sm text-muted-foreground">{t('administration:odoo.mapOnce.noUnits', 'No units are used in PMO yet.')}</p>
            : <p className="text-sm text-muted-foreground">{t('administration:odoo.mapOnce.unitsHint', 'Match each unit PMO uses to an Odoo unit. A unit left unmatched blocks nothing for now.')}</p>}
          <div className={grid}>
            {p.units.map((u) => row(`unit_map.${u.unit}`, t('administration:odoo.mapOnce.unit', 'Unit "{{unit}}"', { unit: u.unit }), asOptions(p.uoms),
              t('administration:odoo.mapOnce.unitNotMatched', 'Unit "{{unit}}" is not matched yet', { unit: u.unit })))}
          </div>
        </fieldset>

        <fieldset className={fieldset}>
          <legend className={legend}>{t('administration:odoo.mapOnce.warehouse', 'Warehouse')}</legend>
          <div className={grid}>
            {row(WAREHOUSE, t('administration:odoo.mapOnce.warehouseLabel', 'Default receiving warehouse'), asOptions(p.warehouses))}
          </div>
        </fieldset>
      </div>

      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
      {saved && !error && <p role="status" className="mt-3 text-sm text-muted-foreground">{t('administration:odoo.mapOnce.saved', 'Saved.')}</p>}
      <div className="mt-3">
        <Button size="sm" loading={save.isPending} disabled={!dirty} onClick={() => void accept()}>{t('administration:odoo.mapOnce.acceptAll', 'Accept all')}</Button>
      </div>
    </Card>
  );
}
