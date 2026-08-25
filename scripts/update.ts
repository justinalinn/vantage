/**
 * The scheduled entry point. One unit, one timer, both kinds of update.
 *
 * The systemd timer fires this often (every 15 minutes); this decides whether
 * anything is actually due, using the schedule stored in the database. That
 * indirection is what makes the cadence editable from the site — changing how
 * often the FCC is polled, or turning ULS scraping on, is a database write
 * rather than a unit-file edit needing root and a daemon-reload.
 *
 * Usage:
 *   npx tsx scripts/update.ts             # run whatever is due
 *   npx tsx scripts/update.ts --bulk      # force the FCC check
 *   npx tsx scripts/update.ts --scrape    # force the ULS scrape
 *   npx tsx scripts/update.ts --all       # force both
 *   npx tsx scripts/update.ts --status    # report and exit
 */
import { getDb, initSchema, setMeta, getMeta } from '../src/lib/db';
import { getSchedule, bulkDue, scrapeDue } from '../src/lib/uls/schedule';
import { runJob } from '../src/lib/uls/runner';

function log(msg: string) {
  console.log(`[${new Date().toISOString().slice(0, 19).replace('T', ' ')}] ${msg}`);
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const db = getDb();
  initSchema(db);
  const sched = getSchedule(db);

  if (args.has('--status')) {
    console.log(JSON.stringify({
      schedule: sched,
      lastBulkCheck: getMeta(db, 'last_bulk_check'),
      lastRefresh: getMeta(db, 'last_refresh'),
      lastScrape: getMeta(db, 'last_scrape'),
      bulkDue: bulkDue(db),
      scrape: scrapeDue(db),
      awaiting: (db.prepare('SELECT COUNT(*) c FROM application_unlisted').get() as { c: number }).c,
    }, null, 2));
    return;
  }

  const forceBulk = args.has('--bulk') || args.has('--all');
  const forceScrape = args.has('--scrape') || args.has('--all');

  if (forceBulk || bulkDue(db)) {
    log('checking the FCC for new bulk data');
    // Recorded before the run, not after: the interval should measure how often
    // we ask, so a slow or failed run cannot compress the next gap to nothing.
    setMeta(db, 'last_bulk_check', new Date().toISOString());
    const code = await runJob(db, 'bulk');
    log(`bulk check finished (exit ${code})`);
  } else {
    log(`bulk not due (interval ${sched.bulkIntervalMin} min)`);
  }

  if (forceScrape) {
    log('scraping ULS (forced)');
    const code = await runJob(db, 'scrape', ['--now']);
    log(`scrape finished (exit ${code})`);
  } else {
    const d = scrapeDue(db);
    if (d.due) {
      log(`scraping ULS: ${d.reason}`);
      const code = await runJob(db, 'scrape');
      log(`scrape finished (exit ${code})`);
    } else {
      log(`scrape not due: ${d.reason}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
