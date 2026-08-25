import { NextResponse } from 'next/server';
import { parseQuery, describeQuery } from '@/lib/query/parse';
import { search, type SortKey } from '@/lib/query/search';

export const dynamic = 'force-dynamic';

export function GET(req: Request) {
  const url = new URL(req.url);
  const q = parseQuery(url.searchParams.get('q') ?? '');
  const sort = (url.searchParams.get('sort') ?? 'des') as SortKey;
  const dir = (url.searchParams.get('dir') ?? 'desc') as 'asc' | 'desc';
  const limit = Number(url.searchParams.get('limit') ?? 200);
  const offset = Number(url.searchParams.get('offset') ?? 0);

  try {
    const res = search(q, { sort, dir, limit, offset });
    return NextResponse.json({ ...res, parsed: q, describe: describeQuery(q) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
