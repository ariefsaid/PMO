import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Badge, Button, DataTable, GateNotice, Icon, ListPage, ListState, SearchMini, StatusPill, type Column,
} from '@/src/components/ui';
import { CanWrite, usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useJournalLedgerSetup, useJournals } from '@/src/hooks/useJournals';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
import { useOrgToday } from '@/src/hooks/useOrgToday';
import { formatDay, formatExactMoney } from '@/src/lib/format';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import { monthOf } from '@/src/lib/journals/journalRange';
import type { JournalDetail, JournalListRow } from '@/src/lib/db/journals';
import { JournalDrawer } from './journals/JournalDrawer';
import { JournalFormModal } from './journals/JournalFormModal';
import { journalKindLabel } from './journals/journalWords';
import { DateField } from '@/src/components/ui/DateField';

const rowKey = (r: JournalListRow) => (r.id ? `pmo:${r.id}` : `ledger:${r.ledger_name ?? ''}:${r.date}`);

/**
 * Manual journals (#895): the desk's own journals and the ledger moves made outside PMO, for one date range
 * (default: this organisation month). A Finance-or-above member drafts; a second one approves. The RPCs decide.
 */
const JournalsPage: React.FC = () => {
  const { t } = useTranslation('journals');
  const today = useOrgToday();
  const [range, setRange] = useState(() => monthOf(today));
  const { data, isPending, isError, refetch } = useJournals(range.from, range.to);
  const setup = useJournalLedgerSetup().data;
  const currency = useOrgCurrency();
  const currentUserId = useAuth().currentUser?.id ?? null;
  const { realRole, effectiveRole } = useEffectiveRole();
  const viewOnly = effectiveRole !== realRole;
  const may = usePermission();
  const [selected, setSelected] = useState<JournalListRow | null>(null);
  const [openedById, setOpenedById] = useState(false);
  const [form, setForm] = useState<{ draft?: JournalDetail } | null>(null);
  const [search, setSearch] = useState('');
  const all = useMemo(() => data ?? [], [data]);
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter((r) => [r.memo, r.ledger_name, r.kind ? journalKindLabel(t, r.kind) : null].some((v) => v?.toLowerCase().includes(q)));
  }, [all, search, t]);
  const canCreate = !viewOnly && may('create', 'journal');

  const openJournal = (id: string) => {
    setOpenedById(true);
    setSelected({ origin: 'pmo', id, kind: null, date: today, memo: null, status: 'draft', ledger_name: null, total: '0.00' });
  };

  const columns: Column<JournalListRow>[] = [
    { key: 'memo', header: t('journals:list.memo', 'Memo'), cell: (r) => <span className="font-medium">{r.memo ?? r.ledger_name ?? '—'}</span>,
      exportValue: (r) => r.memo ?? '' },
    { key: 'date', header: t('journals:list.date', 'Date'), cell: (r) => formatDay(r.date), exportValue: (r) => r.date },
    { key: 'kind', header: t('journals:form.kind', 'Kind'),
      cell: (r) => (r.origin === 'outside-pmo' ? <Badge>{t('journals:list.outside', 'Outside PMO')}</Badge> : journalKindLabel(t, r.kind)) },
    { key: 'ledger', header: t('journals:detail.ledgerRef', 'Ledger reference'), cell: (r) => (r.ledger_name ? <span className="tabular-nums">{r.ledger_name}</span> : '—'),
      exportValue: (r) => r.ledger_name ?? '' },
    { key: 'total', header: t('journals:list.total', 'Total'), align: 'num',
      cell: (r) => <span className="tabular-nums">{formatExactMoney(r.total, currency, getNumberLocale(), { trimZeroFraction: true }) ?? r.total}</span>, exportValue: (r) => r.total },
    { key: 'status', header: t('journals:list.status', 'Status'), cell: (r) => (
      <span className="block">
        <StatusPill record="journal" state={r.status} />
        {r.status === 'held' && r.held_reason && <span className="mt-1 block text-muted-foreground">{r.held_reason}</span>}
      </span>
    ) },
  ];

  return (
    <ListPage
      desktopToolbarClassName="md:!items-end"
      title={t('journals:list.title', 'Journals')}
      count={data ? rows.length : undefined} total={data ? all.length : undefined}
      primaryAction={canCreate ? <CanWrite entity="journal" action="create">
        <Button variant="primary" onClick={() => setForm({})}>
          <Icon name="plus" />
          {t('journals:actions.new', 'New journal')}
        </Button>
      </CanWrite> : undefined}
      filters={<div className="grid w-full gap-3 sm:w-auto sm:grid-cols-2">
        <DateField label={t('journals:list.from', 'From')} value={range.from} max={range.to}
          onChange={(v) => { if (v) setRange((r) => ({ ...r, from: v })); }} />
        <DateField label={t('journals:list.to', 'To')} value={range.to} min={range.from}
          onChange={(v) => { if (v) setRange((r) => ({ ...r, to: v })); }} />
      </div>}
      search={<SearchMini placeholder={t('journals:list.searchPlaceholder', 'Search journals…')} aria-label={t('journals:list.searchAria', 'Search journals')}
        value={search} onChange={(e) => setSearch(e.target.value)}
        searchSurface="journals-list" module="journals" resultCount={rows.length}
        containerClassName="max-sm:basis-full max-sm:w-full max-sm:min-w-0 sm:ml-auto" />}
    >
      {setup?.needs_desk_journal && <GateNotice variant="blocked" className="mb-3">
        <Icon name="info" />
        <span>{t('journals:setup.needsDeskJournal', 'An Admin must choose the Odoo journal for desk entries in Odoo setup before journals can post.')}</span>
      </GateNotice>}
      {isPending && <ListState variant="loading" shape="table" rows={4} />}
      {!isPending && (isError || !data) && (
        <ListState variant="error" title={t('journals:list.error', "Couldn't load journals")}
          sub={t('journals:list.errorSub', 'The request failed. Check your connection and try again.')} onRetry={() => void refetch()} />
      )}
      {!isPending && !isError && data && (
        <DataTable<JournalListRow> rows={rows} columns={columns} rowKey={rowKey}
          onActivate={(r) => { setOpenedById(false); setSelected(r); }}
          rowLabel={(r) => t('journals:list.rowLabel', 'Open {{memo}}', { memo: r.memo ?? r.ledger_name ?? '' })}
          state={rows.length === 0 ? 'empty' : undefined}
          emptyTitle={search.trim() ? t('journals:list.noMatch', 'No journals match this search') : t('journals:list.empty', 'No journals in these dates')}
          emptyAction={canCreate && !search.trim() ? { label: t('journals:actions.new', 'New journal'), onClick: () => setForm({}) } : undefined}
          emptyActionVariant="outline"
          tableId="journals-table" />
      )}
      {selected && !form && <JournalDrawer row={selected} currency={currency} currentUserId={currentUserId} viewOnly={viewOnly} today={today} placeholder={openedById}
        onClose={() => setSelected(null)} onEdit={(draft) => setForm({ draft })} onOpenJournal={openJournal} />}
      {form && <JournalFormModal draft={form.draft} currency={currency} today={today} onClose={() => setForm(null)}
        onDone={(id) => { setForm(null); openJournal(id); }} />}
    </ListPage>
  );
};
export default JournalsPage;
