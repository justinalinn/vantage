import { describe, it, expect } from 'vitest';
import { parseVanityPreferences, parseSearchResults } from './parse';

/**
 * Markup captured from ULS on 2026-08-18, application 16069584 (K6CRS).
 * Trimmed to the section that matters, structure otherwise verbatim.
 */
const SERVICE_SPECIFIC = `
<tr><td class="cell-pri-light" colspan="2"> 2 - Pending &nbsp; </td></tr>
<tr><td class="cell-pri-dark" colspan="6"><b>Amateur Data</b></td></tr>
<tr><td class="cell-pri-medium">Request to change a station call sign systematically?</td>
    <td colspan="2" class="cell-pri-light"> N&nbsp;</td></tr>
<tr><td class="cell-pri-dark" colspan="6"><b>Vanity Call Sign Change</b></td></tr>
<tr><td class="cell-pri-medium">Eligibility</td>
    <td colspan="2" class="cell-pri-light"> Primary Station Preference List &nbsp;</td></tr>
<tr><td colspan="6" class="cell-pri-medium"><table><tbody>
<tr><td width="20%">1.&nbsp;N3HM </td><td width="20%">&nbsp;&nbsp;6.&nbsp;WA6V </td><td width="20%">11.&nbsp;</td><td width="20%">16.&nbsp;</td><td width="20%">21.&nbsp;</td></tr>
<tr><td width="20%">2.&nbsp;N6ER </td><td width="20%">&nbsp;&nbsp;7.&nbsp;</td><td width="20%">12.&nbsp;</td><td width="20%">17.&nbsp;</td><td width="20%">22.&nbsp;</td></tr>
<tr><td width="20%">3.&nbsp;KB6S </td><td width="20%">&nbsp;&nbsp;8.&nbsp;</td><td width="20%">13.&nbsp;</td><td width="20%">18.&nbsp;</td><td width="20%">23.&nbsp;</td></tr>
<tr><td width="20%">4.&nbsp;WM3I </td><td width="20%">&nbsp;&nbsp;9.&nbsp;</td><td width="20%">14.&nbsp;</td><td width="20%">19.&nbsp;</td><td width="20%">24.&nbsp;</td></tr>
<tr><td width="20%">5.&nbsp;KT6O </td><td width="20%">&nbsp;10.&nbsp;</td><td width="20%">15.&nbsp;</td><td width="20%">20.&nbsp;</td><td width="20%">25.&nbsp;</td></tr>
</tbody></table></td></tr>
<tr><td>Return to the Top</td></tr>
<tr><td width="20%">9.&nbsp;K9XYZ</td></tr>
`;

describe('ULS vanity preference parsing', () => {
  it('reads the 5x5 grid in rank order', () => {
    const r = parseVanityPreferences(SERVICE_SPECIFIC);
    expect(r.found).toBe(true);
    expect(r.preferences).toEqual([
      { seq: 1, call: 'N3HM' },
      { seq: 2, call: 'N6ER' },
      { seq: 3, call: 'KB6S' },
      { seq: 4, call: 'WM3I' },
      { seq: 5, call: 'KT6O' },
      { seq: 6, call: 'WA6V' },
    ]);
  });

  it('stops at the end of the section', () => {
    // The trailing "9. K9XYZ" cell sits after "Return to the Top" and must not
    // be collected — content past the section belongs to other tables.
    const r = parseVanityPreferences(SERVICE_SPECIFIC);
    expect(r.preferences.find((p) => p.call === 'K9XYZ')).toBeUndefined();
  });

  it('distinguishes "no section" from "section with no entries"', () => {
    // ULS genuinely serves an empty grid for some applications. Reporting that
    // as a parse failure would retry forever; reporting a parse failure as an
    // empty list would silently understate competition.
    expect(parseVanityPreferences('<html><body>nothing here</body></html>')).toEqual({
      found: false,
      preferences: [],
    });
    const empty = parseVanityPreferences(
      '<td><b>Vanity Call Sign Change</b></td><td width="20%">1.&nbsp;</td>',
    );
    expect(empty.found).toBe(true);
    expect(empty.preferences).toEqual([]);
  });

  it('ignores cells that are not callsigns', () => {
    const html =
      '<b>Vanity Call Sign Change</b><td>1.&nbsp;N3HM</td><td>2.&nbsp;12345</td><td>3.&nbsp;NOTACALL</td><td>30.&nbsp;K1AB</td>';
    const r = parseVanityPreferences(html);
    expect(r.preferences).toEqual([{ seq: 1, call: 'N3HM' }]);
  });
});

const RESULTS = `
<tr><th>#</th><th>File Number</th></tr>
<tr><td>1</td><td>0012085321</td><td>K6CRS  </td><td>SWANSON, CARL R </td><td>0002030732  </td><td>Modification  </td><td>HV </td><td>06/18/2026 </td><td>Pending  </td></tr>
<tr><td>2</td><td>0012108073</td><td>WZ5DX  </td><td>Bull Sr, Bryan S </td><td>0030533707  </td><td>Amendment (Modification) </td><td>HV </td><td>08/17/2026 </td><td>Pending  </td></tr>
<tr><td>Totals</td><td>2</td></tr>
`;

describe('ULS search-results parsing', () => {
  it('extracts pending vanity applications', () => {
    const rows = parseSearchResults(RESULTS);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      fileNumber: '0012085321',
      applicantCall: 'K6CRS',
      radioService: 'HV',
      receiptDate: '2026-06-18',
      status: 'Pending',
    });
    expect(rows[1].receiptDate).toBe('2026-08-17');
  });

  it('skips header and total rows', () => {
    expect(parseSearchResults(RESULTS).some((r) => r.fileNumber === '2')).toBe(false);
  });
});
