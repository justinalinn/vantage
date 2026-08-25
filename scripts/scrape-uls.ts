/**
 * Reads pending vanity applications off the ULS web interface.
 *
 * ## Why this exists
 *
 * The FCC bulk feed lags the ULS web interface in two separate ways, and the
 * second one is worse:
 *
 *   1. An application's header publishes a cycle before its vanity preference
 *      list, so for a while we know a filing exists but not what it wants.
 *      Those are recorded in `application_unlisted`.
 *   2. Some applications are visible on ULS and in **no** published file at
 *      all — not even a header. On 2026-08-19 the newest pending vanity
 *      application in our database was USI 16157903 while ULS was serving
 *      16159562, 16159004 and others, every one of them with a full preference
 *      list. 16159004 alone requested sixteen calls including K5OW.
 *
 * So discovery cannot come from the bulk feed. It comes from ULS's own vanity
 * search — the same place the incumbents get it — and the bulk data is then
 * used only to decide which results we already know about.
 *
 * Every call one of these applications targets currently reads as less
 * contested than it is, which is the one way this data can cost someone $35.
 *
 * ## Why it needs a real browser
 *
 * `wireless2.fcc.gov` sits behind Akamai and answers 403 to curl and to any
 * headless browser, bundled Chromium or real Chrome alike. It answers 200 to
 * real Chrome with `headless: false`. That is the entire barrier — it is not an
 * IP ban, and `data.fcc.gov` (the bulk files) was never blocked. On a headless
 * host, run under `xvfb-run`.
 *
 * Note that Playwright's `context.request` API does *not* work even inside an
 * authenticated context: it shares cookies but not the browser's network stack,
 * and Akamai answers it with a behavioural challenge. Every fetch has to be a
 * genuine page navigation.
 *
 * ## Load
 *
 * ULS is asked once for its own list of pending vanity applications, and only
 * the entries this database has never seen are opened. Steady state is a
 * handful of page views a day, fetched serially with a configurable delay and
 * restricted to off-hours by default — the same courtesy the incumbents
 * document.
 *
 * Usage:
 *   npx tsx scripts/scrape-uls.ts            # honour the configured schedule
 *   npx tsx scripts/scrape-uls.ts --now      # ignore interval and time window
 *   npx tsx scripts/scrape-uls.ts --limit 5  # cap pages (testing)
 *   npx tsx scripts/scrape-uls.ts --dry-run  # fetch and parse, write nothing
 */
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { Database as DB } from 'better-sqlite3';
import { getDb, initSchema, setMeta } from '../src/lib/db';
import { getSchedule, scrapeDue } from '../src/lib/uls/schedule';
import { parseVanityPreferences } from '../src/lib/uls/parse';
import { deriveFromLicenseMin, reconcile } from '../src/lib/ingest/derive';
import { runPredictions } from '../src/lib/predict/engine';

const PROFILE = process.env.VANTAGE_CHROME_PROFILE ?? path.join(process.cwd(), 'data', 'chrome-profile');
const DETAIL = (usi: number) =>
  `https://wireless2.fcc.gov/UlsApp/ApplicationSearch/applServiceSpecific.jsp?applID=${usi}`;

function log(msg: string) {
  console.log(`[${new Date().toISOString().slice(0, 19).replace('T', ' ')}] ${msg}`);
}

/**
 * Locates a Playwright-compatible driver.
 *
 * patchright is preferred — it is a Playwright fork that strips the automation
 * tells Akamai looks for — but plain playwright driving real Chrome headful
 * also gets through, so either is accepted rather than making the scraper
 * refuse to run on a host that has one and not the other.
 */
function resolveDriver(): any {
  const roots = [process.cwd() + '/'];
  for (const base of [path.join(homedir(), '.vscode/extensions'), path.join(homedir(), '.vscode-server/extensions')]) {
    if (!fs.existsSync(base)) continue;
    const dirs = fs
      .readdirSync(base)
      .filter((d) => d.startsWith('danielsanmedium.dscodegpt-'))
      .sort();
    const newest = dirs[dirs.length - 1];
    if (newest) roots.push(path.join(base, newest, 'standalone') + '/');
  }
  for (const root of roots) {
    for (const pkg of ['patchright', 'playwright', 'playwright-core']) {
      try {
        const mod = createRequire(root)(pkg);
        const chromium = mod?.chromium ?? mod?.default?.chromium;
        if (chromium) return { chromium, pkg, root };
      } catch {}
    }
  }
  throw new Error(
    'No browser driver found. Install one alongside the app:\n' +
      '  npm i -D patchright && npx patchright install chrome\n' +
      'On a headless host also install xvfb and run this under xvfb-run.',
  );
}

