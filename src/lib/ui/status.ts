/**
 * The status taxonomy, with redundant encoding.
 *
 * Every incumbent site encodes status with background colour alone, which fails
 * for colourblind users and disappears entirely in print or greyscale. Each
 * state here carries a glyph, a 3-letter code, and a label as well as a colour,
 * so colour is never load-bearing.
 */

export type StatusKey =
  | 'NEVER_ISSUED'
  | 'AVAILABLE'
  | 'AVAILABLE_CONTESTED'
  | 'PENDING'
  | 'UPCOMING'
  | 'EXPIRED_WAITING'
  | 'CANCELED_WAITING'
  | 'ACTIVE'
  | 'ANOMALY'
  | 'BLOCKED_PENDING'
  | 'BANNED'
  | 'RESERVED'
  | 'REGION_LOCKED'
  | 'CLASS_LOCKED';

export interface StatusDef {
  code: string;
  glyph: string;
  color: string;
  label: string;
  /** Disqualifications render dimmed — present but clearly not for you. */
  dim?: boolean;
  /** Can a user actually apply for a call in this state? */
  applyable?: boolean;
  blurb: string;
}

export const STATUS: Record<StatusKey, StatusDef> = {
  NEVER_ISSUED: {
    code: 'NEV',
    glyph: '◆',
    color: 'var(--s-never)',
    label: 'Never issued',
    applyable: true,
    blurb:
      'Structurally valid under Part 97 but never assigned in the complete ULS history. No incumbent, no hold, no competition — the rarest thing on this site.',
  },
  AVAILABLE: {
    code: 'AVL',
    glyph: '●',
    color: 'var(--s-avail)',
    label: 'Available',
    applyable: true,
    blurb: 'Past its available date with no pending applications on file. Filing today faces no lottery unless someone else files the same day.',
  },
  AVAILABLE_CONTESTED: {
    code: 'CON',
    glyph: '◎',
    color: 'var(--s-contested)',
    label: 'Contested',
    applyable: true,
    blurb: 'Open now, but applicants are already queued. Sharing their receipt date puts you in a lottery with them.',
  },
  PENDING: {
    code: 'PND',
    glyph: '◐',
    color: 'var(--s-pending)',
    label: 'In lottery',
    applyable: true,
    blurb: 'Inside an active FCC batch. The outcome resolves overnight on the process date, in uniformly random order.',
  },
  UPCOMING: {
    code: 'UPC',
    glyph: '◔',
    color: 'var(--s-upcoming)',
    label: 'Upcoming',
    blurb: 'Not yet open, but its available date is close enough to plan around. Watch it and file on the right day.',
  },
  EXPIRED_WAITING: {
    code: 'EXP',
    glyph: '▽',
    color: 'var(--s-expired)',
    label: 'Expired · hold',
    blurb: 'Expired but inside the mandatory 2-year hold.',
  },
  CANCELED_WAITING: {
    code: 'CAN',
    glyph: '▼',
    color: 'var(--s-canceled)',
    label: 'Canceled · hold',
    blurb: 'Canceled but inside the mandatory 2-year hold. A Silent Key notice can start this clock earlier.',
  },
  ACTIVE: {
    code: 'ACT',
    glyph: '■',
    color: 'var(--s-active)',
    label: 'Licensed',
    blurb: 'Currently licensed and in good standing.',
  },
  ANOMALY: {
    code: 'ANM',
    glyph: '△',
    color: 'var(--s-anomaly)',
    label: 'Anomaly',
    blurb:
      'Available on paper for well over a year, yet applications for it keep getting dismissed. The signature of an undocumented FCC hold — applying is likely to waste the fee.',
  },
  BLOCKED_PENDING: {
    code: 'RNW',
    glyph: '⊘',
    color: 'var(--s-anomaly)',
    label: 'Frozen · FCC action',
    blurb:
      'The hold has run out, but the Commission still has an application open on this licence — usually a renewal, sometimes an amendment to one — and has not acted on it. Until it does, the call cannot be granted to anyone. Some have been frozen since 2011. Applying wastes the fee.',
  },
  BANNED: {
    code: 'BAN',
    glyph: '⊗',
    color: 'var(--s-anomaly)',
    label: 'Withheld by FCC',
    dim: true,
    blurb:
      'The FCC holds a hidden ULS record marking this call reserved, and dismisses every application for it. Confirmed by FOIA; the published list is incomplete.',
  },
  RESERVED: {
    code: 'RSV',
    glyph: '▪',
    color: 'var(--s-locked)',
    label: 'Reserved',
    dim: true,
    blurb: 'Part of a reserved block or suffix. Never assignable through the vanity system.',
  },
  REGION_LOCKED: {
    code: 'RGN',
    glyph: '▪',
    color: 'var(--s-locked)',
    label: 'Region-locked',
    dim: true,
    blurb: 'Requires a mailing address inside the call region.',
  },
  CLASS_LOCKED: {
    code: 'CLS',
    glyph: '▪',
    color: 'var(--s-locked)',
    label: 'Class-locked',
    dim: true,
    blurb: 'Requires a higher operator class than you currently hold.',
  },
};

export const STATUS_ORDER: StatusKey[] = [
  'NEVER_ISSUED',
  'AVAILABLE',
  'AVAILABLE_CONTESTED',
  'PENDING',
  'UPCOMING',
  'ACTIVE',
  'EXPIRED_WAITING',
  'CANCELED_WAITING',
  'ANOMALY',
  'BLOCKED_PENDING',
  'BANNED',
  'RESERVED',
  'REGION_LOCKED',
  'CLASS_LOCKED',
];

export function statusDef(key: string): StatusDef {
  return STATUS[key as StatusKey] ?? STATUS.ACTIVE;
}

export function isApplyable(key: string): boolean {
  return statusDef(key).applyable === true;
}

export function chipStyle(st: StatusDef, size: 'sm' | 'md' = 'md'): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: size === 'sm' ? '2px 6px' : '3px 9px',
    borderRadius: 5,
    fontSize: 11,
    fontWeight: 500,
    opacity: st.dim ? 0.62 : 1,
    color: st.color,
    background: `color-mix(in srgb, ${st.color} 14%, transparent)`,
    border: `1px solid color-mix(in srgb, ${st.color} 35%, transparent)`,
    whiteSpace: 'nowrap',
  };
}

export function pColor(p: number | null | undefined): string {
  if (p == null) return 'var(--fg3)';
  if (p < 0.34) return 'var(--p-low)';
  if (p < 0.67) return 'var(--p-mid)';
  return 'var(--p-high)';
}

export function fmtPct(p: number | null | undefined, simulated = false): string {
  if (p == null) return '—';
  return `${simulated ? '~' : ''}${(p * 100).toFixed(1)}%`;
}
