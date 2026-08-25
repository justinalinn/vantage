import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { authorize } from '@/lib/uls/auth';
import { getSchedule, setSchedule, DEFAULTS, type Schedule } from '@/lib/uls/schedule';

export const dynamic = 'force-dynamic';

export function GET(req: Request) {
  const auth = authorize(req);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: 403 });
  return NextResponse.json({ schedule: getSchedule(getDb()), defaults: DEFAULTS });
}

export async function POST(req: Request) {
  const auth = authorize(req);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: 403 });
  const patch = (await req.json().catch(() => ({}))) as Partial<Schedule>;
  // setSchedule clamps every field, so a bad value is corrected rather than
  // rejected — the caller gets back exactly what was stored.
  return NextResponse.json({ schedule: setSchedule(getDb(), patch) });
}
