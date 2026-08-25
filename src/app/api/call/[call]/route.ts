import { NextResponse } from 'next/server';
import { callDetail } from '@/lib/query/search';
import { desirability } from '@/lib/callsign/desirability';
import { morseOf } from '@/lib/callsign/weights';
import { statusDef } from '@/lib/ui/status';
import { explainCall, verdictFor } from '@/lib/explain';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ call: string }> }) {
  const { call: raw } = await ctx.params;
  const call = decodeURIComponent(raw).toUpperCase();
  const d = callDetail(call);
  if (!d) return NextResponse.json({ error: 'not found', call }, { status: 404 });

  return NextResponse.json({
    ...d,
    statusDef: statusDef(d.status),
    morseCode: morseOf(call),
    desirabilityBreakdown: desirability(call),
    explain: explainCall(d),
    verdict: verdictFor(d),
  });
}
