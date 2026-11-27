import { seedSession } from './seedSession';
import { need, ok } from './jobFixtures';
import { orgToday } from './jobJourney';

type Stage = 'issued' | 'prepared' | 'confirmed' | 'billed' | 'requested' | 'approved' | 'revised';
export async function prepareSubcontractJourney(stage: Stage, fx: { poId: string; purchaseId: string; boqItemId: string; docId: string }) {
  const pm = await seedSession('pm@acme.test');
  ok('PO lines', await pm.rpc('set_subcontract_po_lines', { p_po_id: fx.poId, p_lines: [{ boq_item_id: fx.boqItemId, quantity: 100, rate: 100_000, unit: 'm3' }] }));
  ok('issue PO lines', await pm.rpc('issue_subcontract_po_lines', { p_po_id: fx.poId }));
  if (stage === 'issued') return;
  const acceptanceId = need('prepare acceptance', await pm.rpc('prepare_subcontract_acceptance', { p_po_id: fx.poId, p_acceptance_date: orgToday(), p_document_id: fx.docId, p_lines: [{ boq_item_id: fx.boqItemId, quantity: 120 }] }));
  if (stage === 'prepared') return;
  const finance = await seedSession('finance@acme.test');
  ok('confirm acceptance', await finance.rpc('confirm_subcontract_acceptance', { p_id: acceptanceId }));
  if (stage === 'confirmed') return;
  ok('first bill', await finance.rpc('capture_subcontract_vendor_invoice', {
    p_procurement_id: fx.purchaseId, p_status: 'Received', p_invoice_date: orgToday(), p_amount: 10_000_000, p_tax_treatment: 'exclusive', p_tax_amount: 0,
    p_lines: [{ boq_item_id: fx.boqItemId, quantity: 100, rate: 100_000 }],
  }));
  if (stage === 'billed') return;
  const variationId = need('variation', await finance.rpc('request_po_variation', { p_po_id: fx.poId, p_origin: 'post_work', p_reason: 'Verified additional concrete placement', p_lines: [{ boq_item_id: fx.boqItemId, additional_quantity: 20 }] }));
  if (stage === 'requested') return;
  const executive = await seedSession('exec@acme.test');
  ok('approve variation', await executive.rpc('decide_po_variation', { p_id: variationId, p_approve: true }));
  if (stage === 'approved') return;
  ok('issue revision', await finance.rpc('issue_po_revision', { p_variation_id: variationId }));
}
