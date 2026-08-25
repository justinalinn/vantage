import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export const DB_PATH = process.env.VANTAGE_DB ?? path.join(process.cwd(), 'data', 'vantage.db');

/**
 * User state lives in its own file, attached as `user`.
 *
 * Everything in vantage.db is reconstructible from the FCC bulk data, and the
 * refresh pipeline takes full advantage of that — it wipes and rebuilds derived
 * tables wholesale. A watchlist is the one thing on this site that cannot be
 * regenerated, so keeping it in the same file as the disposable data is a
 * standing invitation to lose it.
 *
 * Splitting it also removes the only source of write contention. A refresh
 * holds vantage.db's write lock for minutes at a time; a watchlist write during
 * that window would block until it timed out. Separate files, separate locks.
 */
export const USER_DB_PATH =
  process.env.VANTAGE_USER_DB ?? path.join(path.dirname(DB_PATH), 'user.db');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000');
  // A refresh can hold the write lock for several minutes. Readers are never
  // blocked under WAL, so this only affects the rare writer, which should wait
  // rather than fail.
  db.pragma('busy_timeout = 15000');
  db.pragma('temp_store = MEMORY');

  db.exec(`ATTACH DATABASE '${USER_DB_PATH.replace(/'/g, "''")}' AS user`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS user.watchlist (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      call       TEXT NOT NULL,
      note       TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(call)
    );
  `);
  migrateWatchlist(db);

  _db = db;
  return db;
}

/**
 * Moves any rows left in the pre-split main-database watchlist across, once.
 *
 * Without this the table simply appears empty after an upgrade, which looks
 * exactly like data loss to the person whose watchlist it was.
 */
function migrateWatchlist(db: Database.Database) {
  const legacy = db
    .prepare("SELECT name FROM main.sqlite_master WHERE type='table' AND name='watchlist'")
    .get();
  if (!legacy) return;
  const n = db.prepare('SELECT COUNT(*) c FROM main.watchlist').get() as { c: number };
  if (n.c > 0) {
    db.exec(
      'INSERT OR IGNORE INTO user.watchlist (call, note, created_at) SELECT call, note, created_at FROM main.watchlist',
    );
    console.log(`[db] migrated ${n.c} watchlist entries into ${USER_DB_PATH}`);
  }
  db.exec('DROP TABLE main.watchlist');
}

export function initSchema(db: Database.Database) {
  const sql = fs.readFileSync(path.join(process.cwd(), 'src/lib/db/schema.sql'), 'utf8');
  db.exec(sql);
  migrate(db);
}

/**
 * Column additions, applied idempotently.
 *
 * schema.sql is all CREATE TABLE IF NOT EXISTS, which does nothing for a table
 * that already exists — so a new column has to be added here or it silently
 * never appears on a database built before it was written.
 */
function migrate(db: Database.Database) {
  const add = (table: string, column: string, decl: string) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (cols.length === 0) return; // table not created yet
    if (cols.some((c) => c.name === column)) return;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  };

  // Whether a row came from the FCC bulk export or was read off the ULS web
  // interface ahead of publication. Provisional rows are real competition and
  // must reach the solver, but they are unconfirmed and the UI says so.
  add('application', 'provisional', "INTEGER NOT NULL DEFAULT 0");
  add('application_call', 'source', "TEXT NOT NULL DEFAULT 'bulk'");
  add('application_call', 'scraped_at', 'TEXT');
}

export function setMeta(db: Database.Database, key: string, value: string) {
  db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(
    key,
    value,
  );
}

export function getMeta(db: Database.Database, key: string): string | null {
  const r = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
  return r?.value ?? null;
}

export function dbExists(): boolean {
  return fs.existsSync(DB_PATH);
}