interface Target {
  usi: number;
  file_number: string | null;
  applicant_call: string | null;
  receipt_date: string | null;
  app_status: string | null;
}

/**
 * Every pending vanity application ULS will admit to, newest last.
 *
 * The form is submitted through its own JS rather than by clicking: the submit
 * control is an `<input type=image>` that does not reliably fire, and ULS
 * validates `jsValidated` before accepting the post.
 */
async function discover(page: any, delaySec: number): Promise<Target[]> {
  await page.goto('https://wireless2.fcc.gov/UlsApp/ApplicationSearch/searchAmateur.jsp', {
    waitUntil: 'domcontentloaded',
    timeout: 45_000,
  });
  await page.waitForTimeout(1200);
  await page.check('input[name=uls_a_vanity_callsign]').catch(() => {});
  await page.selectOption('select[name=uls_a_status_code]', ['2']).catch(() => {});
  await page.selectOption('select[name=pageSize]', '100').catch(() => {});
  // Newest first. This is what makes a single page of results sufficient: the
  // applications that matter are the ones the published files do not have yet,
  // and those are by definition the most recent. Note the FCC's own spelling
  // of the descending option.
  await page.selectOption('select[name=sortItem]', 'uls_a_receipt_date').catch(() => {});
  await page.selectOption('select[name=orderBy]', 'decending').catch(() => {});
  await page.evaluate(() => {
    const f = (document.forms as any)[0];
    const jv = f.querySelector('input[name=jsValidated]');
    if (jv) jv.value = 'true';
    f.submit();
  });
  await page.waitForTimeout(5000);

  const all = new Map<number, Target>();

  const collect = async (): Promise<Target[]> =>
    await page.evaluate(() => {
      const out: any[] = [];
      for (const tr of Array.from(document.querySelectorAll('tr'))) {
        const link = tr.querySelector('a[href*="applID"]') as HTMLAnchorElement | null;
        if (!link) continue;
        const usi = Number((link.href.match(/applID=(\d+)/) || [])[1]);
        if (!usi) continue;
        const cells = Array.from(tr.querySelectorAll('td')).map((c) =>
          (c.textContent || '').replace(/\s+/g, ' ').trim(),
        );
        if (cells.length < 9) continue;
        const us = cells[7];
        const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(us);
        out.push({
          usi,
          file_number: cells[1] || null,
          applicant_call: cells[2] || null,
          receipt_date: m ? `${m[3]}-${m[1]}-${m[2]}` : null,
          app_status: '2',
        });
      }
      return out;
    });

  for (const r of await collect()) all.set(r.usi, r);

  // Pagination is numbered `reqPage=N` links against a search key minted for
  // this query, not a "Next" button — so the page count is read off page one
  // and the rest fetched directly. The key expires with the session, which is
  // why this happens in one pass rather than being resumable.
  // Deliberately no pagination. The reqPage links are bound to a search key
  // that does not survive a fresh GET, and sorting newest-first makes the first
  // hundred results the only ones that can contain anything the published files
  // are missing. Everything older is already in the bulk data.
  return [...all.values()];
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--now');
  const dryRun = args.includes('--dry-run');
  const limitArg = args.indexOf('--limit');
  const cliLimit = limitArg !== -1 ? Number(args[limitArg + 1]) : null;

  const db = getDb();
  initSchema(db);
  const sched = getSchedule(db);

  if (!force) {
    const d = scrapeDue(db);
    if (!d.due) {
      log(`not due: ${d.reason}`);
      return;
    }
    log(`due: ${d.reason}`);
  }

  const limit = cliLimit ?? sched.scrapeMaxPages;

  const runId = (
    db
      .prepare('INSERT INTO scrape_log (started_at, attempted) VALUES (?, 0) RETURNING id')
      .get(new Date().toISOString()) as { id: number }
  ).id;

  const { chromium, pkg } = resolveDriver();
  log(`driver: ${pkg}`);
  fs.mkdirSync(PROFILE, { recursive: true });

  const ctx = await chromium.launchPersistentContext(PROFILE, {
    // Headless is the one thing that does not work. See the header note.
    headless: false,
    channel: 'chrome',
    viewport: { width: 1400, height: 950 },
    locale: 'en-US',
  });

  let attempted = 0;
  let resolved = 0;
  let empty = 0;
  let failed = 0;
  const found: Array<{ usi: number; prefs: Array<{ seq: number; call: string }>; row: Target }> = [];
  let targets: Target[] = [];

  try {
    const page = await ctx.newPage();

    // ---------------------------------------------------------- discovery
    log('asking ULS for every pending vanity application');
    const seen = await discover(page, sched.scrapeDelaySec);
    log(`ULS lists ${seen.length} pending vanity applications`);

    // Anything whose preference list we already hold is not worth a page view.
    const havePrefs = new Set<number>(
      (db.prepare('SELECT DISTINCT usi FROM application_call').all() as Array<{ usi: number }>).map(
        (r) => r.usi,
      ),
    );
    targets = seen
      .filter((r) => !havePrefs.has(r.usi))
      .sort((a, b) => b.usi - a.usi)
      .slice(0, limit);
    log(`${targets.length} of them are new to this database`);

    if (targets.length === 0) {
      log('nothing to look up');
    }

    for (const t of targets) {
      attempted++;
      try {
        await page.goto(DETAIL(t.usi), { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await page.waitForTimeout(800);
        const html: string = await page.content();

        if (/Access Denied/i.test(html)) {
          failed++;
          log(`  ${t.usi} ${t.applicant_call ?? ''} — blocked by Akamai; stopping to avoid hammering`);
          break;
        }

        const r = parseVanityPreferences(html);
        if (!r.found) {
          failed++;
          log(`  ${t.usi} ${t.applicant_call ?? ''} — no vanity section (page shape changed?)`);
        } else if (r.preferences.length === 0) {
          // A real answer: ULS serves an empty grid for some applications.
          empty++;
        } else {
          resolved++;
          found.push({ usi: t.usi, prefs: r.preferences, row: t });
          log(`  ${t.usi} ${t.applicant_call ?? ''} -> ${r.preferences.map((p) => p.call).join(', ')}`);
        }
      } catch (e) {
        failed++;
        log(`  ${t.usi} — ${(e as Error).message.slice(0, 90)}`);
      }
      await new Promise((r) => setTimeout(r, sched.scrapeDelaySec * 1000));
    }
  } finally {
    await ctx.close().catch(() => {});
  }

  log(`fetched ${attempted}: ${resolved} with lists, ${empty} empty, ${failed} failed`);

  if (dryRun) {
    log('dry run — nothing written');
    return;
  }

  if (found.length > 0) {
    // One transaction, same as the bulk refresh: readers keep seeing the
    // previous snapshot until the whole derived chain has been recomputed.
    const write = db.transaction(() => {
      // Operator class and state come from the applicant's own licence rather
      // than the search results, which do not carry them. That is not a
      // fallback — eligibility is decided by the licence they hold, so this is
      // the authoritative source. Without it the solver would treat a
      // provisional applicant as eligible for every group and region and
      // overstate the competition it was added to measure.
      const insApp = db.prepare(`
        INSERT INTO application
          (usi, file_number, applicant_call, radio_service, purpose, app_status,
           receipt_date, operator_class, state, request_type, provisional)
        VALUES (?,?,?,'HV','MD','2',?,
                (SELECT operator_class FROM call_state WHERE call = ?),
                (SELECT state          FROM call_state WHERE call = ?),
                'E', 1)
        ON CONFLICT(usi) DO UPDATE SET
          provisional   = 1,
          receipt_date  = COALESCE(application.receipt_date, excluded.receipt_date),
          applicant_call= COALESCE(application.applicant_call, excluded.applicant_call)
      `);
      const clearCalls = db.prepare('DELETE FROM application_call WHERE usi = ?');
      const insCall = db.prepare(
        "INSERT OR REPLACE INTO application_call (usi, seq, call, source, scraped_at) VALUES (?,?,?,'uls',?)",
      );
      const dropUnlisted = db.prepare('DELETE FROM application_unlisted WHERE usi = ?');
      const now = new Date().toISOString();

      for (const f of found) {
        insApp.run(
          f.usi,
          f.row.file_number,
          f.row.applicant_call,
          f.row.receipt_date,
          f.row.applicant_call,
          f.row.applicant_call,
        );
        clearCalls.run(f.usi);
        for (const p of f.prefs) insCall.run(f.usi, p.seq, p.call, now);
        dropUnlisted.run(f.usi);
      }

      log('rebuilding derived chain with the new applications');
      deriveFromLicenseMin(db);
      reconcile(db);
      runPredictions(db);
      setMeta(db, 'last_scrape', new Date().toISOString());
    });
    write();
    db.pragma('wal_checkpoint(TRUNCATE)');
  } else {
    setMeta(db, 'last_scrape', new Date().toISOString());
  }

  db.prepare(
    'UPDATE scrape_log SET ended_at=?, attempted=?, resolved=?, empty=?, failed=?, note=? WHERE id=?',
  ).run(
    new Date().toISOString(),
    attempted,
    resolved,
    empty,
    failed,
    found.length ? `${found.length} applications merged` : 'no new preference lists',
    runId,
  );
  log('done');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
