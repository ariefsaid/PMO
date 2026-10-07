/** Saves a Blob as a file through a transient object URL. Shared by table exports and the invoice PDF (#912). */
export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next task: some browsers start the download asynchronously after click().
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
