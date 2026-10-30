// Shared stub for `@/src/hooks/useProcurementFiles` in tests that render the whole ProcurementDetails page
// (the Timeline's file cells read it, which otherwise needs a QueryClient). Usage, at the start of a line:
//   vi.mock('@/src/hooks/useProcurementFiles', () => import('@/pages/__tests__/helpers/procurementFilesMock'));
export const useProcurementFiles = () => ({
  list: { data: [], isPending: false, isError: false },
  upload: { mutate: () => undefined, isPending: false },
  archive: { mutate: () => undefined, isPending: false },
  download: async () => 'https://signed/url',
  progress: null,
  uploadError: null,
  cancelUpload: () => undefined,
  clearUploadError: () => undefined,
});
