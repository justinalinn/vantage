/**
 * Reading ULS bulk data without ever holding it in memory.
 *
 * The uncompressed amateur set is ~2.6 GB and `A/EN.dat` alone is 471 MB, so
 * anything that materialises a file — even into a JS Map keyed by USI — runs the
 * process out of heap. Every reader here pipes `unzip -p` and parses line by
 * line, handing joins to SQLite instead.
 */
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

/** ULS dates are MM/DD/YYYY; everything downstream wants ISO. */
export function usDate(s: string | undefined): string | null {
  if (!s) return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim());
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}

export const BATCH = 25_000;

/**
 * Streams one member of a zip, feeding batches of mapped rows to `sink`.
 *
 * `map` returning null skips the row, which doubles as the filter — and as a
 * way to collect into a caller-owned structure while sinking nothing.
 */
export async function streamMember(
  zip: string,
  member: string,
  map: (f: string[]) => unknown[] | null,
  sink: (rows: unknown[][]) => void,
  batchSize = BATCH,
): Promise<number> {
  const proc = spawn('unzip', ['-p', zip, member]);
  proc.stderr.resume();
  const rl = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity });
  let batch: unknown[][] = [];
  let n = 0;
  for await (const line of rl) {
    if (!line) continue;
    const row = map(line.split('|'));
    if (!row) continue;
    batch.push(row);
    if (batch.length >= batchSize) {
      sink(batch);
      n += batch.length;
      batch = [];
    }
  }
  if (batch.length) {
    sink(batch);
    n += batch.length;
  }
  await new Promise<void>((res) => proc.on('close', () => res()));
  return n;
}

export interface HeadResult {
  ok: boolean;
  status: number;
  lastModified: string | null;
  length: number;
}

/**
 * A conditional check costing a few hundred bytes.
 *
 * Polling for freshness by downloading is how you get rate-limited; the FCC
 * serves `Last-Modified` on every one of these files, and that header is the
 * only signal needed to decide whether a fetch is worth doing.
 */
export async function head(url: string, timeoutMs = 20_000): Promise<HeadResult> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': 'VANTAGE/1.0' },
      signal: ctl.signal,
    });
    return {
      ok: res.ok,
      status: res.status,
      lastModified: res.headers.get('last-modified'),
      length: Number(res.headers.get('content-length') ?? 0),
    };
  } finally {
    clearTimeout(t);
  }
}

export async function download(url: string, dest: string, timeoutMs = 10 * 60_000): Promise<number> {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'VANTAGE/1.0' }, signal: ctl.signal });
    if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
    // Written to a temp name and renamed, so a killed process can never leave a
    // truncated zip that the next run happily treats as complete.
    const tmp = `${dest}.part`;
    await pipeline(res.body as unknown as NodeJS.ReadableStream, fs.createWriteStream(tmp));
    fs.renameSync(tmp, dest);
    return fs.statSync(dest).size;
  } finally {
    clearTimeout(t);
  }
}
