export const procurementKeys = {
  all: (orgId: string | undefined) => ['procurements', orgId] as const,
  byVendor: (orgId: string | undefined, vendorId: string | undefined) => ['procurements', orgId, 'by-vendor', vendorId] as const,
};
