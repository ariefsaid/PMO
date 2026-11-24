# Open list: lane stock (1124d)

Items that need a product decision, or were built with a stated limit.

1. **Counted difference per work order.** Count documents are per location and normally carry no work order, so the material completion shows a counted difference only for count documents that name the work order. Decision needed: attribute site counts to work orders (for example by the work order a location serves), or leave the column as it is.
2. **"Sent to the supplier" is the move to Ordered.** The order needed-by gate is on the move to `Ordered` (where the PO number is minted). If the organisation also means a separate "email the PO" step, say so; the gate would move there.
3. **Issue handover with a work order but no project.** Issues always carry a project (database rule), so scope `transfers_and_issues` covers every issue; there is no separate work-order-only issue.
4. **Pgtap, e2e and screenshots were not run in this session** (no Docker, shared stack not available here): the three pgTAP files `2100`, `2101`, `2102` and the mutation checks listed in each spec are written and left for the orchestrator's one run.
