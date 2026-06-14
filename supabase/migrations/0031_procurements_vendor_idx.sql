-- 0031 — index procurements.vendor_id (hot-path for the company-detail "related procurement" read)
--
-- intent-fix-wave IF-D added `listProcurementsByVendor(vendorId)` (a `.eq('vendor_id', …)`
-- SELECT surfaced on every Vendor company-detail page). `procurements` indexed only
-- org_id, (org_id,status), project_id, requested_by_id — vendor_id was unindexed, so the
-- new read did a per-org seq-scan + filter. This mirrors the existing `projects_client_idx`
-- that already covers the sibling `listProjectsByClient` path (Part B "indexes for hot paths").
create index if not exists procurements_vendor_idx on procurements (vendor_id);
