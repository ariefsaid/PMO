# Project invoice attribution repair

Use this maintenance operation only when an authorized local operator needs to repair historical ERP invoice attribution.

1. Send one authenticated request to the existing ERPNext sweep function with JSON body:

   ```json
   {"mode":"repair-invoice-projects","org_id":"<org-uuid>","after_id":null}
   ```

2. If the response has `done: false`, send the next request with its returned `nextCursor` as `after_id`. Continue one batch at a time until `done: true`.
3. If a response has `ok: false` or lists `failedIds`, retry using the **unchanged input cursor**. Do not skip failed candidates by advancing the cursor.
4. Review the final `unresolved` count and resolve any remaining attribution through the normal Finance/Admin workflow. Confirm the expected invoice/project links in the PMO read model.

The operation is bounded to one batch per request, reads ERP documents only for invoices missing stored project provenance, and never creates invoices or writes attribution back to ERP. Keep credentials and actual organization identifiers out of tracked examples and logs.
