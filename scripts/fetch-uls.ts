/**
 * Downloads the FCC ULS weekly amateur dumps.
 *
 * These are large (l_amat ~198 MB, a_amat ~320 MB) and are pure derived input:
 * everything the app serves is built from them during ingest, so they can be
 * deleted after ingest and re-fetched with this script at any time.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { getDb, initSchema, setMeta } from '../src/lib/db';

const RAW = path.join(process.cwd(), 'data/raw');

const FILES = [
  { name: 'l_amat.zip', url: 'https://data.fcc.gov/download/pub/uls/complete/l_amat.zip' },
  { name: 'a_amat.zip', url: 'https://data.fcc.gov/download/pub/uls/complete/a_amat.zip' },
];

async function fetchOne(name: string, url: string) {
  fs.mkdirSync(RAW, { recursive: true });
  const dest = path.join(RAW, name);
  process.stdout.write(`fetching ${name} … `);
  const res = await fetch(url, { headers: { 'User-Agent': 'VANTAGE/1.0' } });
  if (!res.ok || !res.body) throw new Error(`${name}: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length') ?? 0);
  await pipeline(res.body as unknown as NodeJS.ReadableStream, fs.createWriteStream(dest));
  const got = fs.statSync(dest).size;

  // Record when the FCC published this file, not when we downloaded it.
  //
  // This is the baseline the incremental refresh measures daily transaction
  // files against. Daily slots rotate weekly, so after a complete reload most
  // of them are *older* than the data just loaded — replaying those would
  // overwrite current records with a week-old snapshot of themselves. The
  // publication timestamp is the only thing that orders the two correctly;
  // download time is not, because it says nothing about the file's contents.
  const lastMod = res.headers.get('last-modified');
  if (lastMod) {
    const db = getDb();
    initSchema(db);
    setMeta(db, `src:${name.replace(/\.zip$/, '')}`, lastMod);
  }
  console.log(
    `${(got / 1e6).toFixed(1)} MB${total && got !== total ? ' (size mismatch!)' : ''}` +
      (lastMod ? ` · published ${lastMod}` : ''),
  );
}

async function main() {
  for (const f of FILES) await fetchOne(f.name, f.url);
  console.log('\nNow run:  npm run ingest');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
