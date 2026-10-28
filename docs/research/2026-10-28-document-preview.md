# Document preview research

## Question

Can PMO preview SharePoint/OneDrive files and uploaded files in the app, and what Graph permission and tenant consent would this require beyond the current M365 connection?

## Answer

- Yes for work or school SharePoint and OneDrive files: Graph `driveItem: preview` returns an embeddable URL for the file.
- The least-privileged delegated permission is `Files.Read`; PMO's standard connection already requests `Files.Read`, `Files.Read.All`, and `Sites.Read.All`.
- No additional Graph scope or preview-specific tenant approval is indicated; the caller still needs access to the file, and tenant policy may require admin consent.
- Graph preview URLs are short-lived and caller-bound; Microsoft publishes no fixed TTL, so fetch one when opening the preview and request a replacement after expiry.
- For uploads, use a private Supabase Storage object and a short-lived signed URL; preview PDFs, images, audio, or video with browser-native elements and offer download for unsupported types.

## Graph capability

**Endpoint.** Call `POST /v1.0/drives/{driveId}/items/{itemId}/preview` (or the equivalent `/sites/{siteId}/drive/items/{itemId}/preview`). The response can contain `getUrl` for an iframe or `postUrl` plus form parameters. The API is for SharePoint and OneDrive for Business; it does not support personal Microsoft accounts.

**Permission and consent.** For delegated work or school accounts, Microsoft lists `Files.Read` as the least-privileged permission. Higher delegated permissions include `Files.Read.All` and `Sites.Read.All`; application access instead requires `Files.Read.All`. PMO's standard delegated connection requests `Files.Read`, `Files.Read.All`, and `Sites.Read.All`, and its organization approval URL includes that same Graph read set. Therefore preview adds no Graph permission or separate tenant approval when the connection's stored grant includes `Files.Read`. Microsoft marks these delegated read permissions as not inherently requiring admin consent, though a tenant's consent policy may require an administrator. The signed-in user's own file access remains part of the authorization boundary.

**File types and limits.** Microsoft 365 preview supports common Office documents, PDFs, images, and media such as MP4, but actual support varies by service, tenant policy, client, and file type. The Graph API reference does not publish a fixed file-size limit or URL lifetime. Treat unsupported-file and preview-service errors as normal fallbacks.

**URL expiry and handling.** Microsoft describes the returned URL as short-lived and says to obtain a fresh URL when one expires; the API reference does not specify a fixed TTL. The URL is intended for the caller's own use and should not be shared: anyone who can access it acts with the calling identity's permissions. Request it just in time, keep it ephemeral, avoid logging it, and do not use it as a durable file identifier.

## Uploaded files

Keep uploaded documents in a private Supabase Storage bucket. After the normal access check, create a signed URL with `createSignedUrl(path, expiresInSeconds)`; the URL grants time-limited access, and private-bucket downloads remain subject to Storage access policies. Set or preserve the correct content type so the browser can select its native viewer.

- PDF: use an iframe or object viewer when the browser supports it.
- Images: render with an image element.
- Audio and video: use the browser's audio or video element for supported codecs and formats.
- Plain text: show as escaped text when appropriate.
- Office documents and other formats without browser-native rendering: offer download or open externally; a signed Storage URL does not itself provide an Office previewer.

Choose an expiry long enough for a viewing session but short enough to limit URL exposure, and mint a new URL after it expires. Do not store signed URLs as document identifiers.

## Gap vs PMO's current scopes

PMO's standard M365 authorization requests delegated `Files.Read`, `Files.Read.All`, and `Sites.Read.All`; its callback stores the scopes Microsoft actually grants. That covers the Graph preview permission requirement, so there is no scope gap when the stored grant includes `Files.Read`. The remaining product work is to add a server-mediated preview operation and an iframe experience that fetches a fresh URL for the current caller. The optional `Sites.Selected` reconnect path is for record-folder creation and is not required for preview.

## Sources

- [Microsoft Graph v1.0: driveItem preview](https://learn.microsoft.com/en-us/graph/api/driveitem-preview?view=graph-rest-1.0)
- [Microsoft Graph permissions reference](https://learn.microsoft.com/en-us/graph/permissions-reference)
- [Microsoft Graph permissions overview](https://learn.microsoft.com/en-us/graph/permissions-overview)
- [Microsoft Learn: Preview files in your app](https://learn.microsoft.com/en-us/sharepoint/dev/embedded/build/preview-files)
- [Supabase Storage: Serving downloads and signed URLs](https://supabase.com/docs/guides/storage/serving/downloads)
- [Supabase Storage: Bucket fundamentals](https://supabase.com/docs/guides/storage/buckets/fundamentals)
- [Supabase JavaScript: createSignedUrl](https://supabase.com/docs/reference/javascript/file-buckets-createsignedurl)
- [Supabase Storage: Standard uploads and content types](https://supabase.com/docs/guides/storage/uploads/standard-uploads)

DONE: research document-preview
