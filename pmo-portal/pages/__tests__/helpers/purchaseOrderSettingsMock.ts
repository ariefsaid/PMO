// Shared stub for `@/src/hooks/usePurchaseOrderSettings` (#2688).
//
// The procurement page and ledger suites render without a QueryClient (or without an authenticated session), so the
// purchase-order print setting read is stubbed off here — as for an org that never turned printing on. The hook's own
// suite and the settings-section suite unmock it and exercise the real query; the ledger/detail print-action tests
// register their own value over this stub.
export const PO_SETTINGS_QUERY_KEY = 'purchase-order-settings';

const DISABLED = { enabled: false, signatureBlocks: [], authorisedCollectors: [] };

export const usePurchaseOrderSettings = () => ({
  data: DISABLED,
  isError: false,
  isPending: false,
});

export const usePurchaseOrderSettingsMutations = () => ({
  setSettings: {
    mutateAsync: async () => undefined,
    mutate: () => undefined,
    isPending: false,
    isSuccess: false,
    isError: false,
    error: null,
    reset: () => undefined,
  },
});
