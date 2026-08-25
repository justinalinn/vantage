/**
 * Records when the FCC published the complete files currently loaded.
 *
 * The incremental refresh compares every daily transaction file against these
 * timestamps. If they are missing the baseline is zero, so all six rotating
 * daily slots look newer than the database — and the next refresh replays a
 * week-old snapshot over current records, producing a database that is wrong in
 * a way nothing downstream can detect.
 *
 * `fetch-uls.ts` writes them as it downloads. This exists for the case where it
 * did not: an older fetch, a manual download, a restore. Re-reading the header
 * is correct as long as the FCC has not republished since, and it prints what
 * it found so that assumption is visible rather than implied.
 */
import { getDb, initSchema, setMeta, getMeta } from '../src/lib/db';
import { WEEKLY } from '../src/lib/fcc/sources';
import { head } from '../src/lib/fcc/stream';

async function main() {
  const db = getDb();
  initSchema(db);
  const force = process.argv.includes('--force');

  for (const src of WEEKLY) {
    const existing = getMeta(db, src.key);
    if (existing && !force) {
      console.log(`${src.name.padEnd(12)} already stamped ${existing}`);
      continue;
    }
    const h = await head(src.url);
    if (!h.ok || !h.lastModified) {
      console.log(`${src.name.padEnd(12)} unavailable (HTTP ${h.status}) — leaving unstamped`);
      continue;
    }
    setMeta(db, src.key, h.lastModified);
    console.log(`${src.name.padEnd(12)} stamped ${h.lastModified}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
