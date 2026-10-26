import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { I18nextProvider } from 'react-i18next';
import '../index.css';
import { initI18n } from './lib/i18n';
import { AdministrationUsage } from '../pages/AdministrationUsage';
import { AgentCostMetrics, type AgentCostRunStatsRow, type AgentCostSummaryRow } from './components/admin/AgentCostMetrics';
import { TaskListBatchMatchReview, type TaskListProposal } from './components/integrations/TaskListBatchMatchReview';
import { Button, DataTable, DisclosureSummary } from './components/ui';
import type { OperatorUsageSummaryRow } from './lib/db/usage';

const months = ['2026-08', '2026-09', '2026-10'];
const actions = ['assistant.review', 'assistant.summary'];
const summaryRows: OperatorUsageSummaryRow[] = months.flatMap((month, monthIndex) => actions.map((action, actionIndex) => ({
  action,
  cached_tokens: 300 + monthIndex * 100 + actionIndex * 50,
  completion_tokens: 800 + monthIndex * 120 + actionIndex * 90,
  cost: 0.013 + monthIndex * 0.004 + actionIndex * 0.002,
  margin_usd: null,
  month,
  org_id: 'synthetic-workspace',
  owner_id: 'synthetic-operator',
  prompt_tokens: 1400 + monthIndex * 200 + actionIndex * 100,
  provider_cost_usd: null,
  reasoning_tokens: 130 + monthIndex * 20 + actionIndex * 15,
  run_count: 12 + monthIndex * 3 + actionIndex,
})));
const runStatsRows: AgentCostRunStatsRow[] = months.flatMap((month, monthIndex) => actions.map((action, actionIndex) => ({
  action,
  month,
  runs: 12 + monthIndex * 3 + actionIndex,
  avg_rounds: 1.4 + monthIndex * 0.1,
  p50_cost: 0.012 + monthIndex * 0.004 + actionIndex * 0.001,
  p95_cost: 0.04 + monthIndex * 0.01 + actionIndex * 0.004,
  max_cost: 0.06 + monthIndex * 0.01,
  cache_hit_pct: 25 + monthIndex * 7 + actionIndex * 3,
  p50_ms: 580 + monthIndex * 120,
  p95_ms: 1450 + monthIndex * 170,
})));
const summaryProjection: AgentCostSummaryRow[] = summaryRows.map((row) => ({
  prompt_tokens: row.prompt_tokens,
  completion_tokens: row.completion_tokens,
  cached_tokens: row.cached_tokens,
  reasoning_tokens: row.reasoning_tokens,
  cost: row.cost,
  month: row.month,
  action: row.action,
}));
const proposals: TaskListProposal[] = [
  { projectId: 'synthetic-project-1', projectName: 'North Office Renovation', list: { id: 'synthetic-list-1', name: 'North Office Renovation', space_name: 'Delivery', folder_name: 'Active' } },
  { projectId: 'synthetic-project-2', projectName: 'Harbor Access Upgrade', list: { id: 'synthetic-list-2', name: 'Harbor Access Upgrade', space_name: 'Delivery', folder_name: null } },
];

function SetupFlow() {
  const [open, setOpen] = useState(false);
  const [settled, setSettled] = useState(false);
  const tries = useRef(0);
  if (settled) {
    const columns = [
      { key: 'project', header: 'PMO project', kind: 'primary' as const, rowHeader: true, cell: (row: TaskListProposal) => row.projectName },
      { key: 'list', header: 'Configured ClickUp List', kind: 'text' as const, cell: (row: TaskListProposal) => row.list.name },
      { key: 'source', header: 'Initial task source', kind: 'text' as const, cell: () => 'Start with PMO tasks' },
    ];
    return (
      <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-8" data-testid="synthetic-configured-state">
        <p className="text-xs text-muted-foreground">Synthetic confirmation record — no external service or database write.</p>
        <h1 className="text-2xl font-bold tracking-tight">Configured ClickUp connections</h1>
        <details open className="group rounded-lg border border-border bg-card px-4">
          <DisclosureSummary className="py-2 font-semibold">View configured connections</DisclosureSummary>
          <div className="pb-3">
            <DataTable rows={proposals} columns={columns} rowKey={(row) => row.projectId} accessibleName="Configured ClickUp connections" tableId="evidence-configured-clickup" />
          </div>
        </details>
        <p role="status" className="rounded-md border border-border bg-card p-3 text-sm">Both clear matches are saved. Repeating setup does not ask for confirmed connections again.</p>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-8" data-testid="synthetic-setup-state">
      <p className="text-xs text-muted-foreground">Synthetic fixture — the ambiguous project is left outside this clear-match batch.</p>
      <h1 className="text-2xl font-bold tracking-tight">ClickUp project connections</h1>
      <div className="rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">One ambiguous match remains editable in the project table. The two clear matches below are selected together.</div>
      <Button variant="primary" className="min-h-11" onClick={() => setOpen(true)}>Accept all clear matches (2)</Button>
      {open && <TaskListBatchMatchReview
        open
        proposals={proposals}
        canConfirm
        onClose={() => { setOpen(false); if (tries.current >= 3) setSettled(true); }}
        onComplete={() => undefined}
        onConfirm={async (input) => {
          tries.current += 1;
          if (input.projectId === 'synthetic-project-2' && tries.current === 2) throw new Error('synthetic retryable failure');
        }}
      />}
    </main>
  );
}

function UsagePage() {
  return <main className="mx-auto max-w-5xl space-y-4 p-4 sm:p-8">
    <p className="text-xs text-muted-foreground">Synthetic aggregate values; no private conversation records are used.</p>
    <h1 className="text-2xl font-bold tracking-tight">Usage</h1>
    <AdministrationUsage
      rows={summaryRows}
      runStatsRows={runStatsRows}
      isPending={false}
      isError={false}
      onRetry={() => undefined}
      isStatsPending={false}
      isStatsError={false}
      onRetryStats={() => undefined}
    />
  </main>;
}

function MetricsOnly({ count }: { count: number }) {
  const rows = summaryProjection.filter((row) => count === 0 || months.slice(3 - count).includes(row.month));
  const stats = runStatsRows.filter((row) => count === 0 || months.slice(3 - count).includes(row.month));
  return <main className="mx-auto max-w-5xl space-y-4 p-4 sm:p-8">
    <p className="text-xs text-muted-foreground">Synthetic metric fixture · {count} valid month(s)</p>
    <h1 className="text-2xl font-bold tracking-tight">Diagnostics figure state</h1>
    <AgentCostMetrics summaryRows={rows} runStatsRows={stats} isPending={false} isError={false} onRetry={() => undefined} />
  </main>;
}

async function start() {
  const i18n = await initI18n();
  const params = new URLSearchParams(window.location.search);
  const locale = params.get('locale') === 'id' ? 'id' : 'en';
  const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
  document.documentElement.lang = locale;
  document.documentElement.classList.toggle('dark', theme === 'dark');
  await i18n.changeLanguage(locale);
  const view = params.get('view') ?? 'setup';
  const body = view === 'usage' ? <UsagePage /> : view.startsWith('metrics-')
    ? <MetricsOnly count={Number(view.slice('metrics-'.length))} />
    : <SetupFlow />;
  createRoot(document.getElementById('root')!).render(<I18nextProvider i18n={i18n}><BrowserRouter>{body}</BrowserRouter></I18nextProvider>);
}
void start();
