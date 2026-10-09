#!/usr/bin/env python3
"""#956 cancel + re-issue read-only snapshots; retained filename, no amend calls.
Director runs under ERPNext + DB locks.

No environment-file access, dependencies, credential persistence, or mutation calls.
Authentication is entered without echo; only selected synthetic-fixture facts print.
"""
import argparse
import getpass
import json
import uuid
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

ERP = 'http://localhost:8080'
PMO = 'http://127.0.0.1:54321'


def read_json(base, path, headers, params=None):
    query = ('?' + urlencode(params)) if params else ''
    req = Request(base + path + query, headers=headers, method='GET')
    try:
        with urlopen(req, timeout=30) as response:
            return json.load(response)
    except HTTPError as error:
        # Do not print response bodies: they can contain connection information.
        raise SystemExit(f'Read failed: HTTP {error.code}; no PASS recorded') from None
    except (URLError, ValueError):
        raise SystemExit('Read unavailable or invalid JSON; no PASS recorded') from None


def pick(row, fields):
    return {field: row.get(field) for field in fields}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--phase', required=True, choices=[
        'original-submitted', 'original-cancelled', 'replacement-draft', 'replacement-submitted',
        'all-cancelled', 'flag-changed', 'next-invoice',
    ])
    args = parser.parse_args()
    project_id = str(uuid.UUID(input('Synthetic PMO project UUID: ').strip()))
    original_id = str(uuid.UUID(input('Original PMO invoice UUID (kept as cancelled history): ').strip()))
    new_id_input = input('NEW PMO invoice UUID (blank before re-issue): ').strip()
    new_id = str(uuid.UUID(new_id_input)) if new_id_input else None
    work_order_id = str(uuid.UUID(input('Synthetic PMO work-order UUID: ').strip()))
    old_name = input('Original ERP Sales Invoice name: ').strip()
    new_name = input('NEW ERP invoice name (blank before re-issue): ').strip()
    if not old_name:
        raise SystemExit('Original ERP name is required')
    if bool(new_id) != bool(new_name):
        raise SystemExit('Provide both NEW PMO UUID and ERP name, or leave both blank')
    if args.phase not in ('original-submitted', 'original-cancelled') and not new_id:
        raise SystemExit('This phase requires the NEW invoice UUID and ERP name')
    if new_id == original_id or (new_name and new_name == old_name):
        raise SystemExit('Cancel + re-issue requires distinct PMO UUIDs and ERP names')
    erp_headers = {'Authorization': getpass.getpass('Local bench authorization header: ')}
    pmo_headers = {
        'apikey': getpass.getpass('Local PMO API key: '),
        'Authorization': getpass.getpass('Local PMO authorization header: '),
    }
    result = {
        'phase': args.phase,
        'versions': read_json(ERP, '/api/method/frappe.utils.change_log.get_versions', erp_headers),
        'erp_documents': [],
    }
    for name in dict.fromkeys([old_name] + ([new_name] if new_name else [])):
        doc = read_json(ERP, '/api/resource/Sales%20Invoice/' + quote(name, safe=''), erp_headers)['data']
        facts = pick(doc, ['name', 'docstatus', 'amended_from', 'currency', 'net_total',
                          'total_taxes_and_charges', 'grand_total', 'rounded_total', 'outstanding_amount'])
        facts['taxes'] = [pick(row, ['charge_type', 'account_head', 'description', 'rate',
                                     'tax_amount', 'tax_amount_after_discount_amount', 'total',
                                     'included_in_print_rate']) for row in doc.get('taxes', [])]
        facts['items'] = [pick(row, ['item_code', 'qty', 'rate', 'net_amount']) for row in doc.get('items', [])]
        result['erp_documents'].append(facts)

    def pmo(table, fields, **filters):
        return read_json(PMO, '/rest/v1/' + table, pmo_headers,
                         {'select': fields, 'order': 'id.asc', **filters})

    result['project'] = pmo('projects', 'id,subject_to_vat,tax_rate,tax_base_numerator,tax_base_denominator', id='eq.' + project_id)
    mirror_fields = ('id,si_number,status,pmo_native,amount,tax_amount,tax_treatment,currency,'
                     'erp_docstatus,erp_outstanding_amount,erp_amended_from,erp_cancelled_at,work_order_id')
    result['original_mirror'] = pmo('sales_invoices', mirror_fields, id='eq.' + original_id)
    result['new_mirror'] = pmo('sales_invoices', mirror_fields, id='eq.' + new_id) if new_id else []
    if len(result['project']) != 1 or len(result['original_mirror']) != 1 or (new_id and len(result['new_mirror']) != 1):
        raise SystemExit('Required project/invoice read is incomplete; no PASS recorded')
    result['project_invoices'] = pmo('sales_invoices',
        'id,status,pmo_native,erp_docstatus,si_number,amount,tax_amount,tax_treatment',
        project_id='eq.' + project_id)
    claims = pmo('progress_claims', 'id,kind', project_id='eq.' + project_id)
    if len(claims) >= 1000 or len(result['project_invoices']) >= 1000:
        raise SystemExit('Project association read reached the REST row cap; paginate first')
    invoice_ids = [str(row['id']) for row in result['project_invoices']] + [str(row['id']) for row in claims]
    association = 'payload->>projectId.ilike.' + project_id
    if invoice_ids:
        association += ',pmo_record_id.in.(' + ','.join(invoice_ids) + ')'
    result['project_outbox_states'] = read_json(PMO, '/rest/v1/external_command_outbox', pmo_headers, {
        'select': 'operation,state', 'domain': 'eq.revenue',
        'payload->>erp_doc_kind': 'eq.sales-invoice', 'or': '(' + association + ')',
    })
    result['submitted_ar_sources'] = pmo('sales_invoices',
        'id,status,currency,erp_outstanding_amount', project_id='eq.' + project_id,
        status='in.(Submitted,Unpaid,Paid)')
    result['billed_work_sources'] = pmo('sales_invoice_work_billed',
        'id,status,currency,net,recovery,is_down_payment', project_id='eq.' + project_id,
        status='in.(Submitted,Unpaid,Paid)')
    # This view has work_order_id, not id; use its own ordering.
    result['work_order_billing'] = read_json(PMO, '/rest/v1/work_order_billing', pmo_headers, {
        'select': 'work_order_id,currency,order_net,invoiced,pending,remaining,figures_complete,line_count',
        'work_order_id': 'eq.' + work_order_id,
    })
    for label, record_id in [('original', original_id)] + ([('new', new_id)] if new_id else []):
        result[label + '_outbox_states'] = read_json(PMO, '/rest/v1/external_command_outbox', pmo_headers, {
            'select': 'operation,state', 'domain': 'eq.revenue', 'pmo_record_id': 'eq.' + record_id,
        })
    result['vat_changes'] = read_json(PMO, '/rest/v1/record_changes', pmo_headers, {
        'select': 'seq,created_at,changes', 'entity_type': 'eq.project',
        'entity_id': 'eq.' + project_id, 'changes': 'cs.' + json.dumps({'subject_to_vat': {}}),
        'order': 'seq.asc',
    })
    if any(len(value) >= 1000 for value in result.values() if isinstance(value, list)):
        raise SystemExit('Snapshot reached the REST row cap; paginate before asserting completeness')
    print(json.dumps(result, indent=2))
    print('Snapshot only. Apply the spike PASS criteria; successful reads are not a PASS.')


if __name__ == '__main__':
    main()
