/**
 * Parsers for the ULS web interface.
 *
 * Kept pure and separate from the browser driver so they can be tested against
 * captured markup. Scraper breakage is otherwise invisible: a parse that
 * silently returns nothing looks exactly like an application with no preference
 * list, and both produce "no competition" on the site.
 */

/** One entry on an applicant's ranked preference list. */
export interface VanityPreference {
  seq: number;
  call: string;
}

const CALL_RE = /^[AKNW][A-Z]?\d[A-Z]{1,3}$/;

/**
 * Extracts the ranked vanity preference list from `applServiceSpecific.jsp`.
 *
 * ULS renders it as a 5x5 grid of `N.&nbsp;CALLSIGN` cells covering slots 1-25,
 * filled column-first, with empty slots present but blank:
 *
 * ```html
 * <td width="20%">1.&nbsp;N3HM </td> <td width="20%">&nbsp;&nbsp;6.&nbsp;WA6V </td>
 * <td width="20%">2.&nbsp;N6ER </td> <td width="20%">&nbsp;&nbsp;7.&nbsp;</td>
 * ```
 *
 * The search is anchored to the "Vanity Call Sign Change" heading because the
 * surrounding page carries other numbered content — question numbers on the
 * form, dates, an FRN — and an unanchored scan picks those up as slot numbers.
 *
 * Returns an empty list rather than throwing when the section is absent: ULS
 * genuinely serves that page with an empty grid for some applications, so a
 * blank result is a real answer and not necessarily a failure. The caller
 * distinguishes the two by whether the anchor was found at all.
 */
export function parseVanityPreferences(html: string): {
  found: boolean;
  preferences: VanityPreference[];
} {
  const anchor = html.search(/Vanity\s*Call\s*Sign\s*Change/i);
  if (anchor === -1) return { found: false, preferences: [] };

  // Stop at the end of the enclosing section so a later table cannot contribute
  // cells. "Return to the Top" is the page's own footer marker.
  const tail = html.slice(anchor);
  const end = tail.search(/Return\s*to\s*the\s*Top|<\/body/i);
  const region = end === -1 ? tail : tail.slice(0, end);

  const bySeq = new Map<number, string>();
  // Each cell is its own <td>, which keeps a missing callsign from letting the
  // next slot number pair with the previous slot's value.
  for (const cell of region.match(/<td[^>]*>[\s\S]*?<\/td>/gi) ?? []) {
    const text = cell
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;?/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const m = /^(\d{1,2})\.\s*([A-Z0-9]+)$/.exec(text);
    if (!m) continue;
    const seq = Number(m[1]);
    const call = m[2].toUpperCase();
    if (seq < 1 || seq > 25) continue;
    if (!CALL_RE.test(call)) continue;
    // First writer wins: the grid lists each slot once, and a duplicate means
    // the region bled into other markup.
    if (!bySeq.has(seq)) bySeq.set(seq, call);
  }

  return {
    found: true,
    preferences: [...bySeq.entries()]
      .map(([seq, call]) => ({ seq, call }))
      .sort((a, b) => a.seq - b.seq),
  };
}

/**
 * Pulls application rows out of a ULS search results page.
 *
 * Used for the discovery pass — "every pending vanity application" — which
 * returns filings that have not reached the bulk export yet. Columns are
 * position-dependent: #, file number, call sign, name, FRN, purpose, radio
 * service, receipt date, status.
 */
export interface UlsSearchRow {
  fileNumber: string;
  applicantCall: string;
  name: string;
  frn: string;
  purpose: string;
  radioService: string;
  receiptDate: string | null;
  status: string;
}

export function parseSearchResults(html: string): UlsSearchRow[] {
  const out: UlsSearchRow[] = [];
  for (const row of html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = [...(row.match(/<td[^>]*>[\s\S]*?<\/td>/gi) ?? [])].map((c) =>
      c
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;?/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    );
    if (cells.length < 9) continue;
    // The leading cell is a row number; its presence is what distinguishes a
    // result row from the header and from layout tables.
    if (!/^\d+$/.test(cells[0])) continue;
    if (!/^\d{10}$/.test(cells[1])) continue;
    out.push({
      fileNumber: cells[1],
      applicantCall: cells[2],
      name: cells[3],
      frn: cells[4],
      purpose: cells[5],
      radioService: cells[6],
      receiptDate: usToIso(cells[7]),
      status: cells[8],
    });
  }
  return out;
}

function usToIso(s: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim());
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}
