import { seedSession } from './seedSession';
import { need, ok } from './jobFixtures';

type Stage = 'rated' | 'submitted' | 'approved' | 'assembled' | 'prepared' | 'signedOff' | 'invoiced';
export async function prepareTmJourney(stage: Stage, fx: {
  projectId: string; engineerId: string; weekStart: string; documentId: string; itemCode: string;
}) {
  const finance = await seedSession('finance@acme.test');
  const rate = need('rate', await finance.rpc('save_contract_rate_line', { p_line: {
    project_id: fx.projectId, kind: 'labour', label: 'Field engineer', unit: 'hour', rate: 50_000,
    currency: 'IDR', effective_from: fx.weekStart, sales_item_code: fx.itemCode,
  } })) as { line_key: string };
  ok('rate assignee', await finance.rpc('set_contract_rate_assignee', {
    p_project: fx.projectId, p_line_key: rate.line_key, p_user: fx.engineerId, p_from: fx.weekStart, p_to: null,
  }));
  if (stage === 'rated') return;
  const engineer = await seedSession('tse-021-eng@acme.test');
  const sheetId = need('week', await engineer.rpc('save_timesheet_week', {
    p_timesheet_id: null, p_week_start_date: fx.weekStart,
    p_upserts: [{ project_id: fx.projectId, entry_date: fx.weekStart, hours: 8 }], p_delete_ids: [],
  })) as string;
  ok('submit week', await engineer.rpc('transition_timesheet', { p_timesheet_id: sheetId, p_to: 'Submitted' }));
  if (stage === 'submitted') return;
  const manager = await seedSession('pm@acme.test');
  ok('approve week', await manager.rpc('transition_timesheet', { p_timesheet_id: sheetId, p_to: 'Approved' }));
  if (stage === 'approved') return;
  const claimId = need('claim', await manager.rpc('assemble_tm_claim', { p_project: fx.projectId, p_from: fx.weekStart, p_to: fx.weekStart })) as string;
  if (stage === 'assembled') return;
  ok('prepare signoff', await manager.rpc('prepare_tm_signoff', { p_claim: claimId, p_document: fx.documentId }));
  if (stage === 'prepared') return;
  ok('confirm signoff', await finance.rpc('confirm_tm_signoff', { p_claim: claimId }));
  if (stage === 'signedOff') return;
  ok('invoice claim', await finance.rpc('create_native_tm_invoice', { p_claim: claimId }));
}
