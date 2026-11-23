-- Rollback of 1903: the 23 added keys go, back to the 16 of 1491. A rename saved under an added key is removed first
-- (it cannot outlive its key; the foreign key would refuse the delete otherwise).
delete from public.org_terminology where term_key in (
  'serviceRequest','purchaseOrder','dailySiteReport','surveyQuantity','quantityChangeRequest','workOrderTransfer',
  'billingPlan','billingStep','handoverCertificate','stockTransfer','stockReceipt','stockReturn','reservation',
  'crew','roster','issue','checkpoint','milestone','dailyTarget','rootCause','safetyRecordType',
  'candidateWorkOrder','closeOut');
delete from public.org_term_keys where term_key in (
  'serviceRequest','purchaseOrder','dailySiteReport','surveyQuantity','quantityChangeRequest','workOrderTransfer',
  'billingPlan','billingStep','handoverCertificate','stockTransfer','stockReceipt','stockReturn','reservation',
  'crew','roster','issue','checkpoint','milestone','dailyTarget','rootCause','safetyRecordType',
  'candidateWorkOrder','closeOut');
