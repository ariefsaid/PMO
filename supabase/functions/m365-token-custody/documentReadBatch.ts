// documentReadBatch.ts — server-generated, read-only batch envelopes for controlled-file checks.
// No caller-authored path, headers, body, dependencies, or Graph content route crosses this seam.

import type { HandlerResult } from "./types.ts";
import type { GraphReadSession } from "./graphRead.ts";

const MAX_BATCH_SIZE = 20;
const ITEM_METADATA_SELECT =
  "id,name,webUrl,parentReference,file,folder,cTag,sharepointIds";

export interface DocumentReadReference {
  drive_id: string;
  item_id: string;
}

export async function readDocumentMetadataBatch(
  session: GraphReadSession,
  refs: DocumentReadReference[],
): Promise<HandlerResult> {
  if (
    !Array.isArray(refs) || refs.length < 1 || refs.length > MAX_BATCH_SIZE ||
    refs.some((ref) =>
      !ref || !isIdentity(ref.drive_id) || !isIdentity(ref.item_id)
    )
  ) {
    return {
      status: 400,
      body: {
        error: "BAD_REQUEST",
        message: "Cannot read these document items.",
      },
    };
  }

  const requests = refs.map((ref, index) => ({
    id: String(index + 1),
    url: `/drives/${encodeURIComponent(ref.drive_id)}/items/${
      encodeURIComponent(ref.item_id)
    }?$select=${ITEM_METADATA_SELECT}`,
  }));
  return await session.batch(requests);
}

function isIdentity(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 &&
    !/[\u0000-\u001f\u007f]/u.test(value);
}
