import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { PENDING_STATUS, REQUEST_TYPE_LABEL, APP_STATUS_LABEL, APP_PURPOSE_LABEL } from '@/lib/fcc/uls';
import { OPERATOR_CLASS_LABEL } from '@/lib/callsign/groups';

export const dynamic = 'force-dynamic';

/**
 * Everything about one applicant: who they are, what they are chasing, and how
 * each entry on their preference list is expected to resolve.
 *
 * Competing applicants are the most interesting objects on a detail page and
 * were previously dead text. Being able to click through to "what else is this
 * person going after" is what makes a contested call legible — if the person
 * ahead of you is far more likely to take something else, the call is not
 * really contested at all.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ call: string }> }) {
  const { call: raw } = await ctx.params;
  const applicant = decodeURIComponent(raw).toUpperCase();
  const db = getDb();

  const apps = db
    .prepare(
      `SELECT a.usi, a.file_number, a.applicant_call, a.entity_name, a.state, a.receipt_date,
              a.action_date, a.app_status, a.purpose, a.operator_class, a.request_type, a.relationship,
              pa.outcome, pa.best_call, pa.best_p, pa.p_any, pa.method
       FROM application a
       LEFT JOIN prediction_app pa ON pa.usi = a.usi
       WHERE a.applicant_call = ?
       ORDER BY a.receipt_date DESC`,
    )
    .all(applicant) as Array<Record<string, unknown>>;

  if (apps.length === 0) {
    return NextResponse.json({ error: 'no applications on file', applicant }, { status: 404 });
  }

  const prefStmt = db.prepare(
    `SELECT ac.seq, ac.call, u.status, u.format, u.grp, u.region, u.desirability, u.morse,
            u.pending_count, u.eligible_pending, u.survive_p, u.available_date,
            pr.p, pr.method AS p_method
     FROM application_call ac
     LEFT JOIN universe u ON u.call = ac.call
     LEFT JOIN prediction pr ON pr.usi = ac.usi AND pr.call = ac.call
     WHERE ac.usi = ? ORDER BY ac.seq`,
  );

  const licence = db
    .prepare('SELECT status, grant_date, expired_date, operator_class, entity_name, state FROM call_state WHERE call = ?')
    .get(applicant);

  return NextResponse.json({
    applicant,
    licence: licence ?? null,
    applications: apps.map((a) => ({
      ...a,
      statusLabel: APP_STATUS_LABEL[a.app_status as string] ?? a.app_status,
      purposeLabel: APP_PURPOSE_LABEL[a.purpose as string] ?? a.purpose,
      requestTypeLabel: REQUEST_TYPE_LABEL[a.request_type as string] ?? null,
      classLabel: OPERATOR_CLASS_LABEL[a.operator_class as never] ?? a.operator_class,
      isPending: a.app_status === PENDING_STATUS,
      preferences: prefStmt.all(a.usi),
    })),
  });
}
