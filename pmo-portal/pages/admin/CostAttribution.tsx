import React, { useState } from 'react';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, ConfirmDialog, DataTable, useToast, type Column } from '@/src/components/ui';
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

const todayIso = (): string => format(new Date(), 'yyyy-MM-dd');

const CostAttribution: React.FC = () => {
  const { t } = useTranslation();
  const canManage = usePermission()('manage', 'costAttribution');
  const { toast } = useToast();
  const qc = useQueryClient();
  const currency = useOrgCurrency();
  const projects = useProjectOptions();
  const toError = useRuleErrorCopy();
  const [form, setForm] = useState<{ rule: CostAttributionRule | null } | null>(null);
  const [ending, setEnding] = useState<CostAttributionRule | null>(null);

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

  const columns: Column<CostAttributionRule>[] = [
    { key: 'name', header: t('costAttribution:list.name', 'Rule'), kind: 'primary', rowHeader: true, cell: (r) => r.name },
    { key: 'match', header: t('costAttribution:list.match', 'Match'), kind: 'text', cell: matchText },
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
        if (!r.effective_to) return t('costAttribution:list.fromOpen', 'From {{from}}', { from });
        const range = t('costAttribution:list.range', '{{from}} to {{to}}', { from, to: formatDateOnly(r.effective_to) });
        return hasEnded(r) ? `${range} · ${t('costAttribution:list.ended', 'ended')}` : range;
      },
    },
    { key: 'version', header: t('costAttribution:list.version', 'Version'), kind: 'number', cell: (r) => `v${r.version}` },
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
  const state = rules.isPending ? 'loading' : rules.isError ? 'error' : data.length === 0 ? 'empty' : undefined;
  const openAdd = () => setForm({ rule: null });

  return (
    <section id="cost-attribution" tabIndex={-1} className="scroll-mt-4" aria-label={t('costAttribution:title', 'Cost attribution')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{t('costAttribution:title', 'Cost attribution')}</h2>
        {canManage && data.length > 0 && <Button size="sm" onClick={openAdd}>{t('costAttribution:add', 'Add rule')}</Button>}
      </div>
      <p className="mt-1 text-[13px] text-muted-foreground">
        {t('costAttribution:description', 'Places ledger cost that has no ERP project onto projects, for example payroll. It is shown as attributed, apart from cost tagged in the ERP, and nothing is written to the ERP.')}
      </p>
      <div className="mt-3.5">
        <DataTable
          tableId="cost-attribution-rules"
          rows={data}
          columns={columns}
          rowKey={(r) => r.rule_key}
          accessibleName={t('costAttribution:title', 'Cost attribution')}
          state={state}
          emptyTitle={t('costAttribution:empty.title', 'No cost attribution rules yet')}
          emptySub={canManage
            ? t('costAttribution:empty.sub', 'Add a rule to place untagged ledger cost, such as payroll, onto projects.')
            : t('costAttribution:empty.readOnly', 'Finance and Admin can add rules.')}
          emptyAction={canManage ? { label: t('costAttribution:add', 'Add rule'), onClick: openAdd } : undefined}
          errorTitle={t('costAttribution:error.load', "Couldn't load cost attribution rules")}
          errorSub={t('admin.loadErrorSub', 'The request failed. Check your connection and try again.')}
          onRetry={() => void rules.refetch()}
        />
      </div>

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
