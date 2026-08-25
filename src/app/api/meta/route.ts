import { NextResponse } from 'next/server';
import { getDb, getMeta } from '@/lib/db';
import { PENDING_STATUS } from '@/lib/fcc/uls';

export const dynamic = 'force-dynamic';

export function GET() {
  const db = getDb();

  const byStatus = db.prepare('SELECT status, COUNT(*) c FROM universe GROUP BY status ORDER BY c DESC').all() as Array<{
    status: string;
    c: number;
  }>;
  const byFormat = db
    .prepare(
      `SELECT format,
              COUNT(*) total,
              SUM(CASE WHEN status='NEVER_ISSUED' THEN 1 ELSE 0 END) never_issued,
              SUM(CASE WHEN status IN ('AVAILABLE','AVAILABLE_CONTESTED') THEN 1 ELSE 0 END) available,
              SUM(CASE WHEN status='ACTIVE' THEN 1 ELSE 0 END) active
       FROM universe GROUP BY format ORDER BY format`,
    )
    .all();

  const pending = (db.prepare('SELECT COUNT(*) c FROM application WHERE app_status = ?').get(PENDING_STATUS) as { c: number }).c;
  const batches = (
    db.prepare('SELECT COUNT(DISTINCT receipt_date) c FROM application WHERE app_status = ?').get(PENDING_STATUS) as {
      c: number;
    }
  ).c;
  const methods = db.prepare('SELECT method, COUNT(*) c FROM prediction GROUP BY method').all() as Array<{
    method: string;
    c: number;
  }>;

  const upcomingBatches = db
    .prepare(
      `SELECT receipt_date, COUNT(*) apps FROM application
       WHERE app_status = ? GROUP BY receipt_date ORDER BY receipt_date DESC LIMIT 20`,
    )
    .all(PENDING_STATUS);

  // The newest receipt date on file is the honest answer to "how current is
  // this", and a better one than the ingest timestamp: it is what the user can
  // actually check against the FCC.
  const newestReceipt = (
    db.prepare('SELECT MAX(receipt_date) d FROM application').get() as { d: string | null }
  ).d;

  // Which ULS transaction files have been folded in, newest first. Shown on the
  // methodology screen so freshness is a claim the user can verify rather than
  // one they have to take on faith.
  const sources = db
    .prepare("SELECT key, value FROM meta WHERE key LIKE 'src:%' ORDER BY value DESC")
    .all() as Array<{ key: string; value: string }>;

  return NextResponse.json({
    lastIngest: getMeta(db, 'last_ingest'),
    lastRefresh: getMeta(db, 'last_refresh'),
    ulsLicenseFile: getMeta(db, 'uls_license_file'),
    ulsApplicationFile: getMeta(db, 'uls_application_file'),
    newestReceipt,
    sources: sources.map((s) => ({ file: s.key.replace('src:', ''), lastModified: s.value })),
    // Set by the refresh when the FCC publishes a complete file newer than the
    // one loaded. It never downloads those itself — 520 MB on a 30-minute timer
    // — so this is how a pending full reload becomes visible.
    // Vanity applications the FCC has announced but not yet detailed. Until
    // their preference lists publish, every call they target reads here as less
    // contested than it is — so the count is reported rather than buried.
    awaitingPrefs: db
      .prepare(
        `SELECT COUNT(*) count, MIN(receipt_date) oldest, MAX(receipt_date) newest
           FROM application_unlisted`,
      )
      .get(),
    fullReloadAvailable: (
      db.prepare("SELECT COUNT(*) c FROM meta WHERE key LIKE 'available:src:%'").get() as { c: number }
    ).c > 0,
    blockedByRenewal: (
      db.prepare("SELECT COUNT(DISTINCT call) c FROM call_block WHERE kind='RENEWAL'").get() as { c: number }
    ).c,
    universe: (db.prepare('SELECT COUNT(*) c FROM universe').get() as { c: number }).c,
    knownCalls: (db.prepare('SELECT COUNT(*) c FROM call_state').get() as { c: number }).c,
    vanityRequests: (db.prepare('SELECT COUNT(*) c FROM application').get() as { c: number }).c,
    preferenceEntries: (db.prepare('SELECT COUNT(*) c FROM application_call').get() as { c: number }).c,
    pending,
    batches,
    byStatus,
    byFormat,
    methods,
    upcomingBatches,
  });
}
