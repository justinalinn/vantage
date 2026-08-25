/**
 * Calls that look assignable but are not, for reasons the licence record alone
 * never reveals.
 *
 * Availability arithmetic answers "has the hold run out". It cannot answer "will
 * the FCC actually grant this", and the gap between those two questions is where
 * applicants lose their $35. Two mechanisms account for essentially all of it.
 */

/**
 * Calls the FCC has quietly withheld from reassignment.
 *
 * Both of these clear every availability test — the hold ran out years ago,
 * nothing is pending, ULS shows them open — and both have absorbed a steady
 * stream of dismissed applications ever since. K2CR filed a FOIA request in
 * March 2024 to find out why; the returned records were heavily redacted but
 * showed hidden ULS entries marking the calls "Reserved by the FCC", restricted
 * as obscene.
 *
 * This is a two-element list because two is all anyone has confirmed. The FCC
 * has never published the full set, so ANOMALY detection still has to carry the
 * unknown remainder heuristically. Treat this as the confirmed core, not the
 * boundary.
 */
export const FCC_BANNED: Record<string, string> = {
  N6ER: 'Withheld by the FCC. A March 2024 FOIA request returned redacted records showing a hidden ULS entry marking this call "Reserved by the FCC" — restricted for similarity to obscenity. Applications for it are dismissed.',
  N1GI: 'Withheld by the FCC. A March 2024 FOIA request returned redacted records showing a hidden ULS entry marking this call "Reserved by the FCC" — restricted for similarity to obscenity. Applications for it are dismissed.',
};

export function bannedReason(call: string): string | null {
  return FCC_BANNED[call.toUpperCase()] ?? null;
}

/**
 * Any pending application on a call keeps it out of the vanity pool.
 *
 * A licensee whose ticket expired has two years to renew. Filing inside that
 * window stops the clock: the call cannot be reassigned while the Commission
 * still has the request in front of it, even after the grace period would
 * otherwise have run out. In practice these are applications taken offline for
 * manual review, and some have sat that way since 2011 — the call is frozen
 * indefinitely, looking available the whole time.
 *
 * The obvious rule is "block on a renewal", and it is wrong. Measured against
 * K2CR's published list, matching only RO and RM catches 84 of the 125 affected
 * calls; the other 41 carry purpose **AM**, because amending a pending renewal
 * replaces the purpose code on the application rather than adding to it. One
 * more (K2HPS) is an MD. What all of them share is not what the holder asked
 * for — it is that the Commission has an open matter on that licence and will
 * not reassign the call until it closes.
 *
 * So the block is on the existence of a pending application, and the purpose is
 * kept only to explain which kind it is.
 */
export const RENEWAL_PURPOSES = new Set(['RO', 'RM']);

/** Why a call is frozen, in the words a filer would use. */
export const BLOCK_PURPOSE_LABEL: Record<string, string> = {
  RO: 'a pending renewal',
  RM: 'a pending renewal and modification',
  AM: 'a pending amendment to an earlier filing',
  MD: 'a pending modification',
  AU: 'a pending administrative update',
  NE: 'a pending new-licence application',
};

export function blockLabel(purpose: string | null | undefined): string {
  return (purpose && BLOCK_PURPOSE_LABEL[purpose]) || 'an application the FCC has not yet acted on';
}
