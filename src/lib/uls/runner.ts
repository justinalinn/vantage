/**
 * Starting and observing update jobs.
 *
 * Both the scheduled timer and the button on the site come through here, so
 * there is exactly one definition of what "run an update" means and one lock
 * preventing two of them at once. A second concurrent refresh would not corrupt
 * anything — each runs in its own transaction — but it would double the work
 * and hold the write lock twice as long for no benefit.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Database as DB } from 'better-sqlite3';
import { getMeta, setMeta } from '../db';

export type JobKind = 'bulk' | 'scrape';

export const LOG_DIR = path.join(process.cwd(), 'logs');

const LOG_FILE: Record<JobKind, string> = {
  bulk: 'refresh.log',
  scrape: 'scrape.log',
};

const SCRIPT: Record<JobKind, string> = {
  bulk: 'scripts/refresh.ts',
  scrape: 'scripts/scrape-uls.ts',
};

interface Lock {
  pid: number;
  kind: JobKind;
  startedAt: string;
}

function lockKey(kind: JobKind) {
  return `job:${kind}`;
}

/**
 * True when the recorded process is still alive.
 *
 * A crashed job leaves its lock behind, and a stale lock that is never cleared
 * means the button stops working until someone notices. Signal 0 asks the
 * kernel rather than trusting the record.
 */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readLock(db: DB, kind: JobKind): Lock | null {
  const raw = getMeta(db, lockKey(kind));
  if (!raw) return null;
  try {
    const l = JSON.parse(raw) as Lock;
    return alive(l.pid) ? l : null;
  } catch {
    return null;
  }
}

export interface StartResult {
  ok: boolean;
  reason?: string;
  pid?: number;
}

/**
 * How to invoke a job, resolved once so the detached and awaited paths cannot
 * drift apart.
 */
function invocation(kind: JobKind, args: string[]) {
  // The scrape needs a real, non-headless Chrome. On a box with no display that
  // means xvfb; without it Chrome exits immediately and the failure reads like
  // a network problem rather than a missing package.
  const needsDisplay = kind === 'scrape' && !process.env.DISPLAY;
  const useXvfb = needsDisplay && fs.existsSync('/usr/bin/xvfb-run');
  return useXvfb
    ? { cmd: 'xvfb-run', argv: ['-a', '--server-args=-screen 0 1280x1024x24', 'npx', 'tsx', SCRIPT[kind], ...args] }
    : { cmd: 'npx', argv: ['tsx', SCRIPT[kind], ...args] };
}

function claim(db: DB, kind: JobKind, pid: number) {
  setMeta(
    db,
    lockKey(kind),
    JSON.stringify({ pid, kind, startedAt: new Date().toISOString() } satisfies Lock),
  );
}

export function release(db: DB, kind: JobKind) {
  setMeta(db, lockKey(kind), '');
}

/**
 * Runs a job to completion, streaming its output to this process.
 *
 * Used by the scheduled runner, which systemd expects to stay alive for as long
 * as the work does — a detached child would let the unit report success the
 * instant it forked.
 */
export function runJob(db: DB, kind: JobKind, args: string[] = []): Promise<number> {
  const existing = readLock(db, kind);
  if (existing) {
    console.log(`[runner] ${kind} already running (pid ${existing.pid}); skipping`);
    return Promise.resolve(0);
  }
  const { cmd, argv } = invocation(kind, args);
  const child = spawn(cmd, argv, { cwd: process.cwd(), stdio: 'inherit', env: process.env });
  if (child.pid) claim(db, kind, child.pid);
  return new Promise((resolve) => {
    child.on('close', (code) => {
      release(db, kind);
      resolve(code ?? 0);
    });
  });
}

export function startJob(db: DB, kind: JobKind, args: string[] = []): StartResult {
  const existing = readLock(db, kind);
  if (existing) {
    return { ok: false, reason: `already running since ${existing.startedAt} (pid ${existing.pid})` };
  }

  fs.mkdirSync(LOG_DIR, { recursive: true });
  const out = fs.openSync(path.join(LOG_DIR, LOG_FILE[kind]), 'a');

  const { cmd, argv } = invocation(kind, args);
  const child = spawn(cmd, argv, {
    cwd: process.cwd(),
    detached: true,
    stdio: ['ignore', out, out],
    env: process.env,
  });
  child.unref();

  if (!child.pid) return { ok: false, reason: 'failed to spawn' };
  claim(db, kind, child.pid);
  return { ok: true, pid: child.pid };
}

export function tailLog(kind: JobKind, lines = 40): string {
  const f = path.join(LOG_DIR, LOG_FILE[kind]);
  // Legacy location: the units wrote beside the app before logs/ existed.
  const legacy = path.join(process.cwd(), LOG_FILE[kind]);
  const file = fs.existsSync(f) ? f : fs.existsSync(legacy) ? legacy : null;
  if (!file) return '';
  const text = fs.readFileSync(file, 'utf8');
  return text.split('\n').slice(-lines).join('\n');
}
