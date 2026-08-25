/** Runs the backtest and caches the result into meta for the Methodology screen. */
import { getDb, setMeta } from '../src/lib/db';
import { runBacktest } from '../src/lib/predict/backtest';

const db = getDb();
const t0 = Date.now();
const res = runBacktest(db, {
  maxBatches: Number(process.argv[2] ?? 400),
  since: process.argv[3] ?? '2019-01-01',
});

console.log(`batches      ${res.batches.toLocaleString()}`);
console.log(`applications ${res.applications.toLocaleString()}`);
console.log(`scored       ${res.scored.toLocaleString()}`);
console.log(`Brier        ${res.brier.toFixed(5)}  (base ${res.brierBase.toFixed(5)})`);
console.log(`Brier skill  ${(res.brierSkill * 100).toFixed(2)}%`);
console.log(`mean abs err ${(res.meanAbsError * 100).toFixed(2)}%`);
console.log('\npredicted  n        predicted  actual');
for (const b of res.bins) {
  console.log(
    `${b.label.padEnd(10)} ${String(b.n).padStart(7)}  ${(b.predicted * 100).toFixed(1).padStart(8)}%  ${(b.actual * 100).toFixed(1).padStart(6)}%`,
  );
}

setMeta(db, 'backtest', JSON.stringify(res));
setMeta(db, 'backtest_at', new Date().toISOString());
console.log(`\n${((Date.now() - t0) / 1000).toFixed(1)}s`);
