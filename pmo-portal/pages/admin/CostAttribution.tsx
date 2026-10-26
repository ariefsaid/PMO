import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, ConfirmDialog, DataTable, SearchMini, StatusPill, Toolbar, useToast, type Column } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useProjectOptions } from '@/src/hooks/useFkOptions';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
import { formatDateOnly } from '@/src/lib/format';
import {
  endCostAttributionRule,
  listCostAttributionRules,
  type CostAttributionRule,
} from '@/src/lib/repositories/costAttribution';
import CostAttributionRuleForm from './CostAttributionRuleForm';
import { useRuleErrorCopy } from './useRuleErrorCopy';

/**
 * Administration › Accounting setup › Cost attribution (#1271, AC-7). Rules place ledger cost that has no ERP
 * project onto projects, read-side only. Finance and Admin manage (`can('manage','costAttribution')` is UX only —
 * the RPCs are the authority); the other roles that can open this read it.
 */
const QUERY_KEY = ['cost-attribution-rules'] as const;
const SEARCH = 'cost_search';
const STATUS = 'cost_status';
const SORT = 'cost_sort';

const todayIso = (): string => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const CostAttribution: React.FC = () => {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const canManage = usePermission()('manage', 'costAttribution');
  const { toast } = useToast();
  const qc = useQueryClient();
  const currency = useOrgCurrency();
  const projects = useProjectOptions();
  const toError = useRuleErrorCopy();
  const [form, setForm] = useState<{ rule: CostAttributionRule | null } | null>(null);
  const [ending, setEnding] = useState<CostAttributionRule | null>(null);
  const [selectedRuleKey, setSelectedRuleKey] = useState<string | null>(null);

  const rules = useQuery({ queryKey: QUERY_KEY, queryFn: () => listCostAttributionRules() });
  const reload = () => qc.invalidateQueries({ queryKey: QUERY_KEY });
  const end = useMutation({
    mutationFn: (rule: CostAttributionRule) => endCostAttributionRule(rule.rule_key, todayIso(), rule.version),
    onSuccess: reload,
  });

  const onEndConfirm = async () => {
    if (!ending) return;
    try {
      await end.mutateAsync(ending);
      toast(t('costAttribution:end.done', 'Rule ended'), ending.name, 'success');
    } catch (err) {
      const { headline, detail } = toError(err, 'update');
      toast(headline, detail, 'warning');
      void reload();
    }
    setEnding(null);
  };

  const matchText = (r: CostAttributionRule): string => [
    r.match_account_group
      ? t('costAttribution:list.group', 'Group {{name}}', { name: r.match_account_group })
      : t('costAttribution:list.account', 'Account {{name}}', { name: r.match_account }),
    r.match_cost_center && t('costAttribution:list.costCenter', 'cost centre {{name}}', { name: r.match_cost_center }),
    r.match_party && t('costAttribution:list.party', 'party {{name}}', { name: r.match_party }),
  ].filter(Boolean).join(' · ');

  const hasEnded = (r: CostAttributionRule) => !!r.effective_to && r.effective_to < todayIso();
  const params = new URLSearchParams(location.search);
  const search = params.get(SEARCH) ?? '';
  const statusValue = params.get(STATUS);
  const status = statusValue === 'active' || statusValue === 'ended' ? statusValue : 'all';
  const sort = params.get(SORT) === 'desc' ? 'desc' : 'asc';
  const isFiltered = Boolean(search.trim()) || status !== 'all' || sort !== 'asc';
  const patchQuery = (patch: Partial<Record<typeof SEARCH | typeof STATUS | typeof SORT, string>>) => {
    const next = new URLSearchParams(location.search);
    for (const [key, value] of Object.entries(patch)) {
      if (!value || value === 'all' || (key === SORT && value === 'asc')) next.delete(key);
      else next.set(key, value);
    }
    navigate({ pathname: location.pathname, search: next.toString() ? `?${next}` : '', hash: location.hash }, { replace: true });
  };
  const clearFilters = () => {
    const next = new URLSearchParams(location.search);
    [SEARCH, STATUS, SORT].forEach((key) => next.delete(key));
    navigate({ pathname: location.pathname, search: next.toString() ? `?${next}` : '', hash: location.hash }, { replace: true });
  };

  const columns: Column<CostAttributionRule>[] = [
    { key: 'name', header: t('costAttribution:list.name', 'Rule'), kind: 'primary', rowHeader: true, cell: (r) => r.name },
    {
      key: 'targets',
      header: t('costAttribution:list.targets', 'Goes to'),
      kind: 'text',
      cell: (r) => r.targets.map((x) => `${x.project_name} ${x.percent}%`).join(' · '),
    },
    {
      key: 'dates',
      header: t('costAttribution:list.dates', 'Posting dates'),
      kind: 'text',
      cell: (r) => {
        const from = formatDateOnly(r.effective_from);
        const range = !r.effective_to
          ? t('costAttribution:list.fromOpen', 'From {{from}}', { from })
          : t('costAttribution:list.range', '{{from}} to {{to}}', { from, to: formatDateOnly(r.effective_to) });
        return <div className="flex flex-wrap items-center gap-2">
          <span>{range}</span>
          <StatusPill variant={hasEnded(r) ? 'neutral' : 'open'}>
            {hasEnded(r) ? t('costAttribution:list.endedStatus', 'Ended') : t('costAttribution:list.active', 'Active')}
          </StatusPill>
        </div>;
      },
    },
    {
      key: 'match',
      header: t('costAttribution:list.match', 'Match'),
      kind: 'text',
      cell: (r) => <div className="space-y-1">
        <span className="hidden md:block">{matchText(r)}</span>
        <details className="md:hidden">
          <summary className="touch-target w-fit cursor-pointer underline decoration-border underline-offset-2">{t('costAttribution:list.match', 'Match')}</summary>
          <p className="mt-1 break-words">{matchText(r)}</p>
        </details>
        <details className="md:hidden">
          <summary className="touch-target w-fit cursor-pointer underline decoration-border underline-offset-2">{t('costAttribution:list.version', 'Version')}</summary>
          <p className="mt-1">v{r.version}</p>
        </details>
      </div>,
    },
    ...(canManage ? [{
      key: 'actions',
      header: <span className="sr-only">{t('costAttribution:list.actions', 'Actions')}</span>,
      kind: 'actions' as const,
      cell: (r: CostAttributionRule) => (
        <div className="flex flex-wrap justify-end gap-1">
          <Button variant="ghost" size="sm" aria-label={t('costAttribution:list.edit', 'Edit {{name}}', { name: r.name })}
            onClick={() => setForm({ rule: r })}>{t('costAttribution:list.editShort', 'Edit')}</Button>
          {!hasEnded(r) && (
            <Button variant="ghost" size="sm" aria-label={t('costAttribution:list.end', 'End {{name}}', { name: r.name })}
              onClick={() => setEnding(r)}>{t('costAttribution:list.endShort', 'End')}</Button>
          )}
        </div>
      ),
    }] : []),
  ];

  const data = rules.data ?? [];
  const term = search.trim().toLocaleLowerCase(i18n.resolvedLanguage ?? i18n.language);
  const visibleRules = data.filter((rule) => {
    if (status === 'active' && hasEnded(rule)) return false;
    if (status === 'ended' && !hasEnded(rule)) return false;
    return !term || [rule.name, matchText(rule), ...rule.targets.map((target) => target.project_name)]
      .some((value) => value.toLocaleLowerCase(i18n.resolvedLanguage ?? i18n.language).includes(term));
  }).sort((a, b) => {
    const compared = a.name.localeCompare(b.name, i18n.resolvedLanguage ?? i18n.language, { sensitivity: 'base' });
    return sort === 'desc' ? -compared : compared;
  });
  const filteredEmpty = isFiltered && visibleRules.length === 0;
  const state = rules.isPending ? 'loading' : rules.isError ? 'error' : visibleRules.length === 0 ? 'empty' : undefined;
  const selectedRule = data.find((rule) => rule.rule_key === selectedRuleKey) ?? null;
  const openAdd = () => setForm({ rule: null });

  return (
    <section id="cost-attribution" tabIndex={-1} className="scroll-mt-4" aria-label={t('costAttribution:title', 'Cost attribution')}>
      {(data.length > 0 || isFiltered) && <Toolbar standalone>
        <SearchMini
          placeholder={t('costAttribution:list.searchPlaceholder', 'Search rules and projects…')}
          aria-label={t('costAttribution:list.searchLabel', 'Search cost attribution rules')}
          value={search}
          onChange={(event) => patchQuery({ [SEARCH]: event.target.value })}
          containerClassName="min-h-11 max-sm:basis-full max-sm:w-full max-sm:min-w-0"
        />
        <label htmlFor="cost-attribution-status" className="sr-only">{t('costAttribution:list.statusLabel', 'Filter rules by status')}</label>
        <select
          id="cost-attribution-status"
          aria-label={t('costAttribution:list.statusLabel', 'Filter rules by status')}
          className="min-h-11 min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground"
          value={status}
          onChange={(event) => patchQuery({ [STATUS]: event.target.value })}
        >
          <option value="all">{t('costAttribution:list.allStatuses', 'All statuses')}</option>
          <option value="active">{t('costAttribution:list.active', 'Active')}</option>
          <option value="ended">{t('costAttribution:list.endedStatus', 'Ended')}</option>
        </select>
        <Button variant="outline" className="min-h-11" aria-pressed={sort === 'desc'}
          onClick={() => patchQuery({ [SORT]: sort === 'asc' ? 'desc' : 'asc' })}>
          {sort === 'asc' ? t('costAttribution:list.sortAsc', 'Rule name A–Z') : t('costAttribution:list.sortDesc', 'Rule name Z–A')}
        </Button>
        {isFiltered && visibleRules.length > 0 && <Button variant="ghost" className="min-h-11" onClick={clearFilters}>{t('costAttribution:list.clear', 'Clear filters')}</Button>}
        {canManage && data.length > 0 && <Button className="min-h-11" onClick={openAdd}>{t('costAttribution:add', 'Add rule')}</Button>}
      </Toolbar>}
      <div className="mt-3.5">
        <DataTable
          tableId="cost-attribution-rules"
          rows={visibleRules}
          columns={columns}
          rowKey={(r) => r.rule_key}
          rowLabel={(rule) => t('costAttribution:details.openRule', 'View details for {{name}}', { name: rule.name })}
          onActivate={(rule) => setSelectedRuleKey(rule.rule_key)}
          accessibleName={t('costAttribution:title', 'Cost attribution')}
          state={state}
          emptyTitle={filteredEmpty
            ? t('costAttribution:empty.noMatches', 'No rules match these filters')
            : t('costAttribution:empty.title', 'No cost attribution rules yet')}
          emptySub={filteredEmpty
            ? t('costAttribution:empty.clearHelp', 'Clear filters to see all cost attribution rules.')
            : canManage
              ? t('costAttribution:empty.sub', 'Add a rule to place untagged ledger cost, such as payroll, onto projects.')
              : t('costAttribution:empty.readOnly', 'Finance and Admin can add rules.')}
          emptyAction={filteredEmpty
            ? { label: t('costAttribution:list.clear', 'Clear filters'), onClick: clearFilters }
            : canManage ? { label: t('costAttribution:add', 'Add rule'), onClick: openAdd } : undefined}
          errorTitle={t('costAttribution:error.load', "Couldn't load cost attribution rules")}
          errorSub={t('admin.loadErrorSub', 'The request failed. Check your connection and try again.')}
          onRetry={() => void rules.refetch()}
        />
      </div>

      {selectedRule && <section className="mt-4 space-y-3 border-t border-border pt-4" role="region"
        aria-label={t('costAttribution:details.title', 'Details for {{name}}', { name: selectedRule.name })}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-bold tracking-[-0.01em]">{selectedRule.name}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{selectedRule.targets.map((target) => `${target.project_name} ${target.percent}%`).join(' · ')}</p>
          </div>
          <Button variant="ghost" className="min-h-11" onClick={() => setSelectedRuleKey(null)}>{t('costAttribution:details.close', 'Close details')}</Button>
        </div>
        <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-muted-foreground">{t('costAttribution:list.match', 'Match')}</dt><dd className="break-words">{matchText(selectedRule)}</dd></div>
          <div><dt className="text-muted-foreground">{t('costAttribution:list.dates', 'Posting dates')}</dt><dd>{formatDateOnly(selectedRule.effective_from)}{selectedRule.effective_to ? ` – ${formatDateOnly(selectedRule.effective_to)}` : ''}</dd></div>
          <div><dt className="text-muted-foreground">{t('costAttribution:list.version', 'Version')}</dt><dd>v{selectedRule.version}</dd></div>
          <div><dt className="text-muted-foreground">{t('costAttribution:list.status', 'Status')}</dt><dd>{hasEnded(selectedRule) ? t('costAttribution:list.endedStatus', 'Ended') : t('costAttribution:list.active', 'Active')}</dd></div>
        </dl>
      </section>}

      {form && (
        <CostAttributionRuleForm
          rule={form.rule}
          projects={projects.data ?? []}
          currency={currency}
          onClose={() => setForm(null)}
          onChanged={() => void reload()}
        />
      )}

      <ConfirmDialog
        open={!!ending}
        tone="destructive"
        title={ending ? t('costAttribution:end.title', 'End {{name}}?', { name: ending.name }) : ''}
        description={t('costAttribution:end.description', 'It stops applying to cost posted after today. Cost already attributed stays attributed.')}
        confirmLabel={t('costAttribution:end.confirm', 'End rule')}
        loading={end.isPending}
        onConfirm={onEndConfirm}
        onCancel={() => setEnding(null)}
      />
    </section>
  );
};

export default CostAttribution;
