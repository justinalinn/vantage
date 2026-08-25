import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { evaluatePortfolio, optimizeWithDiff, fieldForCalls, type Candidate } from '@/lib/predict/portfolio';
import { PENDING_STATUS } from '@/lib/fcc/uls';
import { desirability, DEFAULT_WEIGHTS, type DesirabilityWeights, type PersonalContext } from '@/lib/callsign/desirability';

export const dynamic = 'force-dynamic';

interface Body {
  calls: string[];
  optimize?: boolean;
  weights?: Partial<DesirabilityWeights>;
  context?: PersonalContext;
}

export async function POST(req: Request) {
  const body = (await req.json()) as Body;
  const calls = (body.calls ?? []).map((c) => c.toUpperCase()).slice(0, 25);
  if (calls.length === 0) {
    return NextResponse.json({ slots: [], pAny: 0, pFirst: 0, pTop3: 0, expectedUtility: 0, method: 'trivial' });
  }

  const db = getDb();
  const weights = { ...DEFAULT_WEIGHTS, ...(body.weights ?? {}) };

  // Utility comes from the desirability model, personalised when context is given.
  const cands: Candidate[] = calls.map((call) => ({
    call,
    utility: desirability(call, weights, body.context).score,
  }));

  // One shared competitive field: a rival application can contest several of
  // the user's choices at once, and that coupling changes the answer.
  const field = fieldForCalls(db, calls, PENDING_STATUS);
  for (const c of cands) c.field = field;

  if (body.optimize) {
    const diff = optimizeWithDiff(cands);
    return NextResponse.json({
      optimized: true,
      order: diff.order.map((c) => c.call),
      moved: diff.moved,
      before: diff.before,
      after: diff.after,
      fieldSize: field.length,
    });
  }

  const res = evaluatePortfolio(cands);
  return NextResponse.json({ ...res, fieldSize: field.length });
}
