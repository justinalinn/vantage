/**
 * Call regions and geographic restriction.
 *
 * The continental US uses call districts 0-9 keyed off the digit. Territories
 * use dedicated two-letter prefixes and are geographically restricted: you must
 * have a mailing address in the region to hold the call.
 *
 * AE7Q numbers regions 1-13 (11 = Alaska, 12 = Caribbean, 13 = Pacific). We keep
 * that numbering for parity but expose real prefixes and state lists.
 */

export interface Region {
  id: number;
  label: string;
  shortLabel: string;
  /** USPS state codes whose licensees are "home" to this region. */
  states: string[];
  /** True when an address inside the region is legally required. */
  restricted: boolean;
  /** Two-letter prefixes exclusive to this region, if any. */
  territoryPrefixes?: string[];
}

export const REGIONS: Region[] = [
  { id: 0, label: 'District 0 — Central', shortLabel: '0 · Central', states: ['CO', 'IA', 'KS', 'MN', 'MO', 'ND', 'NE', 'SD'], restricted: false },
  { id: 1, label: 'District 1 — New England', shortLabel: '1 · NE', states: ['CT', 'MA', 'ME', 'NH', 'RI', 'VT'], restricted: false },
  { id: 2, label: 'District 2 — NY / NJ', shortLabel: '2 · NY/NJ', states: ['NJ', 'NY'], restricted: false },
  { id: 3, label: 'District 3 — Mid-Atlantic', shortLabel: '3 · Mid-Atl', states: ['DC', 'DE', 'MD', 'PA'], restricted: false },
  { id: 4, label: 'District 4 — Southeast', shortLabel: '4 · SE', states: ['AL', 'FL', 'GA', 'KY', 'NC', 'SC', 'TN', 'VA'], restricted: false },
  { id: 5, label: 'District 5 — South Central', shortLabel: '5 · S Ctrl', states: ['AR', 'LA', 'MS', 'NM', 'OK', 'TX'], restricted: false },
  { id: 6, label: 'District 6 — California', shortLabel: '6 · CA', states: ['CA'], restricted: false },
  { id: 7, label: 'District 7 — Northwest', shortLabel: '7 · NW', states: ['AZ', 'ID', 'MT', 'NV', 'OR', 'UT', 'WA', 'WY'], restricted: false },
  { id: 8, label: 'District 8 — Great Lakes', shortLabel: '8 · Gt Lakes', states: ['MI', 'OH', 'WV'], restricted: false },
  { id: 9, label: 'District 9 — IL / IN / WI', shortLabel: '9 · IL/IN/WI', states: ['IL', 'IN', 'WI'], restricted: false },
  { id: 11, label: 'Alaska', shortLabel: 'AK', states: ['AK'], restricted: true, territoryPrefixes: ['AL', 'KL', 'NL', 'WL'] },
  { id: 12, label: 'Caribbean — PR / VI', shortLabel: 'PR/VI', states: ['PR', 'VI'], restricted: true, territoryPrefixes: ['KP', 'NP', 'WP'] },
  { id: 13, label: 'Pacific', shortLabel: 'HI/Pac', states: ['HI', 'AS', 'GU', 'MP'], restricted: true, territoryPrefixes: ['AH', 'KH', 'NH', 'WH'] },
];

export const REGION_BY_ID = new Map(REGIONS.map((r) => [r.id, r]));

/** Territory prefixes are exclusive: they never belong to a mainland district. */
export const TERRITORY_PREFIXES = new Set(
  REGIONS.flatMap((r) => r.territoryPrefixes ?? []),
);

const STATE_TO_REGION = new Map<string, number>();
for (const r of REGIONS) for (const s of r.states) STATE_TO_REGION.set(s, r.id);

export function regionForState(state: string | null | undefined): number | null {
  if (!state) return null;
  return STATE_TO_REGION.get(state.trim().toUpperCase()) ?? null;
}

/**
 * The region a callsign belongs to, derived from prefix + digit.
 *
 * Territory prefixes win over the digit: KL7AA is Alaska, not district 7.
 */
export function regionForCall(prefix: string, digit: number): number {
  if (prefix.length === 2 && TERRITORY_PREFIXES.has(prefix)) {
    for (const r of REGIONS) {
      if (r.territoryPrefixes?.includes(prefix)) return r.id;
    }
  }
  return digit;
}

/** True when holding this call legally requires an address inside its region. */
export function isGeographicallyRestricted(prefix: string): boolean {
  return prefix.length === 2 && TERRITORY_PREFIXES.has(prefix);
}
