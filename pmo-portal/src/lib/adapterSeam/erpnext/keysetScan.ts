/**
 * erpnext/keysetScan.ts — the ONE bounded, resumable walk over a live ERPNext list that both the ledger
 * mirror feed and the doctype sweep use (THEME-DATA-03, ADP-016/018).
 *
 * ERPNext list rows move: an update sets `modified = now()`, so an already-read row jumps to the end of
 * a `modified asc` listing. An OFFSET walk (`limit_start`) then skips the row after it, and a cursor of
 * `modified` alone re-reads the same tie group forever once one instant ties more rows than a tick's
 * page budget. This walk pages by the composite `(modified, name)` KEYSET instead: it resumes strictly
 * after the last row read. Frappe filters AND together, so "after (m, n)" is two reads — the rest of the
 * `modified = m` tie group (`name > n`), then `modified > m` — and a tie group of any size drains by
 * `name` across ticks.
 *
 * The persisted cursor is `modified|name`. `modified` is a fixed-width Frappe datetime with no `|`, so
 * string order of the cursor is the composite order (the watermark tables compare these as text), and a
 * legacy bare-timestamp cursor sorts before every composite of the same instant and is read INCLUSIVELY.
 *
 * Pure + Deno-importable; the caller supplies the page read, so each module keeps its own Frappe
 * vocabulary (doctype, fields, envelope validation) and a malformed page simply throws out of `read`
 * before anything is returned — a scan never advances on an incomplete result.
 */

const CURSOR_SEP = '|';

export const formatKeysetCursor = (modified: string, name: string): string => `${modified}${CURSOR_SEP}${name}`;

export function parseKeysetCursor(since: string): { modified: string; name: string | null } {
  const i = since.indexOf(CURSOR_SEP);
  return i < 0 ? { modified: since, name: null } : { modified: since.slice(0, i), name: since.slice(i + 1) };
}

export interface KeysetRow { name: string; modified: string }

export interface KeysetScanOpts<R extends KeysetRow> {
  /** The persisted cursor (composite or legacy bare timestamp); null/undefined/'' = from the beginning. */
  since?: string | null;
  pageSize: number;
  /** Maximum DATA pages (non-empty reads) in one call; an empty probe is free. */
  maxPages: number;
  /** Reads one page: the caller's scope filters plus `extra` (the keyset bounds), ordered
   *  `modified asc, name asc`, at most `pageSize` rows. Must throw on a malformed response. */
  read: (extra: Array<[string, string, string]>) => Promise<R[]>;
}

export interface KeysetScanResult<R> {
  rows: R[];
  /** False = the page budget ended on a full page; resume from `cursor`. */
  caughtUp: boolean;
  /** Composite cursor of the last row read, or null if none was read (keep the stored one). */
  cursor: string | null;
}

export async function scanByKeyset<R extends KeysetRow>(opts: KeysetScanOpts<R>): Promise<KeysetScanResult<R>> {
  const { pageSize, maxPages, read } = opts;
  const rows: R[] = [];
  const result = (caughtUp: boolean): KeysetScanResult<R> => {
    const last = rows[rows.length - 1];
    return { rows, caughtUp, cursor: last ? formatKeysetCursor(last.modified, last.name) : null };
  };

  const start = opts.since ? parseKeysetCursor(opts.since) : null;
  // `tail` = the last row read: drain its tie group (same `modified`, greater `name`) before moving on.
  let tail: { modified: string; name: string } | null = start?.name != null ? { modified: start.modified, name: start.name } : null;
  let strictAfter: string | null = tail ? tail.modified : null; // `modified >` bound once the tie group is drained
  let inclusiveFrom: string | null = start && start.name == null ? start.modified : null; // a legacy bare cursor
  let dataPages = 0;
  for (;;) {
    if (tail) {
      const group = await read([['modified', '=', tail.modified], ['name', '>', tail.name]]);
      if (group.length > 0) {
        rows.push(...group);
        dataPages += 1;
        const last = group[group.length - 1]!;
        tail = { modified: last.modified, name: last.name };
        strictAfter = tail.modified;
        // A full tie page may have more behind it; a short one has drained the instant, but the later
        // instants are only read if budget remains.
        if (dataPages >= maxPages) return result(false);
        if (group.length === pageSize) continue;
      }
    }
    const next = await read(strictAfter !== null ? [['modified', '>', strictAfter]] : inclusiveFrom !== null ? [['modified', '>=', inclusiveFrom]] : []);
    inclusiveFrom = null;
    if (next.length === 0) return result(true);
    rows.push(...next);
    dataPages += 1;
    if (next.length < pageSize) return result(true);
    if (dataPages >= maxPages) return result(false);
    const last = next[next.length - 1]!;
    tail = { modified: last.modified, name: last.name };
    strictAfter = tail.modified;
  }
}
