# Odoo client invoices and receipts

This runbook records the minimum setup exercised by the client-invoice suites. It is not a release-readiness checklist.

## Service user

The tested minimum Odoo group set is **Billing** and **Access Rights**. Billing permits the invoice and receipt calls; Access Rights is needed to read and create the stock external identifiers used for safe retry recovery. Access Rights is an elevated grant, so an owner must review it before a live connection is enabled. The bed did not require the Accountant group.

## Receipt setup

In PMO's Odoo setup checklist, select a live bank or cash journal that has an inbound payment method. The default journal can be overridden for an individual receipt.

For client-withheld tax, select a live account belonging to the activated Odoo company with account type **Current Assets** or **Prepayments**, and leave it in the company's currency. The receipt writes the withheld difference to that configured tax-prepaid account; cash received plus withheld amount must equal the amount settled, and the withholding slip number is required.

## Tax documents and money writes

The C7 tax-document finding is pending owner review. e-Faktur number and date remain a manual PMO record; this runbook makes no claim that Odoo-held tax-document facts are available.

Odoo invoice and receipt writes pass through PMO's revenue outbox and are confirmed from Odoo read-back. A posted Odoo invoice or receipt is not removed by test cleanup.
